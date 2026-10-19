# Timeblock

Time-block your day (**Plan**), correct it to what really happened (**Actual**), and see
how each weekly goal's target and outcomes compare with the time you planned and spent.

Timeblock is a local-first desktop app (Tauri 2, React, TypeScript). Your data is a
SQLite file on your machine: no account, no server, no telemetry.

## Features

- **Plan | Actual day view.** Drag to create, move and resize blocks; Shift snaps to
  5 minutes, Ctrl copies. Overlapping blocks sit side by side.
- **Ghosts.** Every plan block shows up dashed in the Actual lane until you confirm it
  (✓, `a`) or skip it (✗, `s`). Drag a ghost to log it at a different time. *Confirm rest
  of day* (`Shift+A`) logs every past ghost around whatever you already logged.
  Unconfirmed time never counts as actual, so your numbers stay honest.
- **Week view** with Plan | Actual split for past days; drag blocks across days.
- **Goals** with weekly targets, either *at least* (e.g. Thesis ≥ 15 h) or *at most*
  (e.g. Social ≤ 3 h). Targets carry forward until you change them; past weeks never
  change. Each goal has an outcome checklist per week, with carry-over.
- **Week budget** panel (`Ctrl+B`) and a **weekly review**: target vs plan vs actual,
  status per goal, outcomes and a reflection note.
- Undo/redo for everything, keyboard shortcuts, daily automatic backups, JSON
  export/import.

### Keyboard shortcuts

| Keys | Action |
|---|---|
| `d` `w` `g` `r` | Day, Week, Goals, Review |
| `t`, `[`, `]` | Today, previous, next |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |
| `Ctrl+B` | Week budget panel |
| `Enter` | Edit the selected block |
| `Delete` | Delete the selected block (skips a ghost) |
| `↑` `↓` / `Shift+↑` `Shift+↓` | Nudge / resize the selected block |
| `1`–`9` | Set the selected block's goal |
| `a` / `s` | Confirm / skip the selected plan block or ghost |
| `Shift+A` | Confirm the rest of the day as planned |
| `Esc` | Cancel a drag, close the editor, clear the selection |

## Install

Download the file for your system from the [Releases](../../releases) page. Builds are
not code-signed yet.

- **Linux:** `.rpm` (Fedora), `.deb` (Debian/Ubuntu) or `.AppImage`. The AppImage needs
  glibc 2.39 or newer (Fedora 40+, Ubuntu 24.04+); use the `.rpm`/`.deb` on older systems.
- **macOS:** open the `.dmg` and drag Timeblock to Applications. The first launch is
  blocked because the app isn't notarized: open *System Settings → Privacy & Security*
  and click **Open Anyway**.
- **Windows:** run the `.msi` or `-setup.exe`. If SmartScreen warns about an
  unrecognized app, click **More info → Run anyway**.

Run only one copy of Timeblock at a time: two windows writing the same database can
overwrite each other's changes.

## Your data and backups

| OS | Folder |
|---|---|
| Linux | `~/.local/share/com.shreysingh.timeblock/` |
| macOS | `~/Library/Application Support/com.shreysingh.timeblock/` |
| Windows | `%APPDATA%\com.shreysingh.timeblock\` |

- `data.sqlite3` holds everything. *Settings → Open data folder* opens it.
- `backups/` gets a copy at most once a day, before every import and before schema
  upgrades; the newest 14 are kept. To restore one, quit Timeblock and copy it over
  `data.sqlite3`.
- *Settings → Export JSON* writes a readable file you can keep or import elsewhere.

## Troubleshooting: blank or flickering window on Linux (Wayland, NVIDIA)

WebKitGTK and the proprietary NVIDIA driver don't always get along. Timeblock already
sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` when the NVIDIA kernel module is loaded (unless
you set it yourself). If the window is still blank or flickers, try these one at a time:

```bash
WEBKIT_DISABLE_COMPOSITING_MODE=1 timeblock
__NV_DISABLE_EXPLICIT_SYNC=1 timeblock
GDK_BACKEND=x11 timeblock
```

## Development

Prerequisites: Node 22+, Rust (stable), and the
[Tauri system dependencies](https://tauri.app/start/prerequisites/). On Fedora:

```bash
sudo dnf install webkit2gtk4.1-devel libappindicator-gtk3-devel librsvg2-devel libxdo-devel openssl-devel gcc make
```

```bash
npm install
npm run dev          # browser mode on http://localhost:1420 (sql.js, data in localStorage)
npm run tauri dev    # native app
npm run lint         # ESLint + tsc
npm test             # Vitest (domain, data layer, store, components)
npm run test:tz      # domain tests under UTC and Pacific/Chatham
```

End-to-end tests drive the real app window through WebDriver (Linux): install
[`tauri-driver`](https://crates.io/crates/tauri-driver) and WebKitGTK's `WebKitWebDriver`
(Fedora: `webkitgtk6.0`, Debian/Ubuntu: `webkit2gtk-driver`), then:

```bash
cargo install tauri-driver --locked
npm run e2e:build    # debug app with the test switches enabled
npm run e2e          # 30 tests; uses a throwaway data folder, never your real data
```

Browser-mode URL switches (development only):

- `?seed=demo` loads two weeks of demo data.
- `?reset=1` clears all data.
- `?now=2026-10-21T14:00` freezes the clock.

`VITE_DEV_SEED=demo npm run tauri dev` seeds an empty native database.

Rust checks (build the frontend first, `generate_context!` reads `dist/`):

```bash
npm run build && cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

Design notes live in [docs/design/](docs/design/); start with
[implementation-plan.md](docs/design/implementation-plan.md).

### Releasing

Bump `version` in `package.json`, add a CHANGELOG entry, then push a matching tag
(`git tag v0.1.0 && git push --tags`). CI builds Linux, macOS and Windows bundles into a
draft GitHub release.

## License

[MIT](LICENSE)
