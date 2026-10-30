# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed
- **Goals are judged by pace, not by plan.** During the week an "at least" goal is compared with a
  steady pace over its days: **On pace**, **Behind** (by how much), or **Met**. Only confirmed time
  counts; unconfirmed plan blocks no longer make a goal look on track. The plan is shown as a
  separate line ("plan short by 2h"). "At most" goals show **Within limit**, **Watch** (the plan
  would go over) or **Over**; future weeks show **Planned** / **Under-planned**.
- **One kind of goal.** A goal has an optional weekly time target, outcomes, or both; the
  Time/Tasks switch is gone. A goal without a time target is judged by its outcomes when the week
  ends. Former task goals keep their outcomes; their separate outcome-count target is dropped.
- **Active days**: an "at least" goal can be spread over chosen weekdays (e.g. Mon–Fri), so its
  pace is fair on weekends. A goal created mid-week gets a prorated first-week target.
- Targets accept `15`, `7.5`, `1h30`, `90m` or `1:30`, can be edited in the goal dialog, and
  **Use previous** drops a week's change. The status now shows on the Goals page and in the
  week budget, not only in Review; progress bars mark where the pace is.
- The ≥/≤ switch moved from the Goals page into the edit dialog (it changes every week of a goal).
- New goals start from the current week, and archiving uses the current week, whichever week you
  are viewing.

### Fixed
- Trends: the streak reset every week until the target was reached; an unfinished week no longer
  breaks it. Task goals were compared in minutes against an outcome count.
- CSV weekly stats: task goals were always "behind"/"missed" and their count was written as minutes.
- Goals no longer show up in Review for weeks before they were created.

## [0.3.0] - 2026-10-28

### Added
- **Sync account** (optional): sign in with a username and password in Settings → Sync & account
  to sync your plan between the desktop app, the web app and your phone. Changes sync on their own
  within seconds; the top-bar icon shows the status and syncs on click. On first sign-in with data
  on both sides, choose to merge, keep the account's data, or keep this device's (a backup is made
  first). Change password, sign out everywhere and delete account are in the same section.
- **Web app** at https://9shrey.github.io/timeblock/app/: the full app in the browser, signed in
  to your account, and installable on a phone (Add to Home Screen).
- **Sync server** (`server/`): a small self-hosted Rust server with login rate limiting and
  nightly backups; see `server/deploy/README.md`.

### Fixed
- Calendar subscriptions in the desktop app could not download feeds (missing HTTP permission).

## [0.2.3] - 2026-10-27

### Added
- **Select mode** (Select button or `x`, Day and Week views): drag a box over blocks to select
  them, click to toggle one, "Select all today / this week", then Delete.

### Changed
- Deleting a multi-selection now also removes blocks on locked past days (still one undo step).

## [0.2.2] - 2026-10-27

### Added
- **Month view** (`m`): a grid of the month with each day's planned blocks and planned/actual
  totals; click a day to open it.
- **Select and delete many blocks**: Ctrl/Shift+click to add blocks to a selection, Ctrl+A to
  select everything on the day or week, then Delete (one undo step; blocks in locked lanes are
  kept).
- **Clear all data** (Settings → Data): removes goals, blocks, templates, routines and notes
  after making a backup; preferences are kept.

### Fixed
- "Copy last week's plan" (and copying a day's plan) no longer stacks duplicates when repeated;
  blocks already on the target day are skipped.

## [0.2.1] - 2026-10-25

0.2.0 was tagged but never published, so this is the first release with its changes too
(in-app updates, the live demo, calendar subscriptions and more); see 0.2.0 below.

### Added
- **Automatic update checks**: the desktop app looks for a new release 15 seconds after
  launch and then once a day, and shows a toast with a "View" button when one is found.
  Nothing installs without a click. Turn it off with Settings → Updates → "Check
  automatically".
- **Release notes in the app**: Settings → Updates shows "What's new" for the available
  version. The release workflow now uses the version's CHANGELOG section as the release
  body (which goes into the updater's `latest.json`), and stops if that section is missing.

### Changed
- Updates show download progress, then "Installing…", instead of a bare "Working…".
- A failed install says why (for example, a dismissed password prompt), offers "Try
  again", and links to the Releases page. Before, it showed "Couldn't reach the update
  server" even when the download had worked.
- `.deb` and `.rpm` installs say up front that installing asks for the system password.

### Security
- Turned off the updater plugin's `zip` feature, which only unpacks Tauri v1-style
  `.zip`/`.tar.gz` update bundles (this app publishes v2 ones). This removes `zip` 4.6.1
  and its advisories (RUSTSEC-2026-0367, -0368, -0369). Updated `rustls-webpki` to
  0.103.16 (RUSTSEC-2026-0382).

### Fixed
- The install-failure message said only the AppImage could update itself on Linux. The
  updater also installs `.deb` and `.rpm` updates, through a `pkexec` password prompt.

## [0.2.0] - 2026-10-20

### Added
- **In-app updates**: Settings → Updates checks GitHub Releases for a newer version and
  installs it with one click (after backing up your data). Update bundles are signed with
  Timeblock's updater key and verified before installing. This is separate from OS code
  signing, so first installs are still unsigned.
- **Live in-browser demo** at `9shrey.github.io/timeblock/demo/`, linked from the website: the
  web build (`VITE_DEMO=1`) starts with two weeks of sample data, keeps edits in the
  browser, and has a banner with "Reset demo" and a link to the desktop app. The site
  deploy now builds and ships it as one Pages artifact.
- **Calendar subscriptions**: paste a Google/Outlook secret iCal link (or any `https://` /
  `webcal://` `.ics` URL) in Settings → Calendar and its events show up in the read-only
  Day view overlay, with "copy to plan" as before. Subscriptions refresh on launch, every
  30 minutes while the app runs, and from a Refresh button; a failed fetch keeps the last
  good events and shows the error next to the subscription. The desktop app fetches
  through the Tauri http plugin, scoped to `https://` only; the browser build falls back to
  `fetch` and explains when the calendar host blocks it (CORS). Subscriptions are stored in
  a new `calendar_subscriptions` table (migration 0005); fetched events stay in memory.
  Export format v4 adds `calendarSubscriptions`; v1–v3 files still import.
- **Recurring events and time zones in calendar import** (file and subscription), via
  `ical.js`: `RRULE`/`RDATE` series are expanded for the weeks around the visible date,
  minus `EXDATE`s, with `RECURRENCE-ID` overrides (moved, retitled or cancelled
  occurrences) applied. `TZID` times are converted using the file's `VTIMEZONE` (including
  Outlook's Windows zone names) or, failing that, the platform's IANA zone data, so a 9:00
  New York meeting shows at the right local time, DST changes included. A multi-day
  all-day event shows on each of its days.
- **12-hour time**: Settings → Time format switches every displayed time (timeline hour
  labels, block labels, the editor's time slots, the tray's next-block line, Review, routines)
  between `13:00` and `1:00 PM`. A new `timeFormat` setting, default `24h`. Time inputs and
  quick-add accept `9am`, `9:30pm`, `9am-10:30am` and `9-10:30pm` in either mode, alongside
  the existing 24-hour forms; a quick-add range ending at `12am` (or `0`) means midnight.
  The next-block notification now also shows the block's start time.
- **Task-based goals**: a goal can now be measured by outcomes done each week instead of
  minutes logged. Set "Measure by" to Tasks when creating or editing a goal, then set a
  weekly outcome-count target instead of an hours target; status (met/missed/behind/...)
  is computed from the goal's existing outcomes checklist instead of blocks. Export format
  v3 adds `goals.trackBy` and `weekTargets.targetCount`; importing a v1 or v2 file still
  works, defaulting both goals to time-tracked.
- **Trends view** (`i` key): per goal, planned vs actual bars against the target for the
  last 4/12/26 weeks, plus a streak of weeks the target was met. A new `repo.loadBlocksRange`
  reads any date range in one indexed query, reusing `computeStats` week by week.
- **Plan accuracy stats**: confirmed-as-planned %, skipped %, unplanned % and average start
  drift for linked actuals, shown on the Review page and in Trends
  (`src/domain/stats/accuracy.ts`).
- **Delta badges on actual blocks**: a linked actual that differs from its plan shows
  `+15m late`, `−30m`, or `goal: <name>` if the goal was swapped.
- **Biggest gaps** on the Review page: the week's largest unplanned-actual or
  unconfirmed-ghost stretches.
- **Reschedule skipped → next week** on the Review page: copies the week's skipped plan
  blocks onto a day you choose, as one undoable change.
- **CSV export**, next to the JSON export in Settings: blocks for the last 12 weeks, plus
  that range's weekly per-goal stats, as two deterministic CSV files.
- **Year heatmap** in Trends: one cell per day, coloured by actual hours, for all goals or
  one you choose (persisted in Settings).
- **Restore a backup** from Settings, or from the error screen when Timeblock can't start.
  The current data is backed up first. Settings also shows when the last backup was made.
- **Copy last week's plan**, from the Week view header and the empty-day prompt in Day
  view. Locked and past target days are skipped, and a block whose goal is archived by
  the target week loses its goal link instead of blocking the copy.
- Export format v2: templates, routines and `blocks.routineId`. Importing a v1 file still
  works.
- **Templates**: save a day or week's plan as a named template from the block/empty-space
  menu, then apply it to another day or week. Templates never link back to the blocks
  they created, so applying one is an ordinary, undoable edit. Manage saved templates
  (rename, delete) from Settings.
- **Routines**: recurring plan blocks, managed from Settings. Occurrences are materialized
  automatically up to two weeks out as you use the app; past days are never touched.
  Editing a routine updates its future occurrences that you haven't customized yourself;
  deleting one keeps the blocks it already created.
- **Quick add**: press `n` in Day view for a one-line input like `9-10:30 Thesis #thesis`
  (start-end, title, optional `#tag` to set the goal by name). Creates a plan block without
  touching the mouse.
- **Command palette** (`Ctrl+K`): go to a date, apply a template, confirm the rest of the
  day, switch the selected block's goal, or export. `?` opens a keyboard shortcuts sheet.
- **Highlight a goal**: clicking a goal in the week budget panel dims every other goal's
  blocks in the timeline. Click it again to clear.
- **Drag to reorder** goals and outcomes, by their grip handle (using the existing
  `sortOrder` column on each).
- **Running block / timer**: "Start now" in Day view's Actual header creates a block from
  now to now+snap; the clock tick extends it until "Stop timer", never past midnight. The
  running block's title shows in the window title.
- **Split at midnight**: dragging a block's end past 24:00 trims it to midnight and creates
  an unlinked continuation on the next day, instead of silently clamping. Blocks still never
  cross midnight.
- The window remembers its size, position and maximized state between launches.
- **Notifications** (each off by default, enable in Settings): an upcoming-block reminder 5
  minutes before it starts, an evening nudge for unconfirmed blocks, and a weekly-review
  notification on the last day of the week. Scheduled from the app's own clock while it's
  running — no background process.
- **Tray icon**: shows today's next (or running) plan block, with Start timer, Confirm
  rest of day, Show/Hide and Quit. "Close to tray" in Settings keeps the app running when
  the window is closed; otherwise closing the window quits as before.
- **Calendar import/export** (Settings → Calendar): import an `.ics` file as a read-only
  overlay in Day view, with a one-click "copy to plan" per event (recurring events show up
  once; they aren't expanded). Export your plan and actual blocks for a date range as a
  `.ics` file.

### Fixed
- A week that failed to load stayed empty for the rest of the session; navigating to it
  again now retries.
- After a failed save, changes queued behind it are discarded instead of being written on
  top of the reloaded data. The error now says that undo history was cleared.
- Closing the window waits (up to 3 s) for pending saves.
- Automatic backup failures are shown instead of only logged.

### Changed
- Only one copy of the app runs; a second launch focuses the existing window.
- The database bridge no longer lets the webview attach other files or run writes
  through `db_select`.
- Schema v2 validates colours, dates and flags on every write (existing rows are kept
  as they are).
- Week view re-renders only the lanes whose blocks, selection or clock changed.

## [0.1.0] - 2026-10-19

First release.

### Added
- **Day view** with side-by-side Plan and Actual lanes: drag to create, move and
  resize blocks (Shift for 5-minute steps, Ctrl to copy), overlapping blocks laid
  out in lanes, a now line, and a summary bar.
- **Ghosts**: plan blocks appear dashed in the Actual lane until you confirm (✓)
  or skip (✗) them. "Confirm rest of day" logs every past ghost around anything
  you already logged. Unconfirmed time never counts as actual.
- **Week view** with Plan | Actual split for past days and cross-day moves.
- **Goals** with weekly targets (at least / at most) that carry forward, outcome
  checklists with carry-over, archiving.
- **Week budget** side panel (Ctrl+B) and a **weekly review** with statuses,
  bullet charts, outcomes and a reflection note.
- Undo/redo for every edit, keyboard shortcuts, context menus.
- Local SQLite storage with automatic daily backups, JSON export/import,
  configurable week start, snap, default block length and theme.
