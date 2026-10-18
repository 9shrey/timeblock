import initSqlJs, { type Database } from "sql.js";
import { checkParams, type SqlDriver, type SqlRow, type SqlStmt, type SqlValue } from "./SqlDriver";

export interface SqlJsDriverOptions {
  /** URL of the wasm file (browser). Omit under Node/Vitest. */
  wasmUrl?: string;
  /** Initial database image (e.g. restored from localStorage). */
  data?: Uint8Array | null;
  /** Called with the full database image after every successful write. */
  onPersist?: (image: Uint8Array) => void;
}

export interface SqlJsDriver extends SqlDriver {
  /** Raw database image, for persistence and tests. */
  export(): Uint8Array;
  close(): void;
}

/** In-process SQLite (sql.js) with the same transaction semantics as the Rust driver. */
export async function createSqlJsDriver(opts: SqlJsDriverOptions = {}): Promise<SqlJsDriver> {
  const SQL = await initSqlJs(opts.wasmUrl ? { locateFile: () => opts.wasmUrl! } : undefined);
  const db: Database = new SQL.Database(opts.data ?? undefined);
  const enableFks = () => db.run("PRAGMA foreign_keys = ON;");
  enableFks();

  /** sql.js `export()` closes and reopens the DB, which resets pragmas. */
  const exportImage = () => {
    const image = db.export();
    enableFks();
    return image;
  };
  const persist = () => {
    if (opts.onPersist) opts.onPersist(exportImage());
  };

  /** Runs `fn` inside BEGIN/COMMIT, rolling back on any error. */
  const inTransaction = (fn: () => void) => {
    db.run("BEGIN;");
    try {
      fn();
      db.run("COMMIT;");
    } catch (e) {
      // sql.js has no getAutocommit(); SQLite may already have rolled back
      // (e.g. on some constraint errors), in which case ROLLBACK itself throws.
      try {
        db.run("ROLLBACK;");
      } catch {
        /* no transaction active */
      }
      throw e instanceof Error ? e : new Error(String(e));
    }
    persist();
  };

  return {
    kind: "sqljs",
    async select(sql: string, params: SqlValue[] = []) {
      checkParams(params);
      const stmt = db.prepare(sql);
      try {
        stmt.bind(params);
        const rows: SqlRow[] = [];
        while (stmt.step()) rows.push(stmt.getAsObject() as SqlRow);
        return rows;
      } finally {
        stmt.free();
      }
    },
    async batch(stmts: SqlStmt[]) {
      if (stmts.length === 0) return;
      for (const s of stmts) checkParams(s.params);
      inTransaction(() => {
        db.run("PRAGMA defer_foreign_keys = ON;");
        for (const s of stmts) db.run(s.sql, s.params ?? []);
      });
    },
    async execScript(sql: string) {
      inTransaction(() => db.exec(sql));
    },
    export: exportImage,
    close: () => db.close(),
  };
}
