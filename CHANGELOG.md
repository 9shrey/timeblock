# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
