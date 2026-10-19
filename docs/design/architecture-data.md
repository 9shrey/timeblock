# Design: Plan vs Actual time-blocking with weekly goals (Tauri 2 + React/TS)

## 0. Decisions at a glance

| Topic | Decision |
|---|---|
| Persistence path | A small set of custom Rust commands over **rusqlite (bundled)**: `db_select`, `db_batch` (one transaction), `db_exec_script`, plus file and backup commands. **Not tauri-plugin-sql.** All SQL and migrations live in TypeScript. |
| Browser/dev/test repo | `MemoryRepository`: an in-memory `Snapshot`, persisted to localStorage in the export-JSON format. It reuses the same pure `applyChanges` the store uses. `SqliteRepository` is tested in Vitest through a **sql.js** driver (dev dependency only). One contract test suite runs against both. |
| Time model | Local wall-clock: `day: 'YYYY-MM-DD'` plus `startMinute`/`endMinute` (0..1440). No UTC timestamps for planning data. |
| Midnight | A single block can't cross midnight. `end = 1440` is allowed. Quick-add input that crosses midnight is split into 2 blocks. |
| Week key | `week_start` LocalDate (derived from the configurable week start), not the ISO week number. Keys are remapped in one transaction when the setting changes. |
| Targets | Carry-forward rows: the effective target for week W is the latest row with `week_start <= W`. A new week "inherits" without any writes. |
| Overlaps | Allowed in both layers and never blocked during a drag. Overlapping blocks render side by side in lanes. Hours are aggregated as a **union per (day, goal)**, so overlap within the same goal isn't double-counted. Overlap across different goals counts toward both. Tracked total is the union of all blocks. Overlap shows as a warning. |
| Plan to Actual | Lazy seeding. An unseeded day shows plan "ghosts" in the Actual column. The first edit (or "Went as planned") copies the plan in, in the same transaction as the edit. Copying is idempotent through `source_plan_block_id`. |
| State | Zustand v5 with a normalized Snapshot. Every mutation is a `ChangeSet`, applied optimistically and written through a serial queue. **Multi-level undo/redo (cap 100) is in the MVP**, because the snapshot-diff design makes it cost almost nothing. |
| Dates | **date-fns v4 + `@date-fns/utc` (UTCDate)** behind a single `localDate.ts` facade. No Temporal: it isn't in stable WebKit, and Tauri uses WebKitGTK on Linux and WKWebView on macOS. |
| Import | MVP is **Replace**, with an automatic DB backup first. Merge (upsert by id, last-writer-wins on `updatedAt`) is designed here as a pure function and ships in phase 2. |

---

## 1. Layering

```
React features (day, week, goals, review, settings)
        │ hooks/selectors
state/  Zustand store ── commands.ts (build ChangeSets via domain) ── undo/redo
        │ Repository interface (async)
data/   SqliteRepository(SqlDriver) ────────────── MemoryRepository(localStorage)
        │ SqlDriver                                   (browser `vite dev`, store tests)
        ├─ tauriDriver   → invoke('db_*') → Rust rusqlite (app)
        └─ sqljsDriver   → sql.js in Node (Vitest only)
domain/ pure TS: time, intervals, aggregation, status, plan→actual, targets,
        checklist, changes (apply/diff), export format. No I/O, no Date.now().
platform/ isTauri() switch: { repo, saveTextFile, openTextFile, backupNow, dataDir }
```

**Why not tauri-plugin-sql.** Its SQLite backend uses a sqlx pool of up to 10 connections, and each `execute` call checks out any one of them. So `BEGIN` / statements / `COMMIT` sent as separate JS calls can land on different connections. Transaction support (plugins-workspace #886) was still open as of Oct 2026, and the workarounds are either a patched fork or one big multi-statement string. Several operations here must be atomic:
- import-replace
- seed day plus the user's edit
- week-start remap
- reorder
- undo of multi-row changes

A generic `db_batch(stmts)` that runs in one rusqlite transaction is about 150 lines of Rust and closes that gap. It keeps Rust schema-agnostic: all SQL lives in TS, so the same SQL is exercised in Vitest through sql.js. The security model is the same as plugin-sql (the webview issues SQL), and the app only loads bundled local assets.

**Rust surface (`src-tauri/src/db.rs`, `files.rs`):**

```rust
pub struct Db(pub std::sync::Mutex<rusqlite::Connection>);
#[derive(serde::Deserialize)] pub struct Stmt { sql: String, #[serde(default)] params: Vec<serde_json::Value> }

#[tauri::command] async fn db_select(db: State<'_, Db>, sql: String, params: Vec<Value>) -> Result<Vec<serde_json::Map<String, Value>>, String>;
#[tauri::command] async fn db_batch(db: State<'_, Db>, stmts: Vec<Stmt>) -> Result<(), String>;
//   tx = conn.transaction(); tx.execute_batch("PRAGMA defer_foreign_keys=ON"); for s { tx.execute(&s.sql, params_from_iter(conv(s.params))) }; tx.commit()
#[tauri::command] async fn db_exec_script(db: State<'_, Db>, sql: String) -> Result<(), String>; // tx.execute_batch(sql); commit (migrations)
#[tauri::command] async fn backup_now(app: AppHandle, db: State<'_, Db>, stamp: String) -> Result<String, String>;
//   VACUUM INTO '<app_data_dir>/backups/data-<stamp>.sqlite3'; keep newest 14
#[tauri::command] async fn save_text_file(app: AppHandle, default_name: String, contents: String) -> Result<Option<String>, String>; // dialog Rust API blocking_save_file
#[tauri::command] async fn open_text_file(app: AppHandle) -> Result<Option<String>, String>;  // blocking_pick_file, filter json
#[tauri::command] fn data_dir(app: AppHandle) -> Result<String, String>;
```

- **Value conversion:** JSON `null` becomes NULL, an integral number becomes `i64`, any other number becomes `f64`, a string becomes TEXT, and a bool is rejected (TS maps booleans to 0/1). Rows come back as `{col: value}`.
- **Open in `setup()`:** `app.path().app_data_dir()/data.sqlite3`, then `journal_mode=WAL`, `foreign_keys=ON`, `synchronous=NORMAL`, `busy_timeout=5000`.
- **Crates:** `tauri 2`, `tauri-plugin-dialog 2` (used only from Rust, so no JS dialog permission is needed), `rusqlite 0.40 {bundled}`, `serde`, `serde_json`.
- **Capability:** `core:default`. App commands are allowed by default per the Tauri docs. Optionally lock them down via `tauri_build` `AppManifest`.
- **Timestamps:** the backup filename stamp is passed in from TS, so Rust needs no chrono dependency.

**SqlDriver (`src/data/drivers/SqlDriver.ts`):**

```ts
export type SqlValue = string | number | null;
export interface Stmt { sql: string; params?: SqlValue[] }      // positional `?`
export interface SqlDriver {
  select<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  batch(stmts: Stmt[]): Promise<void>;     // all-or-nothing transaction
  execScript(sql: string): Promise<void>;  // multi-statement, no params, in a transaction
}
```

---

## 2. Time model and DST

- **Planning data is wall-clock.** `day` is a calendar date with no timezone. Minutes count from local midnight, so "09:00" stays 09:00 after you travel or after a DST change. That's what a personal planner wants. UTC instants would make blocks drift when the timezone changes and would make "which day is this" depend on the timezone.
- **Durations are wall-clock** (`end - start`). This is a documented consequence:
  - On spring-forward days (EU 2026-03-29, US 2026-03-08), a 01:30–03:30 block counts 120 min, though only 60 real minutes elapse.
  - On fall-back days (EU 2026-10-25, US 2026-11-01), the 01:00–02:00 hour happens twice, but a block covering it still counts its wall-clock length.
  - The error only touches blocks spanning about 02:00–03:00 on 2 nights a year. Accepted.
- **Local time is read in one place only.** `src/domain/time/clock.ts`: `nowFrom(d: Date): Now` uses `d.getFullYear()/getMonth()/getDate()/getHours()/getMinutes()`. An ESLint `no-restricted-syntax` rule bans `new Date(`/`Date.now` everywhere else (except `platform/`). Audit timestamps (`created_at`, etc.) are epoch ms from an injected `Env.nowMs()`.
- **Date arithmetic never touches local time.** `localDate.ts` converts `'YYYY-MM-DD'` to `new UTCDate(y, m-1, d)` and uses date-fns `addDays`, `startOfWeek({weekStartsOn})`, `getDay`, `differenceInCalendarDays`, and `format`. UTC has no DST, so results don't depend on the machine's timezone.
- **Midnight:** blocks satisfy `0 <= start < end <= 1440`. Quick-add like "23:00, 8h" uses `splitAtMidnight`, which produces `[D 1380–1440, D+1 0–420]` as two independent blocks. Dragging past 24:00 clamps. Durations over 1440 are rejected.
- **Visible window** (`dayStart`/`dayEndMinute`): sets the default viewport and is the denominator for "untracked" time. Blocks outside it still count toward goals.

---

## 3. SQLite schema (`src/data/sqlite/migrations/0001_init.sql`, imported via `?raw`)

```sql
CREATE TABLE settings (
  id                    INTEGER PRIMARY KEY CHECK (id = 1),
  week_start_day        INTEGER NOT NULL DEFAULT 1    CHECK (week_start_day BETWEEN 0 AND 6), -- 0=Sun
  day_start_minute      INTEGER NOT NULL DEFAULT 420  CHECK (day_start_minute BETWEEN 0 AND 1380),
  day_end_minute        INTEGER NOT NULL DEFAULT 1380 CHECK (day_end_minute BETWEEN 60 AND 1440),
  snap_minutes          INTEGER NOT NULL DEFAULT 15   CHECK (snap_minutes IN (5,10,15,30,60)),
  default_block_minutes INTEGER NOT NULL DEFAULT 60   CHECK (default_block_minutes BETWEEN 5 AND 1440),
  updated_at            INTEGER NOT NULL,
  CHECK (day_end_minute > day_start_minute)
) STRICT;
INSERT INTO settings (id, updated_at) VALUES (1, 0);

CREATE TABLE goals (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  color       TEXT NOT NULL CHECK (length(color) = 7 AND color GLOB '#[0-9A-Fa-f]*'),
  kind        TEXT NOT NULL DEFAULT 'min' CHECK (kind IN ('min','max')),
  archived_on TEXT,                                   -- LocalDate; NULL = active
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
) STRICT;

-- Carry-forward step function: a row applies to week_start and all later weeks until the next row.
CREATE TABLE week_targets (
  goal_id        TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  week_start     TEXT NOT NULL,
  target_minutes INTEGER CHECK (target_minutes IS NULL OR target_minutes BETWEEN 0 AND 10080), -- NULL = no target
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (goal_id, week_start)
) STRICT, WITHOUT ROWID;

CREATE TABLE checklist_items (
  id              TEXT PRIMARY KEY,
  goal_id         TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  week_start      TEXT NOT NULL,
  text            TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 500),
  done            INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0,1)),
  done_at         INTEGER,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  carried_from_id TEXT REFERENCES checklist_items(id) ON DELETE SET NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_checklist_week ON checklist_items(week_start, goal_id, sort_order);

CREATE TABLE blocks (
  id                   TEXT PRIMARY KEY,
  day                  TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  layer                TEXT NOT NULL CHECK (layer IN ('plan','actual')),
  start_minute         INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute           INTEGER NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
  title                TEXT NOT NULL DEFAULT '' CHECK (length(title) <= 200), -- '' => display goal name
  goal_id              TEXT REFERENCES goals(id) ON DELETE SET NULL,
  source_plan_block_id TEXT REFERENCES blocks(id) ON DELETE SET NULL,
  notes                TEXT NOT NULL DEFAULT '',
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  CHECK (end_minute > start_minute),
  CHECK (source_plan_block_id IS NULL OR layer = 'actual')
) STRICT;
CREATE INDEX idx_blocks_day    ON blocks(day, layer, start_minute);
CREATE INDEX idx_blocks_source ON blocks(source_plan_block_id) WHERE source_plan_block_id IS NOT NULL;
CREATE INDEX idx_blocks_goal   ON blocks(goal_id);

CREATE TABLE day_states (
  day              TEXT PRIMARY KEY,
  actual_seeded_at INTEGER,   -- non-NULL => Actual column is materialized (ghosts off), even if empty
  reviewed_at      INTEGER,   -- user confirmed the day ("Went as planned" / "Done correcting")
  updated_at       INTEGER NOT NULL
) STRICT, WITHOUT ROWID;
```

**Notes:**
- `STRICT` needs SQLite 3.37 or newer. rusqlite bundled ships 3.53 and sql.js is at least 3.49, so both are fine.
- `archived_on` is a LocalDate instead of a boolean. That lets past reviews still show a goal that was archived later, and a LocalDate needs no remapping when week start changes.
- IDs come from `crypto.randomUUID()`, wrapped in `Env.newId` with a `getRandomValues` fallback. Text IDs make import-merge trivial.

**Migrations (`src/data/sqlite/migrate.ts`):**
1. Read `PRAGMA user_version`.
2. If it's above the app's max, refuse to start ("data from a newer version").
3. For each pending migration, call `driver.execScript(sql + '; PRAGMA user_version = N;')`. Each one runs in a transaction.
4. Set `PRAGMA foreign_keys=ON` at connection open, not inside migrations.

**Upsert template** (used for every entity):

```sql
INSERT INTO blocks (id,day,layer,start_minute,end_minute,title,goal_id,source_plan_block_id,notes,created_at,updated_at)
VALUES (?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(id) DO UPDATE SET day=excluded.day, layer=excluded.layer, start_minute=excluded.start_minute,
  end_minute=excluded.end_minute, title=excluded.title, goal_id=excluded.goal_id,
  source_plan_block_id=excluded.source_plan_block_id, notes=excluded.notes, updated_at=excluded.updated_at;
```

Bulk inserts (import) use multi-row `VALUES` in chunks of 100 rows (about 1,100 params, well under SQLite's 32,766 limit).

---

## 4. Week identity

```ts
export interface WeekRange { start: LocalDate; endExclusive: LocalDate; days: readonly LocalDate[] } // 7 days
export function weekStartOf(d: LocalDate, ws: Weekday): LocalDate;    // startOfWeek(UTCDate, {weekStartsOn: ws})
export function weekRange(start: LocalDate): WeekRange;
export function remapWeekKey(oldKey: LocalDate, newWs: Weekday): LocalDate; // = weekStartOf(addDays(oldKey, 3), newWs)
```

- Weeks are keyed by `week_start` because a Sunday-start week doesn't line up with ISO weeks. The UI shows the ISO week number only as a label.
- **Changing week start** (`Repository.changeWeekStart`, one transaction):
  - Every `week_targets.week_start` and `checklist_items.week_start` maps to the new week containing the old week's midpoint (key + 3 days). That new week overlaps the old one by at least 4 days.
  - All keys shift by the same offset (under 7 days), so no new key can collide with an old key.
  - The undo stack is cleared.
- Weekday: offer Monday, Sunday, or Saturday in the UI. The domain supports 0..6.

---

## 5. TS types (`src/domain/types.ts`)

```ts
export type Id = string;
export type LocalDate = string & { readonly __brand: 'LocalDate' }; // 'YYYY-MM-DD'
export type MinuteOfDay = number;   // int 0..1440 (1440 only as end)
export type EpochMs = number;       // audit only
export type Weekday = 0|1|2|3|4|5|6;
export type Layer = 'plan' | 'actual';
export type TargetKind = 'min' | 'max';

export interface Settings { weekStartDay: Weekday; dayStartMinute: MinuteOfDay; dayEndMinute: MinuteOfDay;
  snapMinutes: 5|10|15|30|60; defaultBlockMinutes: number; updatedAt: EpochMs }
export interface Goal { id: Id; name: string; color: string; kind: TargetKind; archivedOn: LocalDate | null;
  sortOrder: number; createdAt: EpochMs; updatedAt: EpochMs }
export interface WeekTarget { goalId: Id; weekStart: LocalDate; targetMinutes: number | null; updatedAt: EpochMs }
export interface ChecklistItem { id: Id; goalId: Id; weekStart: LocalDate; text: string; done: boolean;
  doneAt: EpochMs | null; sortOrder: number; carriedFromId: Id | null; createdAt: EpochMs; updatedAt: EpochMs }
export interface Block { id: Id; day: LocalDate; layer: Layer; startMinute: MinuteOfDay; endMinute: MinuteOfDay;
  title: string; goalId: Id | null; sourcePlanBlockId: Id | null; notes: string; createdAt: EpochMs; updatedAt: EpochMs }
export interface DayState { day: LocalDate; actualSeededAt: EpochMs | null; reviewedAt: EpochMs | null; updatedAt: EpochMs }

export interface Now { day: LocalDate; minute: MinuteOfDay }
export interface Env { newId(): Id; nowMs(): EpochMs; now(): Now }

export type TargetKey = `${Id}|${string}`; // goalId|weekStart
export interface Snapshot {               // full in MemoryRepository; loaded subset in the store
  settings: Settings;
  goals: Readonly<Record<Id, Goal>>;
  weekTargets: Readonly<Record<TargetKey, WeekTarget>>;
  checklist: Readonly<Record<Id, ChecklistItem>>;
  blocks: Readonly<Record<Id, Block>>;
  dayStates: Readonly<Record<LocalDate, DayState>>;
}
export type Change =
  | { op: 'upsert'; entity: 'goal'; row: Goal }                 | { op: 'delete'; entity: 'goal'; id: Id }
  | { op: 'upsert'; entity: 'weekTarget'; row: WeekTarget }     | { op: 'delete'; entity: 'weekTarget'; goalId: Id; weekStart: LocalDate }
  | { op: 'upsert'; entity: 'checklistItem'; row: ChecklistItem } | { op: 'delete'; entity: 'checklistItem'; id: Id }
  | { op: 'upsert'; entity: 'block'; row: Block }               | { op: 'delete'; entity: 'block'; id: Id }
  | { op: 'upsert'; entity: 'dayState'; row: DayState }         | { op: 'delete'; entity: 'dayState'; day: LocalDate }
  | { op: 'upsert'; entity: 'settings'; row: Settings };
export type ChangeSet = readonly Change[];
```

---

## 6. Domain functions (pure, in `src/domain/**`)

**Changes (`changes.ts`), the backbone of optimistic updates, undo, and MemoryRepository:**

```ts
export function applyChanges(s: Snapshot, cs: ChangeSet): Snapshot;
// Immutable, with structural sharing. Applies FK cascades in memory:
//   goal delete → blocks.goalId = null, its weekTargets and checklist deleted
//   plan block delete → actual copies' sourcePlanBlockId = null
//   checklist delete → carriedFromId = null
export function diffSnapshots(a: Snapshot, b: Snapshot): ChangeSet;
// Reference-equality diff per table, so it's O(n) cheap.
// forward = diff(before, after) (includes cascaded rows explicitly); inverse = diff(after, before)
```

**Intervals and layout (`blocks/intervals.ts`, `blocks/layout.ts`):**

```ts
export interface Interval { start: number; end: number }        // half-open [start,end); touching ≠ overlap
export function mergeIntervals(xs: readonly Interval[]): Interval[];
export function unionLength(xs: readonly Interval[]): number;
export function clip(x: Interval, w: Interval): Interval | null;
export function gaps(xs: readonly Interval[], w: Interval): Interval[];   // "untracked" hatching + click-to-fill
export function overlapMinutes(xs: readonly Interval[]): number;          // Σlen − unionLength
export function layoutLanes(dayLayerBlocks: readonly Block[]): Map<Id, { lane: number; laneCount: number }>;
// sort by (start, -len); clusters of transitively overlapping blocks; first-fit lanes; laneCount per cluster
```

**Editing math and validation (`blocks/edit.ts`, `blocks/validate.ts`):**

```ts
export function snap(m: number, step: number): MinuteOfDay;                         // round, clamp 0..1440
export function moveInterval(x: Interval, delta: number, step: number): Interval;   // keeps duration, clamps in [0,1440]
export function resizeInterval(x: Interval, edge: 'start'|'end', to: number, step: number, minLen: number): Interval;
export function pixelToMinute(y: number, pxPerMin: number, viewStart: MinuteOfDay): number;
export function splitAtMidnight(day: LocalDate, start: MinuteOfDay, durationMin: number):
  Array<{ day: LocalDate; startMinute: MinuteOfDay; endMinute: MinuteOfDay }>;        // throws if dur<=0 || dur>1440
export type ValidationIssue = { field: keyof Block; code:
  'invalid_date'|'out_of_range'|'end_not_after_start'|'too_short'|'title_too_long'|'unknown_goal'|'archived_goal'|'source_not_plan' };
export function validateBlock(b: Block, ctx: { goals: Snapshot['goals']; isNew: boolean; minLen: number }): ValidationIssue[];
// archived_goal is only an issue when isNew, or when goalId changed to an archived goal
```

**Plan to Actual (`blocks/planToActual.ts`):**

```ts
export function missingPlanCopies(plan: readonly Block[], actual: readonly Block[], env: Pick<Env,'newId'|'nowMs'>):
  { copies: Block[]; copyIdByPlanId: Map<Id, Id> };   // plan blocks with no actual where sourcePlanBlockId == plan.id
export function seedDayChanges(s: Snapshot, day: LocalDate, env: Env):
  { changes: ChangeSet; copyIdByPlanId: Map<Id, Id> };          // no-op if dayStates[day].actualSeededAt != null
export function withAutoSeed(s: Snapshot, cs: ChangeSet, env: Env): ChangeSet; // prepends seed for every unseeded day touched by an actual-layer upsert
export function editGhostChanges(s: Snapshot, day: LocalDate, planBlockId: Id, patch: Partial<Block>, env: Env): ChangeSet; // seed + patch that copy
export function markDayAsPlannedChanges(s: Snapshot, day: LocalDate, env: Env): ChangeSet;   // seed + reviewedAt
export function resetActualToPlanChanges(s: Snapshot, day: LocalDate, env: Env): ChangeSet;  // delete all actual(day) + copy all plan
export function addMissingPlanBlocksChanges(s: Snapshot, day: LocalDate, env: Env): ChangeSet; // re-add skipped (explicit action)
export function cloneDayPlanChanges(s: Snapshot, from: LocalDate, to: LocalDate, env: Env): ChangeSet; // "copy last Tuesday's plan"
export type PlanOutcome = 'as_planned' | 'adjusted' | 'skipped' | 'pending';
export function planOutcomes(plan: readonly Block[], actual: readonly Block[], corrected: boolean): Map<Id, PlanOutcome>;
// as_planned: a copy exists with the same start/end/goal; adjusted: a copy exists but differs; skipped: no copy; pending: day not corrected
```

**Plan-to-Actual rules:**
- Before seeding, the Actual column renders plan ghosts (live mirror, not persisted).
- Any actual-layer write to day D runs `withAutoSeed`. Seed plus edit form a single transaction and a single undo step.
- After seeding, the two layers are independent. Later plan edits do not propagate.
- Deleting a copy means "skipped". It is never resurrected automatically, only through the explicit "Add missing plan blocks" action.
- "Clear actual" keeps `actualSeededAt` set, so ghosts don't return.
- The Actual column is read-only ghosts for days after today.

**Targets and checklist (`goals/targets.ts`, `goals/checklist.ts`):**

```ts
export function effectiveTarget(rows: readonly WeekTarget[], goalId: Id, weekStart: LocalDate): number | null; // latest row ≤ W; none → null
export function resolveTargets(rows: readonly WeekTarget[], weekStart: LocalDate): Map<Id, number | null>;
export type TargetEditScope = 'this_week' | 'this_and_future';
export function targetEditChanges(s: Snapshot, a: { goalId: Id; weekStart: LocalDate; minutes: number | null; scope: TargetEditScope }, env: Env): ChangeSet;
export function checklistProgress(items: readonly ChecklistItem[]): { done: number; total: number };
export function carryOverChanges(s: Snapshot, fromWeek: LocalDate, toWeek: LocalDate, env: Env): ChangeSet;
// undone items not already carried (matched by carriedFromId) → new items in toWeek
```

- `this_and_future`: upsert row W, then delete later rows for that goal.
- `this_week`: upsert row W, and if no row exists at W+1, upsert W+1 with the old effective value.
- Default scope is `this_and_future` for current and future weeks, and `this_week` for past weeks.
- Creating a goal also writes a target row at the current week.

**Aggregation, status, and review (`review/aggregate.ts`, `goals/status.ts`):**

```ts
export const UNASSIGNED = '__unassigned__' as const; export type GoalKey = Id | typeof UNASSIGNED;
export function minutesByGoal(blocks: readonly Block[], clipFn?: (b: Block) => Interval | null): Map<GoalKey, number>;
// group by (day, layer, goalKey) → unionLength within each group → sum
export type WeekPhase = 'past' | 'current' | 'future';
export function weekPhase(w: WeekRange, today: LocalDate): WeekPhase;
export type GoalStatus = 'no_target'|'met'|'on_track'|'behind'|'missed'|'within'|'at_risk'|'over';
export function goalStatus(a: { kind: TargetKind; target: number | null; phase: WeekPhase;
  planned: number; actualToDate: number; projected: number }): GoalStatus;

export interface GoalWeekRow {
  goalKey: GoalKey; goal: Goal | null; kind: TargetKind; targetMinutes: number | null;
  plannedMinutes: number; actualMinutes: number; plannedRemainingMinutes: number; projectedMinutes: number;
  status: GoalStatus; deltaMinutes: number | null; checklist: { done: number; total: number };
  byDay: Record<LocalDate, { plan: number; actual: number }>;
}
export interface WeekSummary {
  phase: WeekPhase; rows: GoalWeekRow[];   // sorted by goal.sortOrder; UNASSIGNED last
  totals: { planned: number; actual: number; untracked: number; unplanned: number; overlap: { plan: number; actual: number } };
  uncorrectedDays: LocalDate[];           // days ≤ today with plan blocks and no actualSeededAt
  adherence: Record<PlanOutcome | 'unplanned', number>;
}
export function summarizeWeek(i: { week: WeekRange; snapshot: Snapshot; now: Now }): WeekSummary;
```

**Aggregation rules:**
- Only actual blocks on corrected days count as actual. Uncorrected days are listed in `uncorrectedDays`, and the UI offers one-click "Went as planned" for each. There is no silent "assume planned".
- **To-date actual:** actual blocks on days before today, plus today's actual blocks clipped to `[0, now.minute)`.
- **Remaining plan:** plan blocks on days after today, plus today's plan blocks clipped to `[now.minute, 1440)`.
- **Projected** = to-date actual + remaining plan.
- **Row inclusion:** a goal gets a row if it has a non-null effective target and isn't archived (or `archivedOn >= week.start`), or if it has blocks or checklist items that week.
- **Untracked / unplanned** = window length minus the union of all blocks clipped to the window. Untracked is computed only for corrected days up to today, with today's window clipped to now.

**Status rules:**

| Kind | Future week | Current week | Past week |
|---|---|---|---|
| no target (target null) | `no_target` | `no_target` | `no_target` |
| min | planned ≥ T: `on_track`, else `behind` | actualToDate ≥ T: `met`; else projected ≥ T: `on_track`; else `behind` | actual ≥ T: `met`, else `missed` |
| max | planned > T: `at_risk`, else `within` | actualToDate > T: `over`; else projected > T: `at_risk`; else `within` | actual > T: `over`, else `within` |

No tolerance band in the MVP.

**Week and export (`time/localDate.ts`, `time/week.ts`, `export/format.ts`):**

```ts
export function parseLocalDate(s: string): LocalDate | null;  export function addDays(d: LocalDate, n: number): LocalDate;
export function dayOfWeek(d: LocalDate): Weekday;              export function diffDays(a: LocalDate, b: LocalDate): number;
export function formatDay(d: LocalDate, pattern: string, locale?: Locale): string; // date-fns format on UTCDate
export function formatMinute(m: MinuteOfDay): string;          // 'HH:mm', 1440 → '24:00'
export function nowFrom(d: Date): Now;                         // clock.ts only
```

---

## 7. Repository interface and implementations

```ts
export interface Repository {
  init(): Promise<void>;                                          // migrate / hydrate
  loadBase(): Promise<Pick<Snapshot, 'settings'|'goals'|'weekTargets'>>; // targets table is tiny → load all
  loadWeek(weekStart: LocalDate): Promise<Pick<Snapshot, 'blocks'|'dayStates'|'checklist'>>; // days [start, start+7)
  loadBlocksRange(from: LocalDate, toExclusive: LocalDate): Promise<Block[]>; // phase 2 trends
  applyChanges(cs: ChangeSet): Promise<void>;                     // atomic
  changeWeekStart(ws: Weekday): Promise<void>;                    // atomic remap + settings
  exportAll(): Promise<ExportData>;
  replaceAll(d: ExportData): Promise<void>;                       // atomic wipe + bulk insert
}
```

- **`SqliteRepository(driver)`:** maps rows to entities in `mappers.ts` (snake_case to camelCase, 0/1 to boolean). `applyChanges` becomes a single `driver.batch` call.
- **`MemoryRepository(storage = localStorage)`:** holds a full `Snapshot` and uses domain `applyChanges`. It persists `toExport(snapshot)` under one key, debounced at 300 ms. Browser mode is dev-only; localStorage's ~5 MB limit is fine.
- **Write queue (`data/writeQueue.ts`):** all writes go through one serial promise queue, so IPC ordering is guaranteed.

---

## 8. Frontend state (Zustand v5)

- **Slices:**
  - `data`: a Snapshot subset plus `loadedWeeks: Record<LocalDate, 'loading'|'loaded'>`.
  - `ui`: view `'day'|'week'|'goals'|'review'|'settings'`, `focusedDay`, selection. No router in the MVP.
  - `history`: `{ undo: Cmd[], redo: Cmd[] }`, where `Cmd = { label, forward: ChangeSet, inverse: ChangeSet }`.
  - `meta`: `now` (ticks every 60 s), boot status, toast.
- **`commit(label, cs)`:**
  1. `after = applyChanges(before, withAutoSeed(before, cs, env))`
  2. `forward = diff(before, after)`, `inverse = diff(after, before)`
  3. `set(after)` (optimistic), push the command, clear redo
  4. Enqueue `repo.applyChanges(forward)`. On error: `set(applyChanges(current, inverse))`, pop the command, show a toast.
- **Undo** applies `inverse` to the state and the repo, and moves the command to redo. Redo replays `forward`. Bound to Ctrl/Cmd+Z and Ctrl+Shift+Z / Ctrl+Y.
- **Not undoable (they clear history):** import, goal hard-delete (FK cascades reach weeks that aren't loaded), week-start change. Archive is undoable.
- **Drag and resize** keep local component state using the domain `snap`/`moveInterval`, then make one `commit` on pointerup.
- **High-level commands (`state/commands.ts`):**
  - Blocks: `createBlock` (may split at midnight), `updateBlock`, `moveBlockToDay`, `deleteBlock`, `editGhost`, `seedDay`, `markDayAsPlanned`, `resetActualToPlan`, `addMissingPlanBlocks`, `clonePlan`
  - Goals: `createGoal`, `updateGoal`, `archiveGoal`, `reorderGoals` (renumber `sortOrder`)
  - Targets and checklist: `setWeekTarget`, checklist add/toggle/edit/delete/reorder, `carryOver`
  - Settings and data: `updateSettings`, `changeWeekStart`, `importFile`, `exportFile`
- **Boot:** `platform = isTauri() ? tauriPlatform : webPlatform`, then `repo.init()`, `loadBase()`, load the current week and both neighbours, render. If the last backup is more than 24 h old, call `backupNow()`. Prefetch adjacent weeks on navigation.
- **Why not TanStack Query:** there's no server, and optimistic updates plus undo are cleaner in one synchronous store. Context + reducer would cause needless re-renders during drags.

---

## 9. Export/import format

```ts
export const EXPORT_FORMAT = 'plan-actual-goals.export';
export interface ExportFileV1 { format: typeof EXPORT_FORMAT; version: 1; exportedAt: string /*ISO UTC*/; appVersion: string; data: ExportData }
export interface ExportData { settings: Settings; goals: Goal[]; weekTargets: WeekTarget[]; checklistItems: ChecklistItem[]; blocks: Block[]; dayStates: DayState[] }
export function toExport(s: Snapshot, meta: { appVersion: string; nowIso: string }): ExportFileV1; // arrays sorted (id / day,start) for diffable backups
export function parseImport(text: string): { ok: true; file: ExportFileV1; warnings: string[] } | { ok: false; errors: string[] };
export function planMerge(local: Snapshot, incoming: ExportData): { changes: ChangeSet; stats: Record<string, { added: number; updated: number; kept: number }> }; // phase 2
```

The export format version is independent of the DB schema version.

**Import steps:**
1. Run `JSON.parse`, then check `format`.
2. If `version` is newer than the app supports, show an error. Older versions go through the `upgraders[v]` chain.
3. Validate with zod v4 (structure gives hard errors).
4. Run domain `validateBlock`.
5. Repair dangling references with warnings: unknown `goalId` or `sourcePlanBlockId` becomes null, and week keys that don't match `settings.weekStartDay` are normalized with `weekStartOf`.
6. Show a preview of counts and warnings, and get confirmation.
7. Call `backupNow()` in Tauri.
8. Call `repo.replaceAll` (one transaction), clear undo, reload the store.

Merge (phase 2): upsert by id when `incoming.updatedAt > local.updatedAt`. No deletions propagate because there are no tombstones. Incoming week keys are remapped through `remapWeekKey` if the week-start setting differs, and local settings are kept.

In browser mode, export uses a Blob plus `<a download>` and import uses `<input type=file>`. In Tauri, both go through the Rust dialog commands.

---

## 10. File layout

```
package.json  vite.config.ts  vitest.config.ts  tsconfig.json  eslint.config.js  index.html
src/
  main.tsx                      # boot (platform select, migrate, hydrate, render)
  app/App.tsx  app/Shell.tsx    # nav between views, keyboard shortcuts
  domain/
    types.ts  env.ts  changes.ts  index.ts
    time/{localDate,week,clock,minutes}.ts
    blocks/{intervals,layout,edit,validate,planToActual}.ts
    goals/{targets,status,checklist}.ts
    review/aggregate.ts
    export/{format,schema(zod),upgraders,merge}.ts
  data/
    repository.ts  writeQueue.ts
    memory/MemoryRepository.ts
    sqlite/{SqliteRepository,mappers,migrate}.ts  sqlite/migrations/0001_init.sql
    drivers/{SqlDriver,tauriDriver,sqljsDriver}.ts       # sqljsDriver imported only by tests
  platform/{index,tauri,web}.ts
  state/{store,commands,history,selectors}.ts
  features/
    day/{DayView,DayColumn,BlockView,GhostBlock,TimeGutter,NowLine,useBlockDrag,QuickAdd}.tsx
    week/{WeekView,WeekNav}.tsx
    goals/{GoalsPage,GoalEditor,TargetEditor,ChecklistPanel}.tsx
    review/{WeekReview,GoalRow,DayBreakdown,UncorrectedBanner,AdherenceStats}.tsx
    settings/{SettingsPage,ExportImport,DataLocation}.tsx
  ui/{Button,Dialog,ColorSwatch,Toast,…}.tsx
src-tauri/
  Cargo.toml  build.rs  tauri.conf.json  capabilities/default.json  icons/
  src/{main.rs,lib.rs,db.rs,files.rs}
.github/workflows/{ci.yml,release.yml}
```

**Dependencies:**
- Runtime: react 19, zustand 5, date-fns 4, `@date-fns/utc`, zod 4, `@tauri-apps/api` 2.
- Dev: vitest, `@testing-library/react`, jsdom, fast-check, sql.js, `@tauri-apps/cli` 2, eslint, typescript.
- The timeline uses hand-written pointer-event drag (domain math); dnd-kit is optional for list reordering.

---

## 11. Test strategy (Vitest)

**Setup:**
- Scripts run as `TZ=Europe/Berlin vitest run`.
- CI repeats the domain tests in a timezone matrix: `UTC`, `Europe/Berlin`, `America/Los_Angeles`, `Asia/Kolkata`, `Pacific/Chatham`. This catches accidental use of local-time `Date`.
- Domain and data tests use the `node` environment; components use `jsdom`.

**`time/localDate`, `time/week`:**
- `addDays`: 2026-03-28+1 = 03-29, 03-29+1 = 03-30, 2026-10-25+1 = 10-26, 2026-11-01+1 = 11-02, 2026-12-31+1 = 2027-01-01, 2028-02-28+1 = 02-29.
- `weekStartOf('2026-10-18' (a Sunday), 1)` = `2026-10-12`; with start day 0 it's `2026-10-18`; `weekStartOf('2027-01-01', 1)` = `2026-12-28`.
- `weekRange('2026-10-19')` has 7 distinct days and ends `2026-10-25` (the DST week).
- `remapWeekKey('2026-10-12', 0)` = `'2026-10-11'`; `('2026-10-11', 1)` = `'2026-10-12'`; `('2026-10-12', 6)` = `'2026-10-10'`.
- Property (fast-check): `remapWeekKey` is injective over 500 consecutive weeks, and every mapped week overlaps the old one by at least 4 days.
- `nowFrom(new Date(2026, 2, 29, 3, 30))` under Berlin = `{day: '2026-03-29', minute: 210}`.

**Intervals and layout:**
- Union cases: empty, disjoint, nested, identical duplicates; touching `[60,120]` + `[120,180]` gives a union of 120 and an overlap of 0.
- `clip`, `gaps`.
- Properties: `unionLength ≤ Σlen`, `unionLength` is idempotent under duplication, and `gaps` + union = the window.
- `layoutLanes`: A 9–11, B 10–12, C 11–13 gives A=0, B=1, C=0 with laneCount 2; touching blocks don't share a cluster.

**Aggregation:**
- Thesis 9–11 + Thesis 10–12 gives 180, not 240.
- Thesis 9–11 + Exercise 10–11 gives Thesis 120, Exercise 60, tracked 120, overlap 60.
- Unassigned bucket.
- Blocks outside the week are ignored.
- A block outside the visible window counts toward its goal but not toward untracked.
- DST policy: 01:30–03:30 on 2026-03-29 counts 120.

**Status:**
- Min, past: met / missed.
- Min, current: `{actualToDate: 600, remaining: 400}` with T=900 is `on_track`, T=1200 is `behind`, and actualToDate ≥ T is `met`.
- Max (T=180):
  - past actual 200 → `over`
  - current 100 + remaining 120 → `at_risk`
  - actualToDate 181 → `over`
  - future planned 200 → `at_risk`
- Max T=0: 0 → `within`, 1 → `over`. Target null → `no_target`.
- Now clipping: actual 13:00–15:00 with now 14:00 gives actualToDate 60, and the same plan block gives remaining 60.
- An unseeded past day has actual 0 and appears in `uncorrectedDays`.

**Targets:**
- Rows W1=600 and W3=900 resolve to: W0 null, W2 600, W3 900, W5 900.
- `this_week` edit at W2 writes W2 plus W3 (old value) only when W3 has no row.
- `this_and_future` deletes later rows.
- A goal archived on 2026-10-14 still appears in the review for week 10-12, and not in 10-19 unless it has data.

**Plan to Actual:**
- Seed copies every plan block (new ids, `sourcePlanBlockId` set, same fields) and sets `actualSeededAt`.
- **Idempotency:** `missingPlanCopies` run a second time returns `[]`, and seeding a seeded day is a no-op.
- After deleting one copy, add-missing returns just that one.
- A plan block added after seeding is not auto-added, but add-missing returns only it.
- Reset results in actual == plan copies.
- An empty plan day seeds to zero copies, stays seeded, and shows no ghosts.
- `editGhostChanges` produces one ChangeSet, and undoing it restores the unseeded state.
- `planOutcomes`: as_planned, adjusted (moved 15 min), adjusted (goal changed), skipped, plus the unplanned count.

**Edit and validate:**
- `snap(7,15)=0`, `snap(8,15)=15`.
- A move near 24:00 clamps and keeps the duration.
- A resize below minLen clamps; resizing to 1440 is OK.
- `splitAtMidnight(D, 1380, 480)` gives two parts.
- Durations of 0 and 1441 throw.
- A start of 1440 is invalid.
- An archived goal is rejected on a new block and allowed on an old one.

**Changes:**
- `diff(s, apply(s, cs))` applied to `s` equals `apply(s, cs)`; applying `inverse` gets back to `s` (property-based over random ChangeSets).
- Goal-delete cascade nulls `goalId` and deletes its targets and checklist.
- Plan-block delete nulls the copies' source.

**Checklist:** progress; `carryOver` is idempotent, skips done items, and links `carriedFromId`.

**Export:**
- Export then `parseImport` then `replaceAll` then export gives an identical result (ignoring `exportedAt`).
- Wrong format or a newer version is rejected.
- A dangling `goalId` is repaired with a warning.
- Misaligned week keys are normalized.

**Repository contract suite** (runs against `MemoryRepository` and against `SqliteRepository(sqljsDriver(':memory:'))`):
- Migrate twice leaves `user_version` = 1, and the second run is a no-op.
- `applyChanges` with one CHECK-violating row leaves the DB unchanged (atomicity).
- `loadWeek` returns exactly 7 days.
- `changeWeekStart` remaps targets and checklist.
- `replaceAll` wipes the old data.
- Deleting a plan block nulls the actual copy's source.

**Store:**
- An optimistic update is visible before the write resolves.
- A rejected write rolls back and shows a toast.
- Undo/redo of a move works.
- Auto-seed plus edit is one undo step.
- Writes stay serialized in order.

**Rust:** `cargo test` for JSON-to-SQL value conversion and batch rollback. CI also runs `cargo clippy -D warnings`.

---

## 12. Implementation sequence and risks

**Sequence:**
1. Scaffold with create-tauri-app (react-ts) and add CI.
2. Domain time and intervals, with tests.
3. Changes, snapshot, and export format.
4. MemoryRepository and the store. Browser mode works from this point, so UI work can start.
5. Rust bridge and SqliteRepository, plus the contract tests.
6. Features: Day (Plan | Actual), then Goals/Targets/Checklist, then Review, then Settings/Export.
7. `release.yml` with tauri-action on tags.

**Risks and notes:**
- Fedora needs `webkit2gtk4.1-devel libsoup3-devel openssl-devel librsvg2-devel libappindicator-gtk3-devel libxdo-devel` and the C toolchain before `tauri dev`.
- A blank WebKitGTK window on Wayland/NVIDIA can be worked around with `WEBKIT_DISABLE_DMABUF_RENDERER=1`.
- The bundle identifier must not end in `.app`.
- Check that `crypto.randomUUID` exists in each webview; the fallback is there.
- Big imports go over IPC as JSON, which is why inserts are chunked.
- If Safari ships Temporal, `localDate.ts` is the only file to swap.

Sources:
- [tauri-plugin-sql docs](https://v2.tauri.app/plugin/sql/)
- [plugins-workspace #886 (no transactions)](https://github.com/tauri-apps/plugins-workspace/issues/886)
- [single-connection fix PR (fork)](https://github.com/han4wluc/plugins-workspace/pull/3)
- [Temporal browser support](https://web-platform-dx.github.io/web-features-explorer/features/temporal/)
- [Safari TP 249 Temporal](https://webkit.org/blog/18182/release-notes-for-safari-technology-preview-249/)
- [date-fns v4 time zones / UTCDate](https://blog.date-fns.org/v40-with-time-zone-support/)
- [rusqlite](https://docs.rs/crate/rusqlite/latest)
- [sql.js releases](https://github.com/sql-js/sql.js/releases)
- [zustand](https://www.npmjs.com/package/zustand)
- [Tauri capabilities](https://v2.tauri.app/security/capabilities/)
- [Tauri dialog plugin](https://v2.tauri.app/plugin/dialog/)
- [@tauri-apps/api core (isTauri)](https://v2.tauri.app/reference/javascript/api/namespacecore/)

### Critical Files for Implementation
- /home/shrey/Documents/Codes/calendar_goals_webapp/src/domain/changes.ts
- /home/shrey/Documents/Codes/calendar_goals_webapp/src/domain/review/aggregate.ts
- /home/shrey/Documents/Codes/calendar_goals_webapp/src/domain/blocks/planToActual.ts
- /home/shrey/Documents/Codes/calendar_goals_webapp/src/data/sqlite/SqliteRepository.ts (with migrations/0001_init.sql)
- /home/shrey/Documents/Codes/calendar_goals_webapp/src-tauri/src/db.rs