# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
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
