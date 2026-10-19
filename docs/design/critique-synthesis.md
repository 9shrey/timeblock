# Implementation plan: Timeblock (Plan | Actual time-blocking with weekly goals). Tauri 2, React and TypeScript

## 0. Lead-architect review

### 0.1 Contradictions resolved

| # | Topic | Positions | Decision | Why |
|---|---|---|---|---|
| 1 | How "Actual starts as a copy of the plan" works | B copies the whole day on the first edit, using a `day_states` table. C uses per-block virtual ghosts and a `review_state` field. | **Per-block ghosts (C), stored as a `skipped` flag on plan blocks. No `day_states` table.** | Ghosts keep following plan edits until each one is confirmed. That matters when you correct the same day you planned. It also removes the whole-day copy step, and "corrected" can be derived. |
| 2 | Overlaps in the Actual lane | B allows overlaps, laid out in lanes, with hours counted as a union. C "carves" (the lane is exclusive). | **Allow overlaps, render them in lanes, aggregate with a union per (day, goal). The only carving is in "confirm ghost": the ghost's interval minus existing actual intervals.** | General carving is the most complex interaction in C. Subtracting at confirm time gets most of its value. |
| 3 | Unconfirmed past plan in the totals | C counts it as assumed actual (a setting, drawn hatched). B never counts it. | **It never counts as actual. Show "unconfirmed" separately, hatched. `projected` includes it.** | The numbers stay honest and there is no setting to explain. |
| 4 | Targets model | B: carry-forward rows plus a this-week / this-and-future scope picker. C: a goal default plus per-week overrides, with kind per week. | **Carry-forward rows with one rule: an edit at week W upserts row W. `kind` lives on the goal. No scope picker.** | Editing a target never rewrites past reviews, and there is no extra dialog. |
| 5 | Database driver for tests and browser mode | A: `node:sqlite`. B: sql.js for tests plus a localStorage `MemoryRepository`. | **sql.js for both Vitest and browser dev mode. Only one Repository: `SqliteRepository`.** | Real SQL and migrations run in every mode, and you don't maintain a second store that must behave identically. |
| 6 | Migrations | A: `rusqlite_migration` in Rust. B: TypeScript, via `user_version`. | **TypeScript `migrate.ts` using `PRAGMA user_version`.** | The same migration code runs under sql.js tests, browser mode and the app. |
| 7 | File export/import | A: the JS dialog and fs plugins, plus permissions. B: Rust-side dialog plus `std::fs`. | **Rust-side (B). The `tauri-plugin-dialog` crate is used from Rust only. No fs plugin.** | No JS file permissions and fewer plugins. |
| 8 | Undo | B: diff whole snapshots. C: `Command{do, undo}`. | **ChangeSets. The inverse is captured from the rows as they were before the change. No snapshot diffing and no in-memory cascades.** | One ChangeSet maps to one `db_batch`, and it is easy to test. |
| 9 | Settings storage | B: one typed row. C: key/value. | **Key/value with JSON values, parsed by zod with defaults.** | A new setting needs no migration. |
| 10 | `dragDropEnabled` | A: set it to false or use pointer events. C: keep it true for importing by dropping a file on the window. | **`false`.** File-drop import is post-MVP. | Nothing in the MVP needs OS file drop, and this avoids WebView2 intercepting HTML5 drag-and-drop. |
| 11 | Date library | B: date-fns 4 plus `@date-fns/utc`. | **No library.** Use `Date.UTC` for arithmetic and `Intl.DateTimeFormat({timeZone:'UTC'})` for formatting. | It is about 8 small functions. |
| 12 | Linux environment workaround | A: auto-set a variable in `main.rs`. B: set `WEBKIT_DISABLE_DMABUF_RENDERER`. | **Nothing hard-coded. Document it in the README.** Add the guarded `__NV_DISABLE_EXPLICIT_SYNC` only if dev shows Error 71. | A's own research found the DMABUF flag causes flicker on WebKitGTK 2.54. |
| 13 | Week view modes | C: Auto / Plan / Actual / Split. | **Auto only.** Past days and today are split P\|A; future days show the plan full width. | Scope. |
| 14 | Week start | B: Mon/Sun/Sat, remapped by an algorithm. C: Mon/Sun. | **Mon/Sun/Sat. Remap with 3 `UPDATE … date(week_start, '<c> days')` statements in one batch.** | Aligned keys all shift by the same constant `c`, which is in [-3, 3], so keys can't collide. |
| 15 | Midnight | B: quick-add splits at midnight. | **Blocks never cross midnight. Dragging clamps to [0, 1440]. No quick-add in the MVP.** | Scope. |
| 16 | Is a day "reviewed"? | B: `reviewed_at` column. C: derived. | **Derived: a day ≤ today with no unconfirmed ghosts.** | No extra state. |
| 17 | Minimum window size | A: 900×600. C: 960×640. | **960×640.** | The two-column Day view needs the width. |

### 0.2 Fact-check and corrections (spot-checked 2026-10-18)

- **The project directory is not empty.** It contains `.claude/settings.local.json`. I read the create-tauri-app source: with `--yes` the overwrite answer is `false`, so it aborts; with `--force` it deletes everything except `.git`, including `.claude`. **So scaffold into the scratchpad and copy the files in** (M0).
- **Theme:** `getCurrentWindow().theme()` needs **`core:window:allow-theme`**. It is not part of `core:window:default` (checked in the Tauri ACL reference). Theme detection on Linux reads the freedesktop `color-scheme` over D-Bus through tao's default `dbus` feature (confirmed). Never call `setTheme` on Linux (tao #1382).
- **CI actions:**
  - `actions/setup-node` is now at **v7** (v7.1.0, 2026-10-08), not v6.
  - `actions/checkout@v7` and the floating tag `tauri-apps/tauri-action@v1` both exist.
  - `ubuntu-22.04` is removed on 2027-04-17, so use `ubuntu-24.04`. AppImages built there need glibc 2.39 or newer.
- **CI gotcha:** `tauri::generate_context!` reads `frontendDist` at compile time. In CI, run `npm run build` before `cargo clippy` or `cargo test`, or the build fails.
- **Versions confirmed:**
  - `tauri` 2.12.4 (2026-10-14). Avoid 3.0-alpha.
  - `rusqlite` 0.40.2.
  - sql.js 1.15.0 bundles SQLite 3.54, so `STRICT` tables work.
  - `isTauri()` has been in `@tauri-apps/api/core` since 2.0.0.
- **Opener plugin:** `opener:default` includes `allow-reveal-item-in-dir`, which is enough for "Open data folder".
- **Dialog API:** `FileDialogBuilder::blocking_save_file()` and `blocking_pick_file()` return `Option<FilePath>`, and `FilePath::into_path()` returns `Result<PathBuf>`. They must not run on the main thread; `async` commands run off it, so that's fine.
- **Config schema:** `dangerousDisableAssetCspModification` accepts a bool or a list of directives; `version` can point to `../package.json`; `dragDropEnabled` defaults to true.
- **Fedora:**
  - Already installed: gcc, g++, make, openssl-devel, file, curl, gtk3-devel. So `dnf group install c-development` is unnecessary.
  - Missing: webkit2gtk4.1-devel, libappindicator-gtk3-devel, librsvg2-devel, libxdo-devel (exists for F44), wget.
- **Moot parts of A:** everything about tauri-plugin-sql, plus the fs plugin and the JS dialog permissions.

### 0.3 Cut from the MVP (over-engineering or scope creep)

- **Cut from B:**
  - `MemoryRepository` and the dual contract suite
  - `diffSnapshots`
  - `day_states`
  - the target scope picker
  - `splitAtMidnight` and quick-add
  - totals for untracked time, overlap and adherence
  - the import upgrader chain (v1 only)
  - merge-import
  - the 5-timezone CI matrix (2 timezones is enough)
- **Cut from C:**
  - general carve
  - magnets
  - drift ribbons and the link gutter
  - command palette
  - onboarding wizard and nudges
  - 4 week modes
  - keyboard slot cursor
  - cross-lane drag
  - drift / replaced / biggest-gaps sections
  - 12-hour time
  - zoom levels

---

## 1. Context

This is a local-first, single-user desktop app (Tauri 2 with React and TypeScript), to be open-sourced. Each day has two columns, Plan and Actual. Actual starts as ghost copies of the plan, and you correct it by dragging, resizing, deleting or adding blocks. Blocks are tagged with goals. Each goal has carry-forward weekly hour targets (a minimum or a maximum) and a per-week outcome checklist. The weekly review compares target, planned and actual hours per goal, and shows checklist progress.

## 2. Key decisions

| Decision | Choice | Why |
|---|---|---|
| Shell | Tauri 2.x (latest 2.12), template `react-ts`, edition 2024 | Already decided; the version is verified |
| Persistence | Rust `rusqlite 0.40 {bundled}` behind 3 generic commands (`db_select`, `db_batch`, `db_exec_script`). All SQL lives in TypeScript. | Real transactions. Rust stays schema-agnostic. |
| DB location | `app_data_dir()/data.sqlite3`, which on Linux is `~/.local/share/<identifier>/` | Our choice; WAL mode |
| Test and browser driver | sql.js (dev dependency), loaded only when `import.meta.env.DEV && !isTauri()` | One repository implementation. Release builds don't include sql.js. |
| Time model | `day: 'YYYY-MM-DD'` plus `startMinute`/`endMinute` (0..1440), wall-clock | Planner semantics. On DST days durations follow the wall clock (documented). |
| Plan↔Actual | Ghosts are derived. Actual blocks link back with `plan_block_id` (same day only). Plan blocks have a `skipped` flag. | Satisfies "a skipped plan block has no counterpart" |
| Overlaps | Allowed and laid out in lanes. Hours are a union per (day, goal). | Simple and correct |
| Targets | `week_targets` carry-forward rows; `kind` (min/max) lives on the goal | Past weeks never change |
| State | Zustand: normalized entities, optimistic `commit(ChangeSet)`, serial write queue, undo/redo up to 100 steps | No server, so no need for TanStack Query |
| Timeline | Custom Pointer Events with absolute positioning. No calendar library, no dnd-kit, no HTML5 drag-and-drop. | Control over ghosts and split columns. FullCalendar's resource view is AGPL. |
| UI kit | Tailwind v4 (`@tailwindcss/vite`) plus shadcn/ui components (whatever primitives `init` defaults to) plus sonner | Accessible popovers and menus without writing focus handling by hand |
| Charts | Hand-written SVG (`BulletBar`) | About 60 lines |
| Validation | zod (latest) for import files and settings | |
| Files | Rust commands use `tauri-plugin-dialog` from Rust and `std::fs` | No fs plugin |
| Capabilities | `core:default`, `core:window:allow-theme`, `opener:default` | App commands are allowed by default |
| Release | `tauri-action@v1` on `v*` tags, matrix of ubuntu-24.04, macos-latest (universal) and windows-latest. Draft release, unsigned, macOS ad-hoc signed. | Verified |
| Identifier / name | `io.github.<ghuser>.timeblock`; productName "Timeblock"; MIT license. **The user should confirm these before the first tag.** | The identifier fixes the data path |

## 3. One-time setup the user runs

```fish
# Tauri Linux build deps (official Fedora list; already-installed ones are no-ops; gcc/g++/make already present)
sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file libappindicator-gtk3-devel librsvg2-devel libxdo-devel
rpm -q webkit2gtk4.1-devel libsoup3-devel javascriptcoregtk4.1-devel   # all three should print versions
```

- **Decide three things:** your GitHub username (it goes into the identifier), the app name, and the license. The defaults above are used otherwise.
- **Before M8:**
  - Create the GitHub repo and push it (`gh repo create <name> --public --source . --push`).
  - Set Repo → Settings → Actions → General → Workflow permissions → **Read and write**.
- **Only if the dev window is blank or logs `Error 71`:** run `__NV_DISABLE_EXPLICIT_SYNC=1 npm run tauri dev` (see Risks).

## 4. Architecture and file layout

```
calendar_goals_webapp/
  .claude/{settings.local.json (keep, gitignored), launch.json  ← {"name":"web","runtimeExecutable":"npm","runtimeArgs":["run","dev"],"port":1420}}
  .github/workflows/{ci.yml, release.yml}
  README.md  LICENSE  CHANGELOG.md  .gitignore  eslint.config.js  vite.config.ts  tsconfig*.json  components.json  index.html  package.json
  src/
    main.tsx                         # boot: platform → repo.init → loadBase → load week ±1 → backup_if_stale → render
    app/{App,Shell,NavRail,TopBar}.tsx  app/shortcuts.ts
    styles/index.css                 # @import "tailwindcss"; dark variant on [data-theme=dark]; goal tokens via color-mix
    domain/                          # pure, no I/O, no Date except time/clock.ts
      types.ts env.ts changes.ts
      time/{localDate,clock}.ts
      blocks/{intervals,layout,edit,validate,reconcile}.ts
      goals/{targets,checklist,palette}.ts
      stats/stats.ts
      export/{format,schema}.ts
      **/*.test.ts
    data/
      drivers/{SqlDriver,tauriDriver,sqljsDriver}.ts
      migrations/0001_init.sql       # imported with ?raw
      migrate.ts  SqliteRepository.ts  mappers.ts  writeQueue.ts  devSeed.ts
      repository.test.ts             # contract tests on sqljsDriver(':memory:')
    platform/{index,tauri,web}.ts    # saveTextFile, openTextFile, backupNow, backupIfStale, revealDataDir, appVersion, systemTheme
    state/{store,commands,history,selectors,draft}.ts
    features/
      timeline/{Timeline,LaneColumn,BlockView,GhostBlock,DraftLayer,TimeGutter,NowLine,BlockPopover,BlockContextMenu}.tsx
      timeline/{dragMachine.ts (pure reducer), useDrag.ts, geometry.ts}
      day/{DayView,DaySummaryBar}.tsx
      week/{WeekView,DayHeader}.tsx
      goals/{GoalsPage,GoalRow,GoalDialog,Checklist,WeekBudgetPanel}.tsx
      review/{ReviewPage,GoalTable,BulletBar,UnconfirmedBanner}.tsx
      settings/{SettingsPage,DataSection}.tsx
    components/ui/*                  # shadcn-generated
  src-tauri/
    Cargo.toml build.rs tauri.conf.json capabilities/default.json icons/
    src/{main.rs, lib.rs, db.rs, files.rs}
```

**Data flow:** UI → `state/commands.ts`, which builds a ChangeSet using domain functions → `store.commit()` (optimistic apply and history) → `writeQueue` → `SqliteRepository.applyChanges` → `driver.batch` → (Tauri) `invoke('db_batch')` → one rusqlite transaction.

**Rust surface (`db.rs`, `files.rs`):**

```rust
pub struct Db(pub std::sync::Mutex<rusqlite::Connection>);   // opened in setup(): WAL, foreign_keys=ON, synchronous=NORMAL, busy_timeout=5000
#[derive(Deserialize)] pub struct Stmt { sql: String, #[serde(default)] params: Vec<serde_json::Value> }
#[tauri::command] async fn db_select(db: State<'_, Db>, sql: String, params: Vec<Value>) -> Result<Vec<Map<String, Value>>, String>;
#[tauri::command] async fn db_batch(db: State<'_, Db>, stmts: Vec<Stmt>) -> Result<(), String>;      // tx; PRAGMA defer_foreign_keys=ON; execute each; commit
#[tauri::command] async fn db_exec_script(db: State<'_, Db>, sql: String) -> Result<(), String>;     // tx.execute_batch (migrations)
#[tauri::command] async fn backup_now(app: AppHandle, db: State<'_, Db>, reason: String) -> Result<String, String>; // VACUUM INTO backups/data-<unix>-<reason>.sqlite3; keep newest 14
#[tauri::command] async fn backup_if_stale(app: AppHandle, db: State<'_, Db>, max_age_hours: u64) -> Result<Option<String>, String>; // newest file mtime (SystemTime, no chrono)
#[tauri::command] async fn save_text_file(app: AppHandle, default_name: String, contents: String) -> Result<Option<String>, String>; // dialog().file().add_filter("JSON",&["json"]).set_file_name(..).blocking_save_file()?.into_path() → fs::write
#[tauri::command] async fn open_text_file(app: AppHandle) -> Result<Option<String>, String>;  // blocking_pick_file → read_to_string
#[tauri::command] fn data_dir(app: AppHandle) -> Result<String, String>;
```

- **Value mapping, JSON to SQL:**
  - `null` → NULL
  - an integral number → `i64`
  - any other number → `f64`
  - a string → TEXT
  - a bool is an error (TypeScript sends 0/1)
- **Value mapping, rows out:** Integer and Real become numbers, Text becomes a string, NULL becomes null, and a BLOB is an error.
- **Argument names:** JS passes camelCase (`{ defaultName, maxAgeHours }`).
- **Async commands** that take `State` must return `Result`.

**SqlDriver (TypeScript):**

```ts
type SqlValue = string | number | null;
interface Stmt { sql: string; params?: SqlValue[] }   // positional `?`
interface SqlDriver { select<T>(sql: string, p?: SqlValue[]): Promise<T[]>; batch(s: Stmt[]): Promise<void>; execScript(sql: string): Promise<void> }
```

- The **sqljs driver** runs `BEGIN…COMMIT` or `ROLLBACK`.
- It sets `PRAGMA foreign_keys=ON` when the database opens.
- In the browser it persists `db.export()` as base64 in localStorage, debounced to 300 ms.

**tauri.conf.json essentials:**
- `productName` "Timeblock"; `version` "../package.json"; `identifier`.
- `app.windows[0]`: `{label:"main", title:"Timeblock", width:1280, height:860, minWidth:960, minHeight:640, dragDropEnabled:false}`. Leave `transparent` at its default (false).
- `app.security.csp`:
  - `"default-src": "'self'"`
  - `"script-src": "'self'"`
  - `"style-src": "'self' 'unsafe-inline'"`
  - `"img-src": "'self' data:"`
  - `"connect-src": "ipc: http://ipc.localhost"`
- Also under `app.security`: `"devCsp": null` and `"dangerousDisableAssetCspModification": ["style-src"]`. The last one stops Tauri's nonce from neutralizing `'unsafe-inline'` for styles that libraries inject at runtime; verify it in M8.
- `bundle`: `targets "all"`, `category "Productivity"`, `license "MIT"`, `macOS.signingIdentity "-"`, icons.

**`capabilities/default.json`:** `{"identifier":"default","windows":["main"],"permissions":["core:default","core:window:allow-theme","opener:default"]}`

## 5. Data model

**Final DDL** (`src/data/migrations/0001_init.sql`; `migrate.ts` appends `PRAGMA user_version = 1;` and runs the whole script in one transaction):

```sql
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT, WITHOUT ROWID;  -- JSON values

CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  color TEXT NOT NULL CHECK (color GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
  kind TEXT NOT NULL DEFAULT 'min' CHECK (kind IN ('min','max')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived_on TEXT,                                  -- LocalDate; NULL = active
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE week_targets (                          -- applies to week_start and later weeks until the next row
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,
  target_minutes INTEGER CHECK (target_minutes IS NULL OR target_minutes BETWEEN 0 AND 10080), -- NULL = tracked only
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (goal_id, week_start)
) STRICT, WITHOUT ROWID;

CREATE TABLE checklist_items (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,
  text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 500),
  done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  carried_from_id TEXT,                              -- informational, no FK
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_checklist_week ON checklist_items(week_start, goal_id, sort_order);

CREATE TABLE blocks (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  layer TEXT NOT NULL CHECK (layer IN ('plan','actual')),
  start_minute INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute INTEGER NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
  title TEXT NOT NULL DEFAULT '' CHECK (length(title) <= 200),   -- '' → display goal name
  goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  plan_block_id TEXT REFERENCES blocks(id) ON DELETE SET NULL,   -- actual only; same day (domain-enforced)
  skipped INTEGER NOT NULL DEFAULT 0 CHECK (skipped IN (0,1)),   -- plan only
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  CHECK (end_minute > start_minute),
  CHECK (layer = 'actual' OR plan_block_id IS NULL),
  CHECK (layer = 'plan' OR skipped = 0)
) STRICT;
CREATE INDEX idx_blocks_day  ON blocks(day, layer, start_minute);
CREATE INDEX idx_blocks_plan ON blocks(plan_block_id) WHERE plan_block_id IS NOT NULL;
CREATE INDEX idx_blocks_goal ON blocks(goal_id);

CREATE TABLE week_notes (week_start TEXT PRIMARY KEY, text TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL) STRICT, WITHOUT ROWID;
```

**Write patterns:**
- Every entity is written with `INSERT … ON CONFLICT(<pk>) DO UPDATE SET …`.
- Import inserts multi-row `VALUES` in chunks of 100 rows, in FK order: goals, targets, checklist, plan blocks, actual blocks, notes, settings.

**Migration flow:**
1. Read `PRAGMA user_version`.
2. If it is higher than the app knows about, refuse to start ("data from a newer version").
3. If any migration is pending and the version is at least 1, call `backup_now('pre-migration')`.
4. Run `execScript` for each pending migration.

**Core TypeScript types (`domain/types.ts`):**

```ts
type Id = string; type LocalDate = string & { readonly __brand: 'LocalDate' }; type Minute = number; type EpochMs = number;
type Weekday = 0|1|2|3|4|5|6; type Layer = 'plan'|'actual'; type GoalKind = 'min'|'max';
interface Settings { weekStartDay: 0|1|6; dayStartMinute: Minute; snapMinutes: 5|10|15|30; defaultBlockMinutes: number; theme: 'system'|'light'|'dark' }
interface Goal { id: Id; name: string; color: string; kind: GoalKind; sortOrder: number; archivedOn: LocalDate|null; createdAt: EpochMs; updatedAt: EpochMs }
interface WeekTarget { goalId: Id; weekStart: LocalDate; targetMinutes: number|null; updatedAt: EpochMs }
interface ChecklistItem { id: Id; goalId: Id; weekStart: LocalDate; text: string; done: boolean; sortOrder: number; carriedFromId: Id|null; createdAt: EpochMs; updatedAt: EpochMs }
interface Block { id: Id; day: LocalDate; layer: Layer; startMinute: Minute; endMinute: Minute; title: string; goalId: Id|null; notes: string;
                  planBlockId: Id|null; skipped: boolean; createdAt: EpochMs; updatedAt: EpochMs }
interface WeekNote { weekStart: LocalDate; text: string; updatedAt: EpochMs }
interface Ghost { planId: Id; day: LocalDate; startMinute: Minute; endMinute: Minute; goalId: Id|null; title: string }   // derived, never stored
type PlanState = 'pending'|'unconfirmed'|'done'|'adjusted'|'skipped';
interface Now { day: LocalDate; minute: Minute }
interface Env { newId(): Id; nowMs(): EpochMs }     // newId = crypto.randomUUID with getRandomValues fallback
type Table = 'block'|'goal'|'weekTarget'|'checklistItem'|'weekNote'|'setting';
type Change = { op: 'put'; table: Table; row: Row } | { op: 'del'; table: Table; key: string };  // weekTarget key = `${goalId}|${weekStart}`
type ChangeSet = readonly Change[];
interface ExportFileV1 { format: 'timeblock.export'; version: 1; exportedAt: string; appVersion: string;
  data: { settings: Settings; goals: Goal[]; weekTargets: WeekTarget[]; checklistItems: ChecklistItem[]; blocks: Block[]; weekNotes: WeekNote[] } }
interface Repository {
  init(): Promise<void>; loadBase(): Promise<{ settings: Settings; goals: Goal[]; weekTargets: WeekTarget[] }>;
  loadWeek(ws: LocalDate): Promise<{ blocks: Block[]; checklist: ChecklistItem[]; note: WeekNote|null }>;
  applyChanges(cs: ChangeSet): Promise<void>; changeWeekStart(from: Weekday, to: Weekday): Promise<void>;
  goalUsage(goalId: Id): Promise<number>; exportAll(): Promise<ExportFileV1['data']>; replaceAll(d: ExportFileV1['data']): Promise<void>;
}
```

## 6. Domain logic (pure; ESLint bans `new Date`/`Date.now` outside `time/clock.ts`, `platform/` and tests)

**`time/localDate.ts`:**
- `parseLocalDate(s)` accepts only real `YYYY-MM-DD` dates, otherwise returns null.
- `addDays(d, n)` and `diffDays(a, b)` use `Date.UTC`, so DST never affects them.
- `dayOfWeek(d)` returns 0 for Sunday.
- `weekStartOf(d, ws)`, `weekDays(start)` (returns 7 dates), `isoWeek(d)` (used only for labels).
- `weekShiftDays(fromWs, toWs) = 3 - ((((fromWs+3)%7) - toWs + 7) % 7)` gives a value in [-3, 3]. It drives `changeWeekStart` through `UPDATE … SET week_start = date(week_start, ?||' days')` on `week_targets`, `checklist_items` and `week_notes`.
- `formatDay(d, opts)` uses Intl with `timeZone: 'UTC'`.
- `formatMinute(m)` returns 'HH:mm', with 1440 shown as '24:00'.
- `formatDuration(min)` returns strings like '3h', '45m', '9h30'.
- `parseTimeInput('915'|'9:15'|'9.15')` returns a minute value or null.

**`time/clock.ts`:** `nowFrom(d: Date): Now` is the only place that reads local time. In dev builds a `?now=YYYY-MM-DDTHH:mm` URL parameter overrides it. The store ticks every 60 s.

**`blocks/intervals.ts`:** intervals are half-open, `[start, end)`.
- `merge`
- `unionLength`
- `subtract(a, bs)`, which returns `Interval[]`
- `clip`

**`blocks/layout.ts`:** `layoutLanes(blocks)` returns `Map<Id, {lane, laneCount}>`. It sorts by (start, −length), groups transitively overlapping blocks into clusters, and assigns lanes first-fit. Touching blocks do not overlap.

**`blocks/edit.ts`:**
- `snap(m, step)` rounds and clamps to [0, 1440].
- `moveInterval(iv, delta, step)` keeps the duration and clamps.
- `resizeInterval(iv, edge, to, step, minLen = step)`.
- `pxToMinute(y, pxPerMin)`.

**`blocks/validate.ts`:** `validateBlock(b, ctx)` returns issues from this list:
- `invalid_date`
- `out_of_range`
- `end_not_after_start`
- `title_too_long`
- `unknown_goal`
- `archived_goal` (only for a new block, or when the goal changed)
- `bad_link` (the link does not point to a same-day plan block)
- `layer_field_mismatch`

**`blocks/reconcile.ts`** (Plan↔Actual rules, the core of the app):

- **Ghosts:** `ghostsOf(plan, actual)` returns every plan block that is not skipped and has no actual block with `planBlockId == plan.id`. A ghost is drawn in its day's Actual lane at the plan's interval.
- **`planState(plan, linked, now)`:**
  - `skipped` if the plan block is skipped.
  - `done` if it has exactly one linked actual with the same start, end and goal.
  - `adjusted` if it has linked actual(s) that differ.
  - `unconfirmed` if it is a ghost that has ended (an earlier day, or today with `end ≤ now`).
  - Otherwise `pending`.
- **`confirmGhostChanges(s, planId, env)`:** take the plan interval minus the existing actual intervals on that day. That leaves 0..n pieces; pieces of 5 minutes or more become linked actual blocks. If no piece is left, the plan block is marked skipped.
- **`materializeGhostChanges(s, planId, patch, env)`:** inserts a linked actual with the plan's fields plus the patch. It is used when a ghost is dragged, resized or edited, and does no subtraction.
- **`skipChanges` / `restoreChanges(planId)`:** toggle `skipped`.
- **`deleteBlockChanges(s, id)`:**
  - Deleting a plan block also explicitly unlinks its actual blocks (they become unplanned).
  - Deleting an actual block that was the last link of plan P also sets `P.skipped = 1`, so the ghost doesn't reappear.
- **`moveBlockChanges(s, id, {day, start, end}, copy, env)`:**
  - A cross-day move unlinks the pair. Links are always same-day. A moved plan block also gets `skipped = 0`.
  - A copy gets a new id. A plan copy has `skipped = 0`; an actual copy is unlinked.
- **`confirmRestOfDayChanges(s, day, now, env)`:** runs `confirmGhost` for every ghost on an earlier day, or with `end ≤ now.minute` today. The result is one ChangeSet, so one undo step.
- **`copyPlanChanges(s, from, to, env)`:** clones the plan blocks with new ids and `skipped = 0`.
- **Plan edits after linking** do not propagate. Actual lanes for days after today are read-only.

**`goals/targets.ts`:**
- `effectiveTarget(rows, goalId, week)` returns `{minutes|null, fromWeek|null}`, taken from the latest row with `week_start ≤ week`.
- `setTargetChanges(goalId, week, minutes|null)` upserts row W.
- Creating a goal writes a target row for the week being viewed.

**`goals/checklist.ts`:**
- `progress(items)` returns `{done, total}`.
- `carryOverChanges(s, from, to, env)` copies unfinished items that haven't been carried yet (matched through `carriedFromId`). It is idempotent.
- `nextSortOrder`.

**`goals/palette.ts`:** 12 hex presets (Tailwind blue/emerald/amber/rose/violet/cyan/orange/pink-500, lime/teal-600, indigo/stone-500) and `nextColor(goals)`.

**`stats/stats.ts`:** `computeStats({days, blocks, goals, targets, checklist, today, now})` feeds the Day summary, the Week Budget panel and the Review. For each goal key (goal id, or `__unassigned__`), summing per day:
- `planned` = unionLength of plan blocks, including skipped ones.
- `actual` = unionLength of actual blocks.
- `unconfirmed` and `upcoming` = the ghost intervals, split by `now`.
- `projected` = unionLength of actual ∪ ghosts.
- `unplanned` = unionLength of actual blocks with no link.
- `skipped` = plan blocks marked skipped.
- Plus target, kind, checklist n/m, `byDay`, and `uncorrectedDays` (days with `unconfirmed > 0`).
- **Row inclusion:** a goal gets a row if it is not archived before the week starts and has a target, or if it has minutes or checklist items that week.
- **Status:** `weekPhase(week, today)` returns past, current or future, and `goalStatus` uses this table (T is the target; a null target gives `no_target`):

| kind | past | current | future |
|---|---|---|---|
| min | actual ≥ T: `met`, else `missed` | actual ≥ T: `met`; projected ≥ T: `on_track`; else `behind` | projected ≥ T: `on_track`, else `behind` |
| max | actual > T: `over`, else `within` | actual > T: `over`; projected > T: `at_risk`; else `within` | projected > T: `at_risk`, else `within` |

**`changes.ts`:**
- `applyChanges(state, cs)` is pure and immutable.
- `invertChanges(state, cs)` steps through the changes, recording each prior row. The inverse is the reversed list of `prior ? put(prior) : del(key)`.

**`export/format.ts`:**
- `toExportFile(data, meta)` sorts arrays so backups diff cleanly.
- `parseImportFile(text)` checks `format` and `version` (v1 only), validates with zod, then repairs with warnings:
  - a dangling `goalId` or `planBlockId` becomes null
  - a linked plan block gets `skipped = 0`
  - week keys are normalized with `weekStartOf`

**`state/store.ts` (Zustand):**
- **State:** settings, goals, weekTargets, blocks, checklist, weekNotes, loadedWeeks, plus `ui` (view, focusedDay, selection, budgetOpen, pastPlanUnlocked), history and now.
- **`commit(label, cs, {coalesceKey?})`:**
  1. Compute `inverse` from the current state.
  2. Apply the change optimistically and push it to history (this clears redo). An edit with the same `coalesceKey` in the same popover session merges into one entry.
  3. Enqueue `repo.applyChanges`.
  4. If the write fails: show a toast, reload the loaded weeks from the database, and clear history.
- **Not undoable** (each clears history): import, week-start change, deleting an unused goal.
- **Drag state** lives in a separate tiny `draft` store, so only `<DraftLayer>` re-renders during a drag.

## 7. Screens and interactions (MVP)

**Shell:**
- Nav rail: Day, Week, Goals, Review, with Settings at the bottom. The Review item carries a badge counting days with unconfirmed blocks this week and last week.
- Top bar: `‹ Today ›`, a date label with the ISO week, view actions, undo/redo.
- Right **Week Budget** panel, toggled with Ctrl+B. It shows a BulletBar and actual/target per goal, plus this week's tickable outcomes.
- Theme: `data-theme` on `<html>`. "System" uses `getCurrentWindow().theme()` and `onThemeChanged`; the browser falls back to `matchMedia`.
- Production builds suppress the native context menu except in editable fields.

**Day view:**
- **Layout:** time gutter, then **Plan**, then **Actual**, at 96 px per hour. The full 24 h scrolls. Initial scroll is now − 1 h for today, otherwise `dayStartMinute`.
- **Summary bar:** `Plan · Actual · Unplanned · Skipped · Unconfirmed`, plus per-goal chips showing actual/plan.
- A **now line** spans both lanes.
- **Visual language** (shape carries meaning, colour carries the goal):

| Element | Style |
|---|---|
| Plan block | Goal-colour outline with a 14% tint |
| Actual block | Solid goal colour; text is black or white based on OKLCH lightness |
| Ghost | Dashed outline at 55% opacity, with confirm and skip buttons on hover |
| Plan badge | done (check), adjusted (tilde), skipped (cross, title struck through, 50% opacity), unconfirmed (dot) |
| Untagged block | Neutral gray |

- **Locking:**
  - A past day's **Plan** lane is read-only until you click the lock in its header (unlocks for the session).
  - A future day's **Actual** lane is read-only, showing dimmed ghosts.
- **Empty plan:** "Drag to block time" with the buttons `[Copy yesterday's plan]` and `[Copy last <weekday>'s plan]`.
- **Popover** (opens after creating a block, on double-click, or with Enter):
  - Fields: title (focused), goal select (active goals in sort order), start and end via `parseTimeInput`, notes.
  - Buttons: Delete. On a plan block or ghost, also Confirm and Skip/Restore.
  - Edits apply live and coalesce into one undo step. Esc on a fresh block with no title and no goal cancels the create.
- **Context menu:**

| Target | Items |
|---|---|
| Plan block | Edit, Set goal ▸, Confirm, Skip/Restore, Duplicate, Delete |
| Ghost | Confirm, Skip, Edit |
| Actual block | Edit, Set goal ▸, Duplicate, Delete |
| Empty space | New block here, Confirm rest of day, Copy plan from ▸ |

- **Day actions:** "Confirm rest as planned" (Shift+A).

**Timeline drag state machine** (`dragMachine.ts` is a pure reducer: `(state, event, ctx) → {state, effect?}`; `ctx` holds column rects cached at drag start, `pxPerMin`, snap and today):

```
idle
 ├ down(empty lane)        → pending{op:create, day, layer, anchorMin}
 ├ down(block body)        → pending{op:move, subject:{block id}, grabOffsetMin}
 ├ down(ghost body)        → pending{op:move, subject:{ghost planId}, grabOffsetMin}
 └ down(edge, 6px zone)    → active{op:resize, edge}                 (no threshold)
pending ─ move ≥ 4px → active{op:create|move, draft}
pending ─ up         → click: select (dblclick block → popover; dblclick empty → default-length block)
active
 ├ move / wheel / autoscroll tick (≤48px from edge, rAF, 18px·(1−d/48)²) → recompute draft {day, layer, start, end, copy}
 │    snap = Shift ? 5 : settings.snapMinutes; clamp [0,1440]; target column by cached rects (no elementFromPoint)
 │    allowed targets: block → same layer, any rendered day; ghost → its own day's Actual lane; actual lanes of days > today rejected
 ├ Ctrl toggled → draft.copy (move only)
 ├ Esc | pointercancel | lostpointercapture → discard → idle (no write)
 └ up → effect.commit: create → put block, open popover | move → moveBlockChanges | ghost move/resize → materializeGhostChanges | resize → put
```

- Use `setPointerCapture`, plus `touch-action: none` and `user-select: none` on lanes.
- `BlockView` is memoized on its geometry and fields.
- The block being dragged is shown dimmed; the draft is rendered with transforms.

**Keyboard (MVP).** These are ignored inside inputs or while `isComposing`, and production builds swallow F5, Ctrl+R, Ctrl+F and Ctrl+P.
- **Global:**
  - Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y: undo, redo
  - `d` `w` `g` `r`: switch view
  - `t`: today
  - `[` `]`: previous/next day in Day view, previous/next week elsewhere
  - Ctrl+B: budget panel
  - Ctrl+,: settings
  - Esc: cancel drag, then close popover, then clear selection
- **With a block or ghost selected:**
  - Enter: edit
  - Delete/Backspace: delete (on a ghost, skip)
  - ↑/↓: move by one snap step
  - Shift+↑/↓: change the end
  - `1`–`9` / `0`: set or clear the goal
  - `a`: confirm
  - `s`: skip
  - Shift+A: confirm rest of day
- Blocks are `<button>`s with an `aria-label` such as "Thesis, plan, 9:00 to 10:30, done".

**Week view:**
- Seven day groups at 56 px per hour, in **Auto** layout: days up to today split into P|A, future days show the plan full width.
- Day header: `Mon 12`, a status dot (filled when all confirmed, hollow when something is unconfirmed, blank for the future), `P 8h · A 7h`. Clicking it opens Day view.
- Drag-create works. Dragging moves a block across days within the same layer; Ctrl copies.
- Text is hidden on blocks narrower than 56 px or shorter than 18 px (tooltip and aria-label still carry it).

**Goals page** (with week navigation):
- One row per goal: colour, name, kind toggle `≥/≤`, target in hours (0.25 h steps) with the hint "inherited from W41" when it carries forward, and the checklist (add with Enter, toggle, edit, delete, move up/down, `n/m`).
- Header: `[Carry over N unfinished from last week]`.
- Goal dialog: name, palette colour, kind, archive/unarchive, move up/down, and "Delete" (only when unused; asks for confirmation; not undoable).
- Goals with no target are listed under "Tracked only".

**Weekly Review:**
- Week navigation.
- `UnconfirmedBanner`: "Wed, Fri have unconfirmed blocks", with `[Confirm as planned]` and `[Open]` per day.
- KPI line: Planned · Actual · Unplanned · Skipped · Unconfirmed.
- Goal table: goal, target, plan, actual, Δ, **BulletBar**, outcomes n/m, status chip. Rows share one scale, `max(target, plan, projected) × 1.1`. The bar shows a track to the target, a target tick, a planned outline, solid actual and hatched unconfirmed. An unassigned row comes last.
- Tickable outcomes.
- A reflection textarea, stored in `week_notes`.
- Footer: `[Carry unfinished → next week]` and `[Set next week's targets →]`.
- SVG charts have `role="img"` and an aria-label summary.

**Settings:**
- Week start (Mon/Sun/Sat; changing it remaps keys and clears undo), day start (initial scroll), snap (5/10/15/30), default block length, theme.
- Data: Export JSON, Import JSON (Replace: a preview of counts and warnings, a confirmation, then `backup_now('pre-import')`, then `replaceAll`), Backup now, Open data folder (`revealItemInDir`), app version.
- On boot: `backup_if_stale(24)`.

## 8. Milestones (each one can be run and verified on its own)

**M0 — Scaffold, git, CI lint.**
- **Scaffold** in the scratchpad, because the project directory isn't empty:

  ```fish
  cd /tmp/claude-1000/-home-shrey-Documents-Codes-calendar-goals-webapp/cf2cc787-c46e-416c-9406-1b3569dc6050/scratchpad
  npm create tauri-app@latest calendar_goals_webapp -- --template react-ts --manager npm --identifier io.github.<ghuser>.timeblock --tauri-version 2 --yes
  cp -a calendar_goals_webapp/. /home/shrey/Documents/Codes/calendar_goals_webapp/
  cd /home/shrey/Documents/Codes/calendar_goals_webapp; npm install; git init -b main
  ```

- **Dependencies:**
  - `npm i zustand zod tailwindcss @tailwindcss/vite`
  - `npm i -D vitest jsdom @testing-library/react fast-check sql.js @types/sql.js eslint @eslint/js typescript-eslint eslint-plugin-react-hooks globals @types/node`
  - `npx shadcn@latest init`, then `add button input textarea popover dialog context-menu select checkbox toggle-group tooltip sonner`. Use the `@/*` path alias; avoid `baseUrl`, which TS 6 deprecates.
  - `cd src-tauri; cargo add rusqlite --features bundled; cargo add tauri-plugin-dialog serde_json`
- **Configuration:**
  - tauri.conf.json: name, window, CSP, bundle (§4) and capabilities.
  - `.gitignore`: add `.claude/settings.local.json` and `src-tauri/target`.
  - ESLint: ban Date usage outside the allowed files.
  - `.claude/launch.json`.
- **Scripts:**
  - `lint` = `eslint . && tsc --noEmit`
  - `test` = `vitest run`
  - `test:tz` = `TZ=UTC vitest run src/domain && TZ=Pacific/Chatham vitest run src/domain`
- **`ci.yml`:**
  - `web` job (ubuntu-24.04, Node 22): `npm ci`, lint, test, test:tz.
  - `rust` job: apt deps, `npm ci && npm run build` (creates `dist/`), then in `src-tauri`: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`.
- **Verify:**
  - `npm run lint && npm test` pass (one placeholder test).
  - `npm run dev` serves the template at http://localhost:1420.
  - `npm run tauri info` reports nothing missing.
  - `npm run tauri dev` opens a native window on KDE Wayland.
  - First commit.

**M1 — Domain and tests (no UI).**
- **Deliverables:** everything under `src/domain/**` from §6.
- **Tests to include:**
  - **Dates:** `addDays` across 2026-03-29, 2026-10-25, 2026-12-31 and 2028-02-28. `weekStartOf('2026-10-18', 1) = '2026-10-12'`; with start day 0 it is `'2026-10-18'`. `weekShiftDays(1→0) = -1`, `(0→1) = +1`, `(1→6) = -2`.
  - **Intervals:** union, touching, nested and subtract cases. Property tests: `unionLength ≤ Σlen`, and `subtract + intersection = original`.
  - **Lanes:** A 9–11, B 10–12, C 11–13 gives lanes 0/1/0 with laneCount 2.
  - **Reconcile:** ghost derivation; confirm subtracts an existing actual into 2 pieces; fully covered → skipped; deleting the last linked actual → skipped; deleting a plan block → its actuals are unlinked; a cross-day move unlinks; `confirmRestOfDay` respects `now`; `copyPlan` uses fresh ids.
  - **Stats:** Thesis 9–11 plus Thesis 10–12 counts 180, not 240. Every status-table cell. Projected uses union with ghosts. The unassigned bucket. The 01:30–03:30 block on the DST day counts 120.
  - **Targets:** W1 = 600 and W3 = 900 resolve to W0 null, W2 600, W5 900.
  - **Checklist:** carry-over is idempotent.
  - **Changes:** property test that `apply(apply(s, cs), invert(s, cs)) == s`.
  - **Export:** round trip, rejection of a newer version, repairs.
- **Verify:** `npm test` and `npm run test:tz` pass.

**M2 — Persistence and store.**
- **Rust:** `db.rs` and `files.rs` from §4, registered in `lib.rs` along with `tauri_plugin_dialog::init()`. `cargo test` covers value conversion and that a batch rolls back when a statement violates a CHECK.
- **TypeScript:**
  - drivers, `migrate.ts`, `SqliteRepository` (with mappers that convert snake_case to camelCase and 0/1 to booleans), `writeQueue`
  - `platform/`
  - the store with commit, undo, redo and coalescing
  - boot
  - `devSeed.ts`: `?seed=demo` loads a deterministic two-week dataset (goals Thesis ≥15h, Exercise ≥5h, Social ≤3h, plus done, adjusted, skipped and unconfirmed blocks). `?reset=1` clears the browser DB.
  - a temporary boot status line: "DB v1 · N blocks".
- **Contract tests** (`repository.test.ts`, run on sqljs in memory):
  - migrating twice leaves version 1
  - a batch is atomic
  - FK SET NULL works
  - `loadWeek` covers exactly 7 days
  - `changeWeekStart` remaps keys
  - `replaceAll` wipes old data and an export round-trips identically (ignoring `exportedAt`)
- **Verify:**
  - All tests pass.
  - `npm run tauri dev`: load demo data, restart the app, and the counts persist.
  - `sqlite3 ~/.local/share/io.github.<ghuser>.timeblock/data.sqlite3 'PRAGMA user_version; SELECT layer,count(*) FROM blocks GROUP BY 1;'` shows the data.
  - Browser mode persists across a page reload.

**M3 — Day view, Plan | Actual.**
- **Deliverables:** the shell, theme tokens, the timeline components, `dragMachine` and `useDrag`, popover, context menu, ghosts and their actions, plan lock, now line, summary bar, the keyboard subset, copy-plan empty state, and toasts with Undo.
- **Verify:**
  - Unit tests cover the `dragMachine` reducer: threshold, Esc, clamping, target rejection, and ghost → materialize.
  - **Browser checks** (preview "web" at `?seed=demo&now=2026-10-21T14:00`):
    - drag-create, then the popover opens
    - move, resize, Esc cancels
    - dragging a ghost creates a linked actual and the plan shows "adjusted"
    - deleting a ghost marks the plan skipped
    - draw an unplanned 10:00–10:30, then Confirm rest: the 9–11 ghost becomes 2 pieces
    - undo and redo restore exactly
  - Then the same flows in `npm run tauri dev`, and they survive a restart.

**M4 — Goals, targets, checklist, Week Budget.**
- **Deliverables:** GoalsPage, GoalDialog, Checklist, the goal select in the popover, `1`–`9` hotkeys, WeekBudgetPanel.
- **Verify:**
  - Browser: create 3 goals, set targets, tag blocks, and the panel matches a hand calculation.
  - Next week shows "inherited" targets.
  - Editing W+1 leaves W unchanged.
  - Carry-over twice adds the items only once.
  - Archived goals disappear from pickers but stay in past weeks.

**M5 — Week view.**
- **Deliverables:** WeekView in Auto layout, DayHeader, cross-day move and copy, ghosts in the split days.
- **Verify:**
  - Browser: moving a Thursday plan block to Friday moves it; with Ctrl it copies.
  - Moving a linked plan block makes its actual "unplanned".
  - Header totals match the Day view.
  - The week of 2026-10-19 to 10-25 (with the DST change) renders 24 h columns.

**M6 — Weekly review.**
- **Deliverables:** ReviewPage, GoalTable, BulletBar, UnconfirmedBanner, `week_notes`, the nav badge.
- **Verify:**
  - A jsdom test renders the goal table from the demo data with the expected statuses (met, missed, over, at_risk).
  - Browser: "Confirm as planned" on a day in the banner updates the numbers and the badge.
  - The reflection persists.

**M7 — Export/import and settings.**
- **Deliverables:** SettingsPage and DataSection, Rust-side dialogs, auto-backup.
- **Verify:**
  - In tauri dev: export to `~/Documents`, change data, import the export, and the data matches again.
  - `~/.local/share/<id>/backups/` contains a pre-import backup.
  - An invalid file shows the errors and changes nothing.
  - Changing the week start from Mon to Sun keeps targets and outcomes on the right weeks.
  - Theme System/Light/Dark follows the KDE colour scheme.

**M8 — Packaging, release, docs.**
- **Icon:** `npm run tauri icon ./app-icon.png` from a 1024² square PNG.
- **Release check:** `npm run tauri build -- --debug --bundles rpm` gives devtools with the CSP active. Expect no CSP errors and working popovers and toasts.
- **`release.yml`**, with all `uses:` steps in block style:
  - Trigger: `on: push: tags: ['v*']`.
  - Matrix: `macos-latest` (`--target universal-apple-darwin`, plus both Apple targets on rust-toolchain), `ubuntu-24.04` (apt: `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf xdg-utils`), `windows-latest`.
  - Steps, in order:
    1. `actions/checkout@v7`
    2. `actions/setup-node@v7` (Node 22, npm cache)
    3. Tag check: `test "$GITHUB_REF_NAME" = "v$(node -p "require('./package.json').version")"`
    4. `dtolnay/rust-toolchain@stable`
    5. `swatinem/rust-cache@v2` (`./src-tauri -> target`)
    6. `npm ci`
    7. `npm test`
    8. `tauri-apps/tauri-action@v1` with `GITHUB_TOKEN`, `tagName: ${{ github.ref_name }}`, `releaseDraft: true`, `args: ${{ matrix.args }}`
  - Job-level `permissions: contents: write`.
- **README:**
  - features and screenshots
  - install per OS: AppImage needs `chmod +x` and glibc ≥ 2.39; macOS needs Privacy & Security → Open Anyway for the unsigned app; Windows SmartScreen → More info
  - data location and backups
  - Wayland/NVIDIA troubleshooting
  - dev setup
- **Also:** LICENSE (MIT), CHANGELOG.
- **Verify:**
  - `npm run tauri build -- --bundles rpm`, then `sudo dnf install ./src-tauri/target/release/bundle/rpm/*.rpm`. The app launches and uses the same data dir.
  - Push `v0.1.0`: the draft release contains .AppImage, .deb, .rpm, .dmg, .msi and -setup.exe.

## 9. Verification summary

- **Static checks:** `npm run lint` (ESLint and `tsc --noEmit`).
- **Unit and contract tests:** `npm test` (Vitest: domain in the node environment, repository on sql.js, a few jsdom component tests) and `npm run test:tz`.
- **Rust:** `cd src-tauri; cargo fmt --check; cargo clippy --all-targets -- -D warnings; cargo test`. Run `npm run build` once first so `dist/` exists.
- **Fast UI work:** `npm run dev` serves http://localhost:1420 with the sql.js DB in localStorage. `?seed=demo`, `?now=…` and `?reset=1` give deterministic states. Automated browser checks use the Claude preview config "web" from `.claude/launch.json`. Playwright CI is post-MVP.
- **Native app:** `npm run tauri dev`. The first compile takes several minutes. Right-click → Inspect gives devtools in debug builds. Inspect the DB with the `sqlite3` CLI (installed).
- **Bundles:**
  - Locally: `npm run tauri build -- --bundles rpm` (add `--debug` for the CSP check).
  - AppImage, .deb, macOS and Windows builds come from CI only.

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| WebKitGTK on KDE Wayland with NVIDIA (WebKitGTK 2.54, NVIDIA 615): blank window, Error 71, flicker | Run with no variables first. Then try `__NV_DISABLE_EXPLICIT_SYNC=1`. Then `WEBKIT_DISABLE_DMABUF_RENDERER=1` (reported to flicker on 2.54), then `WEBKIT_DISABLE_COMPOSITING_MODE=1`, then `GDK_BACKEND=x11`. Keep the window opaque. If needed, add a guarded `unsafe { set_var }` in `main.rs` (edition 2024) that checks `/sys/module/nvidia` and only sets the variable if it isn't already set. Document all of this in the README. |
| create-tauri-app deletes `.claude` | Scaffold in the scratchpad and copy with `cp -a` (M0) |
| CI Rust jobs fail without `dist/` | Run `npm run build` before cargo |
| CSP breaks styles injected at runtime (sonner, primitives) | `style-src 'unsafe-inline'` plus `dangerousDisableAssetCspModification: ["style-src"]`; check in a `--debug` release build |
| KDE dark mode not detected through CSS | Use `window.theme()` and `onThemeChanged` (needs `core:window:allow-theme`); never call `setTheme` on Linux |
| sql.js (SQLite 3.54) and rusqlite (bundled) behave differently | Use only standard SQL, `?` placeholders and STRICT tables; the contract suite plus an M2 smoke test in tauri dev |
| Changing the identifier or name after release orphans the data dir | Confirm the name and identifier before tagging `v0.1.0` |
| Unsigned binaries | Ad-hoc macOS signing (`"-"`) and README instructions; signing and the updater are post-MVP |
| AppImage glibc 2.39+ (built on ubuntu-24.04); local AppImage builds can fail in linuxdeploy's strip step | Offer .deb and .rpm; build AppImage only in CI; use `NO_STRIP=true` if needed |
| Two app instances diverge (WAL prevents corruption, but the in-memory stores drift) | Post-MVP `tauri-plugin-single-instance`; until then document "one instance" |
| Bad import | Validation and a preview, a forced backup first, and Replace in a single transaction |
| Duplicate draft releases from parallel matrix jobs | `tauri-action@v1` includes the fix (PR #1285). Fall back to a create-release job passing `releaseId` if needed. |
| DST, travel | Wall-clock policy, documented. The domain never uses local `Date` (lint rule plus the TZ test runs). |

## 11. Post-MVP ideas

- Carve when committing an actual block
- Edge magnets, drift ribbons and a link gutter
- Cross-lane drag ("log as actual") and week view modes
- Command palette, full keyboard parity and a slot cursor
- Onboarding with suggested goals; nudges ("Review today", "Plan tomorrow")
- Templates, recurring blocks and "copy last week's plan"
- A running timer block
- Merge import and file-drop import
- Multi-week trend charts
- Tray icon and notifications ("Now: X → Next: Y")
- 12-hour time, i18n, timeline zoom
- Blocks that cross midnight
- ICS import/export
- Flatpak; signing plus the auto-updater
- WebdriverIO end-to-end tests (`tauri-plugin-wdio-webdriver`); Playwright on browser mode in CI

### Critical Files for Implementation
- /home/shrey/Documents/Codes/calendar_goals_webapp/src/domain/blocks/reconcile.ts
- /home/shrey/Documents/Codes/calendar_goals_webapp/src/domain/stats/stats.ts
- /home/shrey/Documents/Codes/calendar_goals_webapp/src/data/SqliteRepository.ts (with src/data/migrations/0001_init.sql)
- /home/shrey/Documents/Codes/calendar_goals_webapp/src/features/timeline/dragMachine.ts
- /home/shrey/Documents/Codes/calendar_goals_webapp/src-tauri/src/db.rs (with tauri.conf.json and capabilities/default.json)

Sources (spot-checked):
- [create-tauri-app lib.rs](https://raw.githubusercontent.com/tauri-apps/create-tauri-app/dev/src/lib.rs)
- [crates.io tauri](https://crates.io/api/v1/crates/tauri)
- [crates.io rusqlite](https://crates.io/api/v1/crates/rusqlite)
- [tauri-action releases](https://api.github.com/repos/tauri-apps/tauri-action/releases?per_page=5)
- [tauri-action v1 tag](https://api.github.com/repos/tauri-apps/tauri-action/git/matching-refs/tags/v1)
- [actions/checkout releases](https://api.github.com/repos/actions/checkout/releases?per_page=5)
- [actions/setup-node releases](https://api.github.com/repos/actions/setup-node/releases?per_page=5)
- [opener default.toml](https://raw.githubusercontent.com/tauri-apps/plugins-workspace/v2/plugins/opener/permissions/default.toml)
- [Tauri core permissions](https://v2.tauri.app/reference/acl/core-permissions/)
- [Dialog FileDialogBuilder](https://docs.rs/tauri-plugin-dialog/latest/tauri_plugin_dialog/struct.FileDialogBuilder.html)
- [Dialog FilePath](https://docs.rs/tauri-plugin-dialog/latest/tauri_plugin_dialog/enum.FilePath.html)
- [Tauri config schema](https://schema.tauri.app/config/2)
- [sql.js releases](https://github.com/sql-js/sql.js/releases)
- [Fedora libxdo-devel](https://packages.fedoraproject.org/pkgs/xdotool/libxdo-devel/)
- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
- [Tauri GitHub pipeline](https://v2.tauri.app/distribute/pipelines/github/)
- [runner-images #14254](https://github.com/actions/runner-images/issues/14254)
- [tao #1382](https://github.com/tauri-apps/tao/issues/1382)
- [tauri #3142 (frontendDist)](https://github.com/tauri-apps/tauri/issues/3142)
- [Tauri core JS API (isTauri)](https://v2.tauri.app/reference/javascript/api/namespacecore/)
- [shadcn Vite install](https://ui.shadcn.com/docs/installation/vite)