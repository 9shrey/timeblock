# Timeblock: implementation plan (authoritative spec)

> This is the approved plan. The other files in `docs/design/` are the background reports it was merged from
> (Tauri ecosystem research, architecture/data, UX, critique/synthesis). Where they disagree, this file wins.

## Context
A personal, open-source (MIT) desktop app with three jobs:
- time-block your day (**Plan**),
- correct it to what really happened (**Actual**),
- compare each weekly goal's target hours and outcome checklist with planned and actual time.

## Decisions
| Area | Choice | Why |
|---|---|---|
| Name and ID | **Timeblock**, `com.shreysingh.timeblock`, MIT | The ID fixes the data dir `~/.local/share/com.shreysingh.timeblock/` |
| Shell | Tauri 2.x (avoid the 3.0 alpha), template `react-ts`, Vite, npm | |
| Persistence | Rust `rusqlite {bundled}` behind 3 generic commands: `db_select`, `db_batch` (one transaction), `db_exec_script`. All SQL lives in TS | Real transactions (tauri-plugin-sql's pool breaks multi-statement transactions). Rust stays schema-agnostic |
| Browser/test driver | **sql.js** (dev dep) for Vitest and for `npm run dev` in a plain browser, persisted to localStorage; loaded only when `DEV && !isTauri()` | One `SqliteRepository` and the same migrations in every mode |
| Migrations | TS `migrate.ts` using `PRAGMA user_version`; SQL files imported `?raw` | Same code under sql.js and rusqlite |
| Time model | `day: 'YYYY-MM-DD'` plus `startMinute`/`endMinute` (0..1440) wall clock. Blocks never cross midnight. No date library: `Date.UTC` plus `Intl` | DST-safe arithmetic |
| Plan→Actual | Plan blocks show as derived **ghosts** (dashed) in the Actual lane until confirmed or skipped. Actual blocks link back with `plan_block_id` (same day). Plan blocks have a `skipped` flag. **Unconfirmed time never counts as actual** | Honest numbers |
| Overlaps | Allowed, laid out in lanes. Hours are a union of intervals per (day, goal) | |
| Targets | `week_targets` rows carry forward: effective target = latest row with week ≤ W. Editing W upserts only W's row. `kind` (min/max) lives on the goal | Past reviews never change |
| State | Zustand store, optimistic `commit(ChangeSet)`, serial write queue, undo/redo (100 steps) from inverse ChangeSets | |
| Timeline | **Custom** Pointer Events component, absolute positioning, pure `dragMachine` reducer. No calendar library, no HTML5 DnD | |
| UI kit | Tailwind v4 (`@tailwindcss/vite`), shadcn/ui, sonner toasts. Charts hand-written SVG | |
| Validation | zod for import files and settings (key/value JSON) | |
| Files | Export/import through Rust commands (`tauri-plugin-dialog` from Rust + `std::fs`). No fs plugin | |
| Capabilities | `core:default`, `core:window:allow-theme`, `opener:default` | |
| Release | `tauri-apps/tauri-action@v1` on `v*` tags. ubuntu-24.04, macos-latest (universal), windows-latest. Draft, unsigned | |

## File layout
```
.github/workflows/{ci.yml, release.yml}   README.md LICENSE CHANGELOG.md docs/design/*.md
.claude/launch.json        # preview config "web": npm run dev, port 1420
src/
  main.tsx                 # boot: platform → repo.init/migrate → loadBase → load week ±1 → backup_if_stale → render
  app/{App,Shell,NavRail,TopBar}.tsx, app/shortcuts.ts, styles/index.css
  domain/                  # PURE; ESLint bans new Date/Date.now outside time/clock.ts, platform/, tests
    types.ts env.ts changes.ts
    time/{localDate,clock}.ts
    blocks/{intervals,layout,edit,validate,reconcile}.ts
    goals/{targets,checklist,palette}.ts
    stats/stats.ts   export/{format,schema}.ts   **/*.test.ts
  data/drivers/{SqlDriver,tauriDriver,sqljsDriver}.ts  data/migrations/0001_init.sql
  data/{migrate,SqliteRepository,mappers,writeQueue,devSeed}.ts  data/repository.test.ts
  platform/{index,tauri,web}.ts      # saveTextFile, openTextFile, backupNow, backupIfStale, revealDataDir, systemTheme
  state/{store,commands,history,selectors,draft}.ts
  features/timeline/{Timeline,LaneColumn,BlockView,GhostBlock,DraftLayer,TimeGutter,NowLine,BlockPopover,BlockContextMenu}.tsx
  features/timeline/{dragMachine,useDrag,geometry}.ts
  features/{day,week,goals,review,settings}/…   components/ui/* (shadcn)
src-tauri/  tauri.conf.json  capabilities/default.json  src/{main,lib,db,files}.rs
```
**Data flow:** UI → `state/commands.ts` → domain functions build a `ChangeSet` → `store.commit()` applies optimistically and pushes the inverse onto undo history → `writeQueue` → `SqliteRepository.applyChanges` → `driver.batch` (Tauri: `invoke('db_batch')`, one rusqlite transaction). On write failure: toast, reload loaded weeks from DB, clear history.

**Rust surface** — `db.rs`: `Mutex<Connection>` opened in `setup()` with WAL, `foreign_keys=ON`, `busy_timeout`. `db_select(sql, params)` → rows as JSON maps. `db_batch(stmts)` one transaction with `defer_foreign_keys`. `db_exec_script(sql)` for migrations. `backup_now(reason)` → `VACUUM INTO backups/data-<unix>-<reason>.sqlite3`, keep newest 14. `backup_if_stale(maxAgeHours)`. `data_dir()`. Values: JSON null/int/float/string → NULL/i64/f64/TEXT; bool is an error (TS sends 0/1).
`files.rs`: `save_text_file(defaultName, contents)`, `open_text_file()` using `blocking_save_file`/`blocking_pick_file` in async commands.

**tauri.conf.json:** window `main` 1280×860, min 960×640, `dragDropEnabled:false`. CSP `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src ipc: http://ipc.localhost` plus `dangerousDisableAssetCspModification:["style-src"]`. `version: "../package.json"`. `bundle.targets:"all"`, `category:"Productivity"`, `license:"MIT"`.

## Data model (`0001_init.sql`, all tables STRICT)
```sql
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT, WITHOUT ROWID;
CREATE TABLE goals (id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  color TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'min' CHECK(kind IN ('min','max')),
  sort_order INTEGER NOT NULL DEFAULT 0, archived_on TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL) STRICT;
CREATE TABLE week_targets (goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE, week_start TEXT NOT NULL,
  target_minutes INTEGER CHECK(target_minutes IS NULL OR target_minutes BETWEEN 0 AND 10080),  -- NULL = tracked only
  updated_at INTEGER NOT NULL, PRIMARY KEY(goal_id, week_start)) STRICT, WITHOUT ROWID;
CREATE TABLE checklist_items (id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL, text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 500), done INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0, carried_from_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL) STRICT;
CREATE TABLE blocks (id TEXT PRIMARY KEY, day TEXT NOT NULL, layer TEXT NOT NULL CHECK(layer IN ('plan','actual')),
  start_minute INTEGER NOT NULL CHECK(start_minute BETWEEN 0 AND 1439), end_minute INTEGER NOT NULL CHECK(end_minute BETWEEN 1 AND 1440),
  title TEXT NOT NULL DEFAULT '', goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL, notes TEXT NOT NULL DEFAULT '',
  plan_block_id TEXT REFERENCES blocks(id) ON DELETE SET NULL, skipped INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, CHECK(end_minute > start_minute),
  CHECK(layer='actual' OR plan_block_id IS NULL), CHECK(layer='plan' OR skipped=0)) STRICT;
CREATE TABLE week_notes (week_start TEXT PRIMARY KEY, text TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL) STRICT, WITHOUT ROWID;
-- indexes: blocks(day,layer,start_minute); blocks(plan_block_id) WHERE NOT NULL; blocks(goal_id); checklist_items(week_start,goal_id,sort_order)
```
**Write rules:** every write is an upsert. Week keys are the week-start date, which depends on the configured start day (Mon/Sun/Sat). Changing the start day remaps keys with `UPDATE … SET week_start = date(week_start, ?||' days')` (shift in [-3,3], no collisions).

**Migration flow:** read `user_version` → if newer than the app knows, refuse → if a migration is pending and the DB has data, `backup_now('pre-migration')` → run each pending migration in a transaction.

**Key TS types:** entities `Block`, `Goal`, `WeekTarget`, `ChecklistItem`, `WeekNote`, `Settings` (`weekStartDay`, `dayStartMinute`, `snapMinutes`, `defaultBlockMinutes`, `theme`). Derived: `Ghost`, `PlanState` (`pending|unconfirmed|done|adjusted|skipped`). `Change = put | del`, `ChangeSet`. `Now {day, minute}`, `Env {newId, nowMs}`. `Repository`: `init, loadBase, loadWeek, applyChanges, changeWeekStart, goalUsage, exportAll, replaceAll`. `ExportFileV1 {format:'timeblock.export', version:1, …}`.

## Domain logic (pure, unit-tested)
- **time/localDate:** `parseLocalDate, addDays, diffDays, dayOfWeek, weekStartOf(d, ws), weekDays, isoWeek` (labels), `weekShiftDays`, `formatMinute` (1440→"24:00"), `formatDuration`, `parseTimeInput` ("915", "9:15", "9.15").
- **time/clock:** `nowFrom(Date)` is the only local-time read; dev-only `?now=YYYY-MM-DDTHH:mm`; ticks every 60 s.
- **blocks/intervals:** half-open `merge, unionLength, subtract, clip`.
- **blocks/layout:** `layoutLanes` — sort by start (longest first), cluster overlaps, first-fit lanes; touching ≠ overlapping.
- **blocks/edit:** `snap, moveInterval, resizeInterval, pxToMinute`, clamp [0,1440].
- **blocks/validate:** range/order, title length, unknown goal, archived goal (only on create/goal change), link must be a same-day plan block, layer/field mismatches.
- **blocks/reconcile:**
  - `ghostsOf`: plan blocks not skipped with no linked actual.
  - `planState`: skipped (flag) · done (exactly one linked actual, same start/end/goal) · adjusted (linked actual(s) differ) · unconfirmed (ghost whose time has passed) · pending.
  - `confirmGhost`: plan interval minus existing actual intervals; each piece ≥5 min → linked actual; nothing left → plan skipped.
  - `materializeGhost(patch)`: drag/resize/edit of a ghost creates a linked actual with the patch.
  - `skip`/`restore`. Deleting a plan block unlinks its actuals. Deleting the last linked actual marks the plan skipped.
  - Move to another day unlinks. Ctrl while moving copies with a new id.
  - `confirmRestOfDay(day, now)`: all past ghosts, one ChangeSet. `copyPlan(from, to)`.
  - Actual lanes for days after today are read-only.
- **goals/targets:** `effectiveTarget(rows, goal, week) → {minutes, fromWeek}`; `setTargetChanges` upserts W; creating a goal writes a target row for the viewed week.
- **goals/checklist:** `progress`; `carryOver(from, to)` idempotent via `carriedFromId`.
- **goals/palette:** 12 colors, `nextColor`.
- **stats/computeStats:** per goal + `__unassigned__`: planned (union of plan incl. skipped), actual, unconfirmed/upcoming (ghosts split by now), projected (actual ∪ ghosts), unplanned (actual without link), skipped; plus target, kind, checklist n/m, byDay, uncorrectedDays.
  Status: min — past: met/missed; current: met | on_track (projected ≥ T) | behind; future: on_track | behind. max — past: over (actual > T)/within; current: over | at_risk (projected > T) | within; future: at_risk | within. No target → `no_target`.
- **changes:** pure `applyChanges`; `invertChanges` from pre-change rows.
- **export:** `toExportFile` (sorted arrays); `parseImportFile` v1 only, zod, repairs dangling `goalId`/`planBlockId` to null with warnings, normalizes week keys.

## Screens (MVP)
- **Shell:** nav rail Day/Week/Goals/Review (+Settings bottom; Review badge = unconfirmed days). Top bar `‹ Today ›`, date + ISO week, undo/redo. Week Budget panel (Ctrl+B). Theme follows KDE via `getCurrentWindow().theme()`/`onThemeChanged`; never `setTheme` on Linux.
- **Day view:** gutter | Plan | Actual at 96 px/h over 24 h; scroll to now−1h or `dayStartMinute`. Summary bar: Plan · Actual · Unplanned · Skipped · Unconfirmed + goal chips. Now line. Plan = goal outline + light tint; Actual = solid; Ghost = dashed 55% with ✓/✗ on hover. Plan badges: done ✓, adjusted ~, skipped ✗ (struck), unconfirmed •. Past Plan lane locked until lock icon clicked; future Actual read-only. Empty plan: `[Copy yesterday's plan]` `[Copy last <weekday>'s plan]`. Popover: title, goal, start/end, notes, Delete, Confirm, Skip; live edits merge into one undo step. Context menus for blocks, ghosts, empty space ("Confirm rest of day").
- **Drag machine:**
  ```
  idle ─down(empty)→ pending:create │ down(block|ghost)→ pending:move │ down(edge 6px)→ active:resize
  pending ─move≥4px→ active │ up→ click(select; dblclick→popover / default-length block)
  active ─move/wheel/autoscroll→ draft (snap: Shift=5 else settings; clamp; target column from cached rects; Ctrl=copy)
         ─Esc/pointercancel→ idle (no write) │ up→ commit(create+popover | moveBlock | materializeGhost | resize)
  ```
  Blocks stay in their layer but can go to any visible day. Ghosts move only within their own day's Actual lane. `setPointerCapture`, `touch-action:none`, `user-select:none`. Only `DraftLayer` re-renders during drag.
- **Keyboard** (ignored in inputs): Ctrl+Z / Ctrl+Shift+Z; `d w g r` views; `t` today; `[` `]` prev/next; Ctrl+B; Esc cancels drag → closes popover → clears selection. Selected block: Enter edit, Del delete (ghost: skip), ↑/↓ nudge, Shift+↑/↓ resize, `1`–`9` goal, `a` confirm, `s` skip, Shift+A confirm rest of day. Blocks are `<button>`s with `aria-label`s.
- **Week view:** 7 days at 56 px/h; days ≤ today split P|A, future plan-only full width. Header: status dot, `P 8h · A 7h`, click → Day. Drag-create, cross-day moves within a layer, Ctrl copies.
- **Goals page:** by week; color, name, `≥/≤`, target hours (0.25 steps), "inherited from W41". Checklist per goal; `[Carry over N unfinished]`. Goal dialog: name, color, kind, archive; delete only if unused, with confirm.
- **Weekly review:** UnconfirmedBanner (per day `[Confirm as planned]` `[Open]`), KPI line, goal table (target, plan, actual, Δ, BulletBar shared scale, outcomes n/m, status chip), outcomes + reflection note, `[Carry unfinished → next week]` `[Set next week's targets →]`.
- **Settings:** week start (clears undo), day start, snap 5/10/15/30, default block length, theme. Data: Export JSON; Import JSON (replace, preview, pre-import backup); Backup now; Open data folder; version. Auto-backup if last > 24 h.

## Milestones
- **M0** scaffold, git, CI lint. **M1** domain + tests. **M2** persistence + store. **M3** Day view. **M4** goals/targets/checklist/budget. **M5** Week view. **M6** Weekly review. **M7** export/import + settings. **M8** packaging, release, docs.
- Each milestone ends with an adversarial review and a commit to `main`. Ask before anything outward-facing (GitHub repo, push, tag).
- Detailed per-milestone verification lists: see `critique-synthesis.md` §milestones and the original plan in the session log; key checks:
  - M1: addDays across 2026-03-29/2026-10-25/2026-12-31/2028-02-28; `weekStartOf('2026-10-18', Mon)='2026-10-12'`; `weekShiftDays` 1→0=−1, 1→6=−2; interval property tests; lanes 9–11/10–12/11–13 → 0/1/0; reconcile cases; stats 9–11+10–12=180; every status cell; DST 01:30–03:30 = 120; targets W1=600,W3=900 → W0 null, W2 600, W5 900; carry-over idempotent; apply∘invert identity; export round-trip/reject newer/repairs.
  - M2: migrate twice no-op; atomic batch; FK SET NULL; loadWeek 7 days; changeWeekStart remaps; export→replaceAll round-trip; Rust value conversion + rollback on CHECK failure; `?seed=demo`, `?reset=1`.
  - M3: dragMachine tests; browser checks at `?seed=demo&now=2026-10-21T14:00`.
  - M4–M7: see plan.
  - M8: icon, `--debug` CSP check, release.yml, README (install notes, Wayland/NVIDIA), LICENSE, CHANGELOG.

## Risks
WebKitGTK on KDE Wayland + NVIDIA: try none → `__NV_DISABLE_EXPLICIT_SYNC=1` → `WEBKIT_DISABLE_DMABUF_RENDERER=1` → `WEBKIT_DISABLE_COMPOSITING_MODE=1` → `GDK_BACKEND=x11`; if needed, `main.rs` sets it only when `/sys/module/nvidia` exists and the var isn't set. CI cargo needs `npm run build` first. CSP + runtime styles. sql.js vs rusqlite parity via standard SQL + contract tests. Single instance documented. AppImage built in CI only.

## Post-MVP (not in scope)
Recurring blocks/templates, timer, tray/notifications, trends, ICS, cross-lane drag, command palette, cross-midnight blocks, 12-h/i18n/zoom, signing/updater, Flatpak, E2E in CI.
