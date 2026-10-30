import { TABLES } from "@/domain/changes";
import { settingRow } from "@/domain/settings";
import { weekDays } from "@/domain/time/localDate";
import type {
  ChecklistItem,
  BaseData,
  Block,
  ChangeSet,
  ExportData,
  GoalUsage,
  LocalDate,
  Repository,
  WeekData,
  WeekStartDay,
} from "@/domain/types";
import type { SqlDriver, SqlStmt } from "./drivers/SqlDriver";
import { deleteStmt, fromRows, TABLE_SPECS, upsertStmt } from "./mappers";
import { migrate } from "./migrate";

/** Tables keyed by week start, remapped when the week start day changes. */
const WEEK_KEYED = ["week_targets", "checklist_items", "week_notes"] as const;

export class SqliteRepository implements Repository {
  constructor(
    private readonly driver: SqlDriver,
    private readonly backup?: (reason: string) => Promise<unknown>,
  ) {}

  async init(): Promise<void> {
    await migrate(this.driver, { backup: this.backup });
  }

  async loadBase(): Promise<BaseData> {
    const [goals, weekTargets, settings, templates, routines, calendarSubscriptions] = await Promise.all([
      this.driver.select("SELECT * FROM goals ORDER BY sort_order, created_at"),
      this.driver.select("SELECT * FROM week_targets ORDER BY goal_id, week_start"),
      this.driver.select("SELECT * FROM settings ORDER BY key"),
      this.driver.select("SELECT * FROM templates ORDER BY name, id"),
      this.driver.select("SELECT * FROM routines ORDER BY start_minute, id"),
      this.driver.select("SELECT * FROM calendar_subscriptions ORDER BY created_at, id"),
    ]);
    return {
      goals: fromRows("goals", goals),
      weekTargets: fromRows("weekTargets", weekTargets),
      settings: fromRows("settings", settings),
      templates: fromRows("templates", templates),
      routines: fromRows("routines", routines),
      calendarSubscriptions: fromRows("calendarSubscriptions", calendarSubscriptions),
    };
  }

  async loadWeek(weekStart: LocalDate): Promise<WeekData> {
    const days = weekDays(weekStart);
    const [blocks, items, notes] = await Promise.all([
      this.driver.select("SELECT * FROM blocks WHERE day BETWEEN ? AND ? ORDER BY day, start_minute, end_minute", [
        days[0]!,
        days[6]!,
      ]),
      this.driver.select("SELECT * FROM checklist_items WHERE week_start = ? ORDER BY goal_id, sort_order", [
        weekStart,
      ]),
      this.driver.select("SELECT * FROM week_notes WHERE week_start = ?", [weekStart]),
    ]);
    return {
      weekStart,
      days,
      blocks: fromRows("blocks", blocks),
      checklistItems: fromRows("checklistItems", items),
      weekNote: fromRows("weekNotes", notes)[0] ?? null,
    };
  }

  /** Blocks in `[fromDay, toExclusive)`, for Trends/CSV export: one indexed range query, no week chunking. */
  async loadBlocksRange(fromDay: LocalDate, toExclusive: LocalDate): Promise<Block[]> {
    const rows = await this.driver.select("SELECT * FROM blocks WHERE day >= ? AND day < ? ORDER BY day, start_minute, end_minute", [
      fromDay,
      toExclusive,
    ]);
    return fromRows("blocks", rows);
  }

  async loadChecklistRange(fromWeek: LocalDate, toExclusive: LocalDate): Promise<ChecklistItem[]> {
    const rows = await this.driver.select(
      "SELECT * FROM checklist_items WHERE week_start >= ? AND week_start < ? ORDER BY week_start, goal_id, sort_order",
      [fromWeek, toExclusive],
    );
    return fromRows("checklistItems", rows);
  }

  async applyChanges(changes: ChangeSet): Promise<void> {
    await this.driver.batch(
      changes.map((c) => (c.op === "put" ? upsertStmt(c.table, c.row as never) : deleteStmt(c.table, c.key))),
    );
  }

  async changeWeekStart(shiftDays: number, weekStartDay: WeekStartDay): Promise<void> {
    if (!Number.isInteger(shiftDays) || Math.abs(shiftDays) > 3) throw new Error(`Invalid week shift: ${shiftDays}`);
    const stmts: SqlStmt[] = [];
    if (shiftDays !== 0) {
      for (const table of WEEK_KEYED) {
        stmts.push({ sql: `UPDATE ${table} SET week_start = date(week_start, ? || ' days')`, params: [shiftDays] });
      }
      // Carry-over links stay valid (they reference ids, not weeks).
    }
    stmts.push(upsertStmt("settings", settingRow("weekStartDay", weekStartDay)));
    await this.driver.batch(stmts);
  }

  async goalUsage(goalId: string): Promise<GoalUsage> {
    const [b, c, r] = await Promise.all([
      this.driver.select("SELECT count(*) AS n FROM blocks WHERE goal_id = ?", [goalId]),
      this.driver.select("SELECT count(*) AS n FROM checklist_items WHERE goal_id = ?", [goalId]),
      this.driver.select("SELECT count(*) AS n FROM routines WHERE goal_id = ?", [goalId]),
    ]);
    return { blocks: Number(b[0]?.n ?? 0), checklistItems: Number(c[0]?.n ?? 0), routines: Number(r[0]?.n ?? 0) };
  }

  async exportAll(): Promise<ExportData> {
    const out = {} as Record<string, unknown[]>;
    for (const t of TABLES) {
      out[t] = fromRows(t, await this.driver.select(`SELECT * FROM ${TABLE_SPECS[t].name}`));
    }
    return out as unknown as ExportData;
  }

  async replaceAll(data: ExportData): Promise<void> {
    const stmts: SqlStmt[] = [];
    // Children first so ON DELETE actions have nothing left to do.
    for (const t of [...TABLES].reverse()) stmts.push({ sql: `DELETE FROM ${TABLE_SPECS[t].name}` });
    for (const t of TABLES) for (const row of data[t]) stmts.push(upsertStmt(t, row as never));
    await this.driver.batch(stmts);
  }
}

