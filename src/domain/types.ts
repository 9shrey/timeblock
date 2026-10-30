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
/** What a goal's target and status are measured against: minutes logged, or outcomes done. */
export type GoalTrackBy = "time" | "tasks";

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
  /** Plan blocks created by a routine; cleared when the routine is deleted. */
  routineId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Goal {
  id: string;
  name: string; // 1..80 chars
  color: string; // "#rrggbb"
  kind: GoalKind; // min = "at least T", max = "at most T"
  /** "time" measures target/status in minutes logged; "tasks" measures them in outcomes done. */
  trackBy: GoalTrackBy;
  /** Weekdays the target is spread over for pacing. Bit d = weekday d (0 = Sunday). 1..127. */
  activeDays: number;
  sortOrder: number;
  archivedOn: LocalDate | null;
  createdAt: number;
  updatedAt: number;
}

/** A target that carries forward: the effective target for week W is the latest row with weekStart <= W. */
export interface WeekTarget {
  goalId: string;
  weekStart: LocalDate;
  /** null = "tracked only", no target from this week on. Used when the goal's trackBy is "time". */
  targetMinutes: number | null;
  /** Outcomes due that week; null = "tracked only". Used when the goal's trackBy is "tasks". */
  targetCount: number | null;
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

/** One block of a template, placed relative to the day (or week) it is applied to. */
export interface TemplateBlock {
  /** 0 for day templates; 0..6 from the week start for week templates. */
  dayOffset: number;
  startMinute: Minute;
  endMinute: Minute;
  title: string;
  goalId: string | null;
  notes: string;
}

/** A saved day or week of plan blocks that can be stamped onto another day or week. */
export interface Template {
  id: string;
  name: string; // 1..80 chars
  spanDays: 1 | 7;
  blocks: TemplateBlock[];
  createdAt: number;
  updatedAt: number;
}

/**
 * A recurring plan block. Occurrences are ordinary plan blocks (with `routineId`) created
 * ahead of time for days up to a horizon; `materializedThrough` records how far, so a
 * deleted occurrence is never re-created.
 */
export interface Routine {
  id: string;
  title: string;
  goalId: string | null;
  notes: string;
  startMinute: Minute;
  endMinute: Minute;
  /** Bit d set = repeats on weekday d (0 = Sunday … 6 = Saturday). 1..127. */
  weekdays: number;
  startsOn: LocalDate;
  endsOn: LocalDate | null;
  materializedThrough: LocalDate | null;
  createdAt: number;
  updatedAt: number;
}

/** An `.ics` URL shown as a read-only overlay, re-fetched periodically. Fetched events are never stored. */
export interface CalendarSubscription {
  id: string;
  name: string; // 1..80 chars
  /** An `https://` URL, at most 2048 chars; `webcal://` links are stored as `https://`. */
  url: string;
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
export type TrendWindowWeeks = 4 | 12 | 26;
export type TimeFormat = "24h" | "12h";

export interface Settings {
  weekStartDay: WeekStartDay;
  dayStartMinute: Minute;
  snapMinutes: SnapMinutes;
  defaultBlockMinutes: number;
  theme: ThemePref;
  /** Default window for the Trends view ("i"). */
  trendWindowWeeks: TrendWindowWeeks;
  /** Goal the year heatmap colors by; null = every goal's actual time combined. */
  heatmapGoalId: string | null;
  /** "Next block in 5 min: …" shortly before a plan block starts. */
  notifyNextBlock: boolean;
  /** An evening nudge when today has unconfirmed blocks. */
  notifyUnconfirmed: boolean;
  /** On the last day of the week, once Review has something to show. */
  notifyWeeklyReview: boolean;
  /** Closing the window hides it to the tray instead of quitting. */
  closeToTray: boolean;
  /** How clock times are shown: "09:30" or "9:30 AM". Input accepts either in both modes. */
  timeFormat: TimeFormat;
  /** Desktop: look for a new release on launch and once a day while running. */
  autoCheckUpdates: boolean;
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
  templates: Template;
  routines: Routine;
  blocks: Block;
  goals: Goal;
  weekTargets: WeekTarget;
  checklistItems: ChecklistItem;
  weekNotes: WeekNote;
  settings: SettingRow;
  calendarSubscriptions: CalendarSubscription;
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
  templates: Template[];
  routines: Routine[];
  blocks: Block[];
  weekNotes: WeekNote[];
  calendarSubscriptions: CalendarSubscription[];
}

export interface ExportFile extends ExportData {
  format: "timeblock.export";
  /** 1: original tables. 2: adds templates, routines and blocks.routineId. 3: adds goals.trackBy and weekTargets.targetCount. 4: adds calendarSubscriptions. */
  version: 4;
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
  templates: Template[];
  routines: Routine[];
  calendarSubscriptions: CalendarSubscription[];
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
  routines: number;
}

export interface Repository {
  /** Opens the DB and runs pending migrations. */
  init(): Promise<void>;
  loadBase(): Promise<BaseData>;
  loadWeek(weekStart: LocalDate): Promise<WeekData>;
  /** Every block with `day` in `[fromDay, toExclusive)` (half-open), across any number of weeks. One indexed query. */
  loadBlocksRange(fromDay: LocalDate, toExclusive: LocalDate): Promise<Block[]>;
  /** Outcomes of every week starting in `[fromWeek, toExclusive)`, for Trends/CSV export. */
  loadChecklistRange(fromWeek: LocalDate, toExclusive: LocalDate): Promise<ChecklistItem[]>;
  applyChanges(changes: ChangeSet): Promise<void>;
  /** Shifts every stored week key by `shiftDays` (in [-3, 3]) and saves the new start day. */
  changeWeekStart(shiftDays: number, weekStartDay: WeekStartDay): Promise<void>;
  goalUsage(goalId: string): Promise<GoalUsage>;
  exportAll(): Promise<ExportData>;
  /** Replaces all data in one transaction. */
  replaceAll(data: ExportData): Promise<void>;
}
