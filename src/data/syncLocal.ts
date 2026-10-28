/**
 * The local half of sync: the outbox the capture triggers fill (migration 0006), the
 * local-only `sync_meta` key/value table, and applying pulled changes without echoing them.
 */
import { TABLES } from "@/domain/changes";
import type { EntityMap, Table } from "@/domain/types";
import type { SqlDriver, SqlStmt } from "./drivers/SqlDriver";
import { deleteStmt, fromRows, TABLE_SPECS, upsertStmt } from "./mappers";

/** A row change as it travels to and from the server. `row: null` means deleted. */
export interface SyncChange {
  table: string;
  key: string;
  row: unknown;
}

export interface OutboxEntry extends SyncChange {
  ver: number;
}

/** Preferences that belong to one device. Matches the list in 0006_sync.sql. */
export const LOCAL_SETTING_KEYS: ReadonlySet<string> = new Set([
  "theme",
  "notifyNextBlock",
  "notifyUnconfirmed",
  "notifyWeeklyReview",
  "closeToTray",
  "autoCheckUpdates",
]);

const notLocalSetting = `key NOT IN (${[...LOCAL_SETTING_KEYS].map((k) => `'${k}'`).join(", ")})`;

const isTable =(t: string): t is Table => (TABLES as readonly string[]).includes(t);

/** SQL expression that yields `keyOf(table, row)` for a row of `table`. */
const keySql = (t: Table) => TABLE_SPECS[t].pk.join(" || '|' || ");

const CAPTURE_OFF: SqlStmt = { sql: "UPDATE sync_meta SET value = '0' WHERE key = 'capture'" };
const CAPTURE_ON: SqlStmt = { sql: "UPDATE sync_meta SET value = '1' WHERE key = 'capture'" };

/** Pulled rows may point at parents another device deleted; clear or drop those links. */
const REPAIR: SqlStmt[] = [
  "UPDATE blocks SET goal_id = NULL WHERE goal_id IS NOT NULL AND goal_id NOT IN (SELECT id FROM goals)",
  "UPDATE blocks SET plan_block_id = NULL WHERE plan_block_id IS NOT NULL AND plan_block_id NOT IN (SELECT id FROM blocks)",
  "UPDATE blocks SET routine_id = NULL WHERE routine_id IS NOT NULL AND routine_id NOT IN (SELECT id FROM routines)",
  "UPDATE routines SET goal_id = NULL WHERE goal_id IS NOT NULL AND goal_id NOT IN (SELECT id FROM goals)",
  "DELETE FROM week_targets WHERE goal_id NOT IN (SELECT id FROM goals)",
  "DELETE FROM checklist_items WHERE goal_id NOT IN (SELECT id FROM goals)",
].map((sql) => ({ sql }));

export class SyncLocal {
  constructor(private readonly driver: SqlDriver) {}

  async getMeta(key: string): Promise<string | null> {
    const rows = await this.driver.select("SELECT value FROM sync_meta WHERE key = ?", [key]);
    return rows[0] ? String(rows[0].value) : null;
  }

  /** Sets (or with `null`, removes) several meta keys in one transaction. */
  async setMeta(values: Record<string, string | null>): Promise<void> {
    await this.driver.batch(
      Object.entries(values).map(([key, value]) =>
        value === null
          ? { sql: "DELETE FROM sync_meta WHERE key = ?", params: [key] }
          : {
              sql: "INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
              params: [key, value],
            },
      ),
    );
  }

  async outboxSize(): Promise<number> {
    const rows = await this.driver.select("SELECT count(*) AS n FROM sync_outbox");
    return Number(rows[0]?.n ?? 0);
  }

  /** Up to `limit` pending changes, each with the row as it is now (null if deleted). */
  async readOutbox(limit = 2000): Promise<OutboxEntry[]> {
    const entries = await this.driver.select("SELECT tbl, key, ver FROM sync_outbox LIMIT ?", [limit]);
    const out: OutboxEntry[] = [];
    for (const e of entries) {
      const table = String(e.tbl);
      const key = String(e.key);
      const ver = Number(e.ver);
      if (!isTable(table)) continue;
      const spec = TABLE_SPECS[table];
      const where = spec.pk.map((c) => `${c} = ?`).join(" AND ");
      const rows = await this.driver.select(`SELECT * FROM ${spec.name} WHERE ${where}`, spec.keyParams(key));
      out.push({ table, key, ver, row: rows.length ? fromRows(table, rows)[0] : null });
    }
    return out;
  }

  /** Clears entries that were pushed, unless they changed again since they were read. */
  async markPushed(entries: readonly OutboxEntry[]): Promise<void> {
    await this.driver.batch(
      entries.map((e) => ({
        sql: "DELETE FROM sync_outbox WHERE tbl = ? AND key = ? AND ver = ?",
        params: [e.table, e.key, e.ver],
      })),
    );
  }

  /** Queues every synced row for upload (first sync with "merge" or "upload this device"). */
  async enqueueAll(): Promise<void> {
    const stmts: SqlStmt[] = TABLES.map((t) => ({
      sql:
        `INSERT INTO sync_outbox (tbl, key) SELECT '${t}', ${keySql(t)} FROM ${TABLE_SPECS[t].name}` +
        // A WHERE is required before ON CONFLICT in INSERT … SELECT (parser ambiguity).
        (t === "settings" ? ` WHERE ${notLocalSetting}` : " WHERE true") +
        " ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1",
    }));
    await this.driver.batch(stmts);
  }

  async clearOutbox(): Promise<void> {
    await this.driver.batch([{ sql: "DELETE FROM sync_outbox" }]);
  }

  /** True if this device has any data worth keeping (goals, blocks, notes…). */
  async hasData(): Promise<boolean> {
    for (const t of TABLES) {
      if (t === "settings") continue;
      const rows = await this.driver.select(`SELECT 1 FROM ${TABLE_SPECS[t].name} LIMIT 1`);
      if (rows.length) return true;
    }
    return false;
  }

  /**
   * Applies pulled changes in one transaction with capture off, so they aren't pushed back.
   * With `replace`, all synced local data is wiped first ("use the server's data").
   * Unknown tables and this device's own preferences are skipped.
   */
  async applyRemote(changes: readonly SyncChange[], opts: { replace?: boolean } = {}): Promise<number> {
    const stmts: SqlStmt[] = [CAPTURE_OFF];
    if (opts.replace) {
      for (const t of [...TABLES].reverse()) {
        const spec = TABLE_SPECS[t];
        stmts.push({ sql: `DELETE FROM ${spec.name}` + (t === "settings" ? ` WHERE ${notLocalSetting}` : "") });
      }
      stmts.push({ sql: "DELETE FROM sync_outbox" });
    }
    let applied = 0;
    for (const c of orderForApply(changes)) {
      if (!isTable(c.table)) continue;
      if (c.table === "settings" && LOCAL_SETTING_KEYS.has(c.key)) continue;
      // Without replace, a row with an unpushed local edit keeps it; that edit is pushed next.
      const stmt = c.row == null ? deleteStmt(c.table, c.key) : upsertStmt(c.table, c.row as EntityMap[typeof c.table]);
      stmts.push(opts.replace ? stmt : unlessPending(stmt, c.table, c.key));
      applied++;
    }
    stmts.push(...REPAIR, CAPTURE_ON);
    await this.driver.batch(stmts);
    return applied;
  }
}

const PENDING_GUARD = "NOT EXISTS (SELECT 1 FROM sync_outbox WHERE tbl = ? AND key = ?)";

/** Turns an upsert/delete into a no-op when the row has a pending local change. */
function unlessPending(stmt: SqlStmt, table: string, key: string): SqlStmt {
  const params = [...(stmt.params ?? []), table, key];
  if (stmt.sql.startsWith("DELETE")) return { sql: `${stmt.sql} AND ${PENDING_GUARD}`, params };
  // INSERT … VALUES (…) ON CONFLICT → INSERT … SELECT … WHERE guard ON CONFLICT
  const sql = stmt.sql.replace(/ VALUES \(([^)]*)\) ON CONFLICT/, ` SELECT $1 WHERE ${PENDING_GUARD} ON CONFLICT`);
  if (sql === stmt.sql) throw new Error("Unexpected upsert shape");
  return { sql, params };
}

/** Parents before children (puts) so in-batch ON CONFLICT updates never hit missing rows. */
function orderForApply(changes: readonly SyncChange[]): SyncChange[] {
  const rank = (t: string) => {
    const i = (TABLES as readonly string[]).indexOf(t);
    return i < 0 ? TABLES.length : i;
  };
  return changes
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c.table) - rank(b.c.table) || a.i - b.i)
    .map(({ c }) => c);
}
