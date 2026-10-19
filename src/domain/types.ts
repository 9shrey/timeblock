/**
 * Core domain types. Everything in `src/domain` is pure: no I/O, no wall-clock reads
 * (time comes in as `Now`, ids and timestamps through `Env`).
 */

/** A calendar date on the user's wall clock, `YYYY-MM-DD`. */
export type LocalDate = string;

/** Minutes since local midnight, 0..1440 (1440 = end of day). */
export type Minute = number;

/** Day the week starts on, using JS `getUTCDay` numbering: 1 = Mon, 0 = Sun, 6 = Sat. */
export type WeekStartDay = 1 | 0 | 6;

export type Layer = "plan" | "actual";
export type GoalKind = "min" | "max";

export interface Block {
  id: string;
  day: LocalDate;
  layer: Layer;
  startMinute: Minute; // 0..1439
  endMinute: Minute; // 1..1440, > startMinute
  title: string;
  goalId: string | null;
  notes: string;
  /** Actual blocks only: the same-day plan block this one realises. */
  planBlockId: string | null;
  /** Plan blocks only: explicitly marked as not done. */
  skipped: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Goal {
  id: string;
  name: string; // 1..80 chars
  color: string; // "#rrggbb"
  kind: GoalKind; // min = "at least T", max = "at most T"
  sortOrder: number;
  archivedOn: LocalDate | null;
  createdAt: number;
  updatedAt: number;
}

/** A target that carries forward: the effective target for week W is the latest row with weekStart <= W. */
export interface WeekTarget {
  goalId: string;
  weekStart: LocalDate;
  /** null = "tracked only", no target from this week on. */
  targetMinutes: number | null;
  updatedAt: number;
}

export interface ChecklistItem {
  id: string;
  goalId: string;
  weekStart: LocalDate;
  text: string; // 1..500 chars
  done: boolean;
  sortOrder: number;
  /** Set when this item was carried over from an unfinished item of an earlier week. */
  carriedFromId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface WeekNote {
  weekStart: LocalDate;
  text: string;
  updatedAt: number;
}

/** Raw settings row: `value` is JSON. Parsed into `Settings` by `domain/settings.ts`. */
export interface SettingRow {
  key: string;
  value: string;
}

export type ThemePref = "system" | "light" | "dark";
export type SnapMinutes = 5 | 10 | 15 | 30;

export interface Settings {
  weekStartDay: WeekStartDay;
  dayStartMinute: Minute;
  snapMinutes: SnapMinutes;
  defaultBlockMinutes: number;
  theme: ThemePref;
}

// ---------------------------------------------------------------------------
// Derived (never stored)
// ---------------------------------------------------------------------------

/** A plan block mirrored into the Actual lane until it is confirmed or skipped. */
export interface Ghost {
  /** Same as the plan block id. */
  planBlockId: string;
  day: LocalDate;
  startMinute: Minute;
  endMinute: Minute;
  title: string;
  goalId: string | null;
}

export type PlanState = "pending" | "unconfirmed" | "done" | "adjusted" | "skipped";

export interface Now {
  day: LocalDate;
  minute: Minute;
}

export interface Env {
  newId(): string;
  nowMs(): number;
}

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------

export interface EntityMap {
  blocks: Block;
  goals: Goal;
  weekTargets: WeekTarget;
  checklistItems: ChecklistItem;
  weekNotes: WeekNote;
  settings: SettingRow;
}

export type Table = keyof EntityMap;

/**
 * One row-level write. ChangeSets are self-contained: dependent rows (e.g. actual blocks
 * unlinked when their plan block is deleted) are written explicitly, so the in-memory
 * state, the DB and the inverse ChangeSet always agree. DB foreign-key actions are only
 * a safety net.
 */
export type Change = {
  [T in Table]: { op: "put"; table: T; row: EntityMap[T] } | { op: "del"; table: T; key: string };
}[Table];

export type ChangeSet = Change[];

/** In-memory snapshot, keyed by `keyOf`. */
export type DataState = { [T in Table]: Record<string, EntityMap[T]> };

// ---------------------------------------------------------------------------
// Export file
// ---------------------------------------------------------------------------

export interface ExportData {
  settings: SettingRow[];
  goals: Goal[];
  weekTargets: WeekTarget[];
  checklistItems: ChecklistItem[];
  blocks: Block[];
  weekNotes: WeekNote[];
}

export interface ExportFileV1 extends ExportData {
  format: "timeblock.export";
  version: 1;
  exportedAt: number;
  appVersion: string;
}

// ---------------------------------------------------------------------------
// Repository (implemented in src/data)
// ---------------------------------------------------------------------------

export interface BaseData {
  goals: Goal[];
  weekTargets: WeekTarget[];
  settings: SettingRow[];
}

export interface WeekData {
  weekStart: LocalDate;
  /** The 7 days of the week, in order. */
  days: LocalDate[];
  blocks: Block[];
  checklistItems: ChecklistItem[];
  weekNote: WeekNote | null;
}

export interface GoalUsage {
  blocks: number;
  checklistItems: number;
}

export interface Repository {
  /** Opens the DB and runs pending migrations. */
  init(): Promise<void>;
  loadBase(): Promise<BaseData>;
  loadWeek(weekStart: LocalDate): Promise<WeekData>;
  applyChanges(changes: ChangeSet): Promise<void>;
  /** Shifts every stored week key by `shiftDays` (in [-3, 3]) and saves the new start day. */
  changeWeekStart(shiftDays: number, weekStartDay: WeekStartDay): Promise<void>;
  goalUsage(goalId: string): Promise<GoalUsage>;
  exportAll(): Promise<ExportData>;
  /** Replaces all data in one transaction. */
  replaceAll(data: ExportData): Promise<void>;
}
