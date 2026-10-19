# Tauri 2 ecosystem research for the time-block/goals desktop app (verified 2026-10-18)

Each fact cites a URL. **[UNVERIFIED]** marks things I could not confirm from an official source or from source code. Some local machine facts came from read-only `rpm`, `lspci` and `/proc` queries; they are marked "(local)".

**Local machine (local):** NVIDIA GTX 1650 Mobile on the proprietary open-kernel driver 615.71.09, `nvidia_drm.modeset=Y`. KDE Plasma 6.7.5 on Wayland. `webkit2gtk4.1-2.54.0` and `webkitgtk6.0-2.54.0` are installed. Several of the Linux rendering issues in section 6 were reported on exactly this stack.

---

## 1. Versions and scaffolding

| Package | Latest stable | Note |
|---|---|---|
| `tauri` (crate) | **2.12.4** (2026-10-14) | `3.0.0-alpha.5` also exists. Do not use it. https://crates.io/api/v1/crates/tauri |
| `tauri-build` | 2.7.3 | https://crates.io/crates/tauri-build |
| `tauri-cli` (cargo) / `@tauri-apps/cli` (npm) | **2.12.3** | npm `next` tag = 3.0.0-alpha.5. https://registry.npmjs.org/@tauri-apps/cli |
| `@tauri-apps/api` | **2.12.4** | https://registry.npmjs.org/@tauri-apps/api |
| `create-tauri-app` | **4.7.5** (2026-10-09) | https://registry.npmjs.org/create-tauri-app |
| sql plugin (crate + npm) | 2.6.0 | https://crates.io/crates/tauri-plugin-sql |
| fs plugin | 2.7.1 | https://crates.io/crates/tauri-plugin-fs |
| dialog plugin | 2.8.3 | https://crates.io/crates/tauri-plugin-dialog |
| opener plugin | 2.7.2 | |
| vite | 8.3.4 | |
| react | 19.3.1 | |
| @vitejs/plugin-react | 6.1.2 | |
| vitest | 5.0.5 (needs Node ^22.12 / 24 / 26+) | |
| typescript | 7.0.2 is latest | The template pins `~6.0.3`; keep that unless you upgrade on purpose |
| rusqlite | 0.40.2 | |
| rusqlite_migration | 2.6.0 (needs rusqlite ^0.40) | |

- Tauri and the plugins require Rust 1.90 or newer and use **edition 2024** (https://raw.githubusercontent.com/tauri-apps/tauri/dev/Cargo.toml). The template's `Cargo.toml` is also edition 2024. Local rustc 1.97 is fine.

**Non-interactive flags** (from `src/args.rs` in https://github.com/tauri-apps/create-tauri-app):
- `-m/--manager`, `-t/--template`, `-y/--yes`, `-f/--force`, `--identifier`, `--tauri-version [1|2]` (defaults to 2).
- npm 7+ needs `--` before the flags (https://raw.githubusercontent.com/tauri-apps/create-tauri-app/dev/README.md).

**Scaffold command.** Run it from the parent directory and pass the existing empty directory's name:
```fish
cd /home/shrey/Documents/Codes
npm create tauri-app@latest calendar_goals_webapp -- --template react-ts --manager npm --identifier io.github.<ghuser>.timeblock --tauri-version 2 --yes
cd calendar_goals_webapp; npm install
```

Why this form (from `src/lib.rs` and `src/utils/mod.rs`):
- **Don't use `.` as the name.** `to_valid_pkg_name(".")` becomes `"tauri-app"`, so the package name and productName would both be `tauri-app`.
- **An existing empty directory is accepted.** The overwrite prompt only appears if the directory is non-empty.
- **Always pass `--identifier`.** With `-y` the default identifier is `com.<user>.<package_name>`, which here is `com.shrey.calendar_goals_webapp`. Underscores are rejected by `tauri build` (see section 9).

**What the template produces:**
- `tauri.conf.json`: `devUrl http://localhost:1420`, `beforeDevCommand "npm run dev"`, `beforeBuildCommand "npm run build"`, `frontendDist "../dist"`, an 800x600 window, `csp: null`.
- Capabilities: `core:default` and `opener:default`.
- `lib.rs` uses `tauri_plugin_opener`. The Rust library is named `<pkg>_lib` (here `calendar_goals_webapp_lib`).
- Release profile: `lto`, `strip`, `panic=abort`.
- Vite config: `strictPort` on 1420, ignores `src-tauri` when watching.

Template sources: https://github.com/tauri-apps/create-tauri-app/tree/dev/templates/_base_/src-tauri and https://github.com/tauri-apps/create-tauri-app/tree/dev/templates/template-react-ts

## 2. Fedora packages

**Official Fedora command** (https://v2.tauri.app/start/prerequisites/):
```fish
sudo dnf check-update
sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file libappindicator-gtk3-devel librsvg2-devel libxdo-devel
sudo dnf group install "c-development"
```

- **Pulled in automatically:** `webkit2gtk4.1-devel` brings `libsoup3-devel`, `javascriptcoregtk4.1-devel` and `gtk3-devel` (https://packages.fedoraproject.org/pkgs/webkitgtk/webkit2gtk4.1-devel/fedora-44.html).
- **Still missing on this machine (local):** webkit2gtk4.1-devel, libappindicator-gtk3-devel, librsvg2-devel, libxdo-devel, wget.
- **Already present:** gcc, g++, make, openssl-devel, file, curl, gtk3-devel, rpm-build, fuse-libs.
- `libappindicator-gtk3-devel` is only really needed if you use a tray icon. Installing it anyway is harmless.

**Building bundles locally:**
- **.rpm:** nothing extra. The bundler builds it in pure Rust with the `rpm` crate; `rpmbuild` is not used (https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle/linux/rpm.rs).
- **.deb:** nothing extra. It uses the `ar` and `tar` crates, no `dpkg` (`.../bundle/linux/debian.rs`).
- **.AppImage:** the bundler downloads linuxdeploy and its plugins at build time, so it needs network. It sets `APPIMAGE_EXTRACT_AND_RUN=1` and `ARCH` itself, so FUSE is not required (`.../appimage/linuxdeploy.rs`).
  - On distros whose libraries use `.relr.dyn` relocations, linuxdeploy's old `strip` fails with "failed to run linuxdeploy". The workaround is `NO_STRIP=true npm run tauri build` (https://github.com/tauri-apps/tauri/issues/11149, https://github.com/tauri-apps/tauri/issues/15106). That this hits Fedora 44 specifically is **[UNVERIFIED]**; it was reported on Arch.
  - An AppImage built on Fedora 44 inherits its newer glibc. The docs say to build on the oldest base system you want to support (https://v2.tauri.app/distribute/appimage/).
  - **Recommendation:** locally run `npm run tauri build -- --bundles rpm`, and leave AppImage and .deb to CI.

## 3. SQLite persistence

### (a) tauri-plugin-sql 2.6.0
Docs: https://v2.tauri.app/plugin/sql/

**Install:**
```fish
npm run tauri add sql
cd src-tauri; cargo add tauri-plugin-sql --features sqlite
```
- `tauri add` cannot set crate features, so you must add `sqlite` yourself (it has no features option; https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-cli/src/add.rs).
- `tauri add` does add `sql:default` to the capability and inserts the `.plugin(...)` line into `lib.rs`.

**Rust setup with migrations** (struct fields verified in https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/sql/src/lib.rs):
```rust
use tauri_plugin_sql::{Migration, MigrationKind};
let migrations = vec![Migration { version: 1, description: "init", sql: "CREATE TABLE ...;", kind: MigrationKind::Up }];
tauri::Builder::default()
  .plugin(tauri_plugin_sql::Builder::default().add_migrations("sqlite:timeblock.db", migrations).build())
```
- Only `Up` migrations ever run; `Down` is never executed.
- Migrations run at startup for databases listed in `tauri.conf.json` under `"plugins": {"sql": {"preload": ["sqlite:timeblock.db"]}}`. Otherwise they run on the first `Database.load`.

**JS API** (https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/sql/guest-js/index.ts):
- `Database.load('sqlite:timeblock.db', { autoCreate? })` (the options argument is new in 2.6.0).
- `db.execute(sql, values)` returns `{ rowsAffected, lastInsertId }`.
- `db.select<T>(sql, values)` returns rows as objects keyed by column name.
- `db.close()`.
- **Placeholders are `$1, $2…` for SQLite and Postgres**; `?` is only for MySQL.

**Where the file lives:** the path is relative to **`app_config_dir`**, not the data dir (`wrapper.rs`: `.path().app_config_dir()`). On Linux that is `~/.config/<identifier>/timeblock.db` (https://v2.tauri.app/reference/javascript/api/namespacepath/).

**Permissions:**
- `sql:default` only grants `allow-load`, `allow-select` and `allow-close`. You must add **`sql:allow-execute`** for writes.
- Each has a matching `deny-*` (https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/sql/permissions/default.toml).

**Caveats:**
- **No transactions.** Each call checks out its own pooled connection (sqlx default pool), so `BEGIN`/`COMMIT` sent as separate `execute` calls runs on different connections and can cause "database is locked". The issue is open, last activity 2026-10-01 (https://github.com/tauri-apps/plugins-workspace/issues/886).
- Whether several statements can go in one `execute` string, with bound parameters, is **[UNVERIFIED]**.
- sqlx turns `foreign_keys` on by default, uses a 5 s busy timeout, and leaves the journal mode unchanged (https://docs.rs/sqlx/0.8/sqlx/sqlite/struct.SqliteConnectOptions.html).

### (b) Your own Rust commands with rusqlite 0.40 (`features = ["bundled"]`) and rusqlite_migration 2.6
- **Pros:**
  - Real transactions, so "copy plan into actual", "import backup" and "reset week" can each be atomic.
  - You choose where the file lives (for example `app.path().app_data_dir()`, which is `~/.local/share/<id>/` on Linux).
  - One connection, no pool races.
- **Cons:** more Rust code, and TS/Rust types have to be kept in sync by hand or with ts-rs/specta.
- **You can't use both in one app.** plugin-sql pulls in `libsqlite3-sys ^0.30` (through sqlx 0.8), while rusqlite 0.40 needs `^0.38`. `libsqlite3-sys` declares `links = "sqlite3"`, so Cargo refuses to have both versions. The only rusqlite that matches plugin-sql 2.6 is 0.32.x. Verified via the crates.io dependency API.
- rusqlite 0.40 has no `serde_json` feature, so you need a small hand-written mapping from `serde_json::Value` to `rusqlite::types::Value`.

**Recommendation for this app (mostly TS domain logic, small data, needs atomic import/copy):**
- Use **rusqlite with a thin, generic Rust bridge**, and keep all SQL and repository code in TS. The bridge has three commands: `db_select(sql, params)`, `db_execute(sql, params)` and `db_batch(stmts[])`, where `db_batch` runs inside `conn.transaction()`.
- Run migrations with `rusqlite_migration`: `Migrations::from_slice(&[M::up(..)]).to_latest(&mut conn)` (https://github.com/cljoly/rusqlite_migration).
- Set WAL with `pragma_update_and_check(None, "journal_mode", &"WAL", |_| Ok(()))` and turn `foreign_keys` on, in `.setup()`. Store the connection as `app.manage(Db(Mutex<Connection>))`.
- Use SQLite-native `?1, ?2` placeholders. The same SQL then runs in Vitest against Node's built-in `node:sqlite` with an in-memory DB. I confirmed this works on local Node 22.23.1 (SQLite 3.51.2) with only an ExperimentalWarning.
- Exposing generic SQL to the webview is no more risky than `sql:allow-execute`, as long as you load no remote content and set a CSP.
- **If you'd rather write zero Rust,** plugin-sql is fine, with three rules: never use BEGIN across calls, write multi-row operations as single statements (`INSERT … SELECT`, `json_each($1)`), and auto-export a backup before any import.

## 4. Export and import (dialog + fs plugins)

**Install** (each command also adds `<plugin>:default` and the init line):
```fish
npm run tauri add dialog
npm run tauri add fs
```
Rust registration: `.plugin(tauri_plugin_dialog::init()).plugin(tauri_plugin_fs::init())` (https://v2.tauri.app/plugin/dialog/, https://v2.tauri.app/plugin/file-system/).

```ts
import { save, open } from '@tauri-apps/plugin-dialog';
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs';
import { documentDir, join } from '@tauri-apps/api/path';

export async function exportBackup(data: unknown) {
  const path = await save({ title: 'Export backup',
    defaultPath: await join(await documentDir(), `timeblock-${new Date().toISOString().slice(0,10)}.json`),
    filters: [{ name: 'JSON', extensions: ['json'] }] });          // string | null
  if (!path) return false;
  await writeTextFile(path, JSON.stringify(data, null, 2));
  return true;
}
export async function importBackup() {
  const path = await open({ multiple: false, directory: false, filters: [{ name: 'JSON', extensions: ['json'] }] }); // string | null
  return path ? JSON.parse(await readTextFile(path)) : null;
}
```

- **Scope:** any path the user picks in a dialog is automatically added, at runtime, to the fs plugin's scope. This is not persisted across restarts.
  - Confirmed in `dialog/src/commands.rs` (`window.try_fs_scope()…allow_file`) and the fs `resolve_path` check `fs_scope.scope.is_allowed(..) || scope.is_allowed(..)`.
  - Docs: https://v2.tauri.app/reference/javascript/dialog/
  - So the bare permissions `fs:allow-write-text-file` and `fs:allow-read-text-file` are enough, with no static scope.
- **Defaults:**
  - `dialog:default` = allow-message, allow-save, allow-open.
  - `fs:default` = read access to the app directories, mkdir for them, and a deny on the webview data folders (https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/fs/permissions/default.toml).
- **Native KDE file dialog:** the dialog plugin has a `xdg-portal` feature (the default is `gtk3`): `tauri-plugin-dialog = { version = "2", default-features = false, features = ["xdg-portal"] }` (https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/dialog/Cargo.toml). The runtime behaviour on KDE is **[UNVERIFIED]**.
- **Alternative without the fs plugin:** use dialog only to get the path, then a custom Rust command that does `std::fs::write` and `read_to_string`.

## 5. Capability file, `src-tauri/capabilities/default.json`

Format: https://v2.tauri.app/security/capabilities/
- Every file in `capabilities/` is enabled automatically, unless `app.security.capabilities` in `tauri.conf.json` lists specific ones.
- The window label defaults to `"main"` (https://schema.tauri.app/config/2).

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default",
    "sql:default",
    "sql:allow-execute",
    "dialog:allow-save",
    "dialog:allow-open",
    "fs:allow-read-text-file",
    {
      "identifier": "fs:allow-write-text-file",
      "allow": [{ "path": "$APPDATA/backups/*" }]
    }
  ]
}
```
- The scoped `allow` entry is optional. It is only needed for silent auto-backups into `$APPDATA`; dialog-picked paths are already allowed at runtime.
- If you use the rusqlite bridge, drop the `sql:*` entries. Your own commands need no permission unless you define one.

## 6. Linux rendering (KDE Wayland, NVIDIA, WebKitGTK 2.54)

**Official guidance** (https://v2.tauri.app/develop/debug/linux-graphics/ and the open issues https://github.com/tauri-apps/tauri/issues/9394, https://github.com/tauri-apps/tauri/issues/10702, active 2026-10-17). Symptoms are a blank or white window, flicker, a crash on resize, `AcceleratedSurfaceDMABuf…framebuffer`, or `Error 71 (Protocol error)`. Try these in order:
1. KMS on (already true here).
2. **`__NV_DISABLE_EXPLICIT_SYNC=1`**: fixes Error 71 with no performance cost.
3. `WEBKIT_DISABLE_DMABUF_RENDERER=1`: slower rendering path.
4. `WEBKIT_DISABLE_COMPOSITING_MODE=1`: last resort, turns off acceleration.
5. Fallback to XWayland: `GDK_BACKEND=x11`, reported in #9394.

**WebKitGTK 2.54 changes the advice:**
- 2.54 turns on the Skia compositor by default. To test whether a problem is a Skia regression, set `WEBKIT_USE_SKIA_FOR_COMPOSITION=0` (Igalia, 2026-09-21: https://blogs.igalia.com/carlosgc/2026/09/21/skia-compositor-for-wpe-webkit-and-webkitgtk/).
- Downstream reports on **exactly this stack** (Fedora 44, WebKitGTK 2.54.0, NVIDIA 615.71.09, KWin 6.7.5) found:
  - Forcing `WEBKIT_DISABLE_DMABUF_RENDERER=1` on 2.54 causes partial painting and flicker.
  - Transparent windows got clipped.
  - What worked: an opaque window, `__NV_DISABLE_EXPLICIT_SYNC=1`, and not overriding a value the user already set.
  - Sources: https://github.com/NC1107/sink/issues/78, https://github.com/cjpais/Handy/issues/2166. These are community reports, not official.
- **Practical advice:**
  - Keep `transparent: false` (the default).
  - First run `npm run tauri dev` with no variables set. If it misbehaves, try `__NV_DISABLE_EXPLICIT_SYNC=1 npm run tauri dev`; fish 4.6 accepts `VAR=val cmd`.
  - Never hard-code DMABUF overrides unconditionally.

**Code caveat:** the docs' `std::env::set_var` example will not compile in an edition-2024 crate. `set_var` is `unsafe` there (https://doc.rust-lang.org/edition-guide/rust-2024/newly-unsafe-functions.html). Use:
```rust
fn main() {
    #[cfg(target_os = "linux")]
    if std::env::var_os("__NV_DISABLE_EXPLICIT_SYNC").is_none() && std::path::Path::new("/sys/module/nvidia").exists() {
        unsafe { std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1") } // SAFETY: before any threads spawn
    }
    calendar_goals_webapp_lib::run()
}
```
Checking `/sys/module/nvidia` as the NVIDIA detection is my suggestion **[UNVERIFIED as a best practice]**.

## 7. GitHub Actions release workflow

**Action version:** `tauri-apps/tauri-action@v1`. v1.0.0 was released 2026-06-29 and dropped Tauri v1 support (https://api.github.com/repos/tauri-apps/tauri-action/releases).

**Official example** (https://v2.tauri.app/distribute/pipelines/github/):
- Uses `actions/checkout@v7`, `actions/setup-node@v6`, `dtolnay/rust-toolchain@stable` with both Apple targets, and `swatinem/rust-cache@v2`.
- Ubuntu packages: `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf xdg-utils`.
- Needs `permissions: contents: write`. If you get access errors, set the repo's Settings → Actions → Workflow permissions to "Read and write".

**Change the docs' `ubuntu-22.04`:** that image entered deprecation on 2026-09-17, has brownouts in March–April 2027, and is removed on 2027-04-17 (https://github.com/actions/runner-images/issues/14254). `libwebkit2gtk-4.1-dev` and `libappindicator3-dev` both exist on 24.04 (packages.ubuntu.com). The trade-off is that AppImages built on 24.04 need glibc 2.39 or newer.

**Duplicate draft releases** from parallel matrix jobs were fixed in PR #1285 (merged 2026-03-06), though issue #914 is still open. For full robustness, use the create-release job → `releaseId` → publish pattern from `examples/publish-to-manual-release.yml`.

**macOS:** unsigned Apple Silicon builds can show up as "damaged". Set `"bundle": {"macOS": {"signingIdentity": "-"}}` for ad-hoc signing; users still have to allow the app in Privacy & Security (https://v2.tauri.app/distribute/sign/macos/#ad-hoc-signing). For a single macOS build, use `--target universal-apple-darwin` instead (from the tauri-action examples).

```yaml
name: release
on:
  push:
    tags: ['v*']
jobs:
  publish-tauri:
    permissions:
      contents: write
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: macos-latest
            args: --target aarch64-apple-darwin
          - platform: macos-latest
            args: --target x86_64-apple-darwin
          - platform: ubuntu-24.04
            args: ''
          - platform: windows-latest
            args: ''
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v7
      - name: install Linux deps
        if: startsWith(matrix.platform, 'ubuntu')
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf xdg-utils
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: npm
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.platform == 'macos-latest' && 'aarch64-apple-darwin,x86_64-apple-darwin' || '' }}
      - uses: swatinem/rust-cache@v2
        with:
          workspaces: './src-tauri -> target'
      - run: npm ci
      - run: npm test            # "test": "vitest run"
      - uses: tauri-apps/tauri-action@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: ${{ github.ref_name }}        # tag already exists; action creates the draft release
          releaseName: 'Timeblock ${{ github.ref_name }}'
          releaseBody: 'Unsigned builds - see README for install notes.'
          releaseDraft: true
          prerelease: false
          args: ${{ matrix.args }}
```
- Windows produces both `.msi` and NSIS `-setup.exe` with `"targets": "all"`.
- Keep the version in `tauri.conf.json` equal to the tag. You can set `"version": "../package.json"`, which the schema accepts.

## 8. Testing

**Unit tests (Vitest 5):** put `/// <reference types="vitest/config" />` in `vite.config.ts` and add a `test: {}` block (https://vitest.dev/config/).
- Pure domain code (week math, plan vs actual diffs, per-goal hour totals) runs in the `node` environment.
- Components run under jsdom or happy-dom with React Testing Library.

**Mocking Tauri calls:** import `mockIPC`, `mockWindows` and `clearMocks` from `@tauri-apps/api/mocks`.
- Call `clearMocks()` after each test.
- jsdom has no WebCrypto, so it needs the docs' `crypto.getRandomValues` polyfill.
- `shouldMockEvents` is available since 2.7.0.
- Docs: https://v2.tauri.app/develop/tests/mocking/
- `isTauri()` is exported from `@tauri-apps/api/core`, so the app can swap in an in-memory repository when running in a plain browser.

**Lightweight end-to-end option:** Playwright 1.64.1 against `npm run dev`, with an in-memory repository or mockIPC injected via `addInitScript`.
- Officially supported Linux distros are only Debian 12/13 and Ubuntu 22.04/24.04/26.04 (https://playwright.dev/docs/intro).
- So running it on Fedora is **[UNVERIFIED]** (Chromium usually works; `--with-deps` will not, since it uses apt). Run it in CI on Ubuntu.
- Chromium is not WebKitGTK, so this does not test the real webview.

**Real end-to-end:**
- **Recommended:** WebdriverIO with `@wdio/tauri-service` 1.5.0. Its default "embedded" provider uses the app plugin `tauri-plugin-wdio-webdriver` 1.5.0 and works on Linux, macOS and Windows (https://v2.tauri.app/develop/tests/webdriver/).
- **Or:** `cargo install tauri-driver --locked` (2.1.0) plus the native WebKitWebDriver. This route is Linux and Windows only (https://v2.tauri.app/develop/tests/webdriver/manual-setup/).
- On Ubuntu CI, install `webkit2gtk-driver` and `xvfb` and run under `xvfb-run` (`develop/Tests/WebDriver/ci.md`).
- **Fedora:** `/usr/bin/WebKitWebDriver` is already installed (local) and comes from the **`webkitgtk6.0`** package. There is no separate driver subpackage for webkit2gtk4.1. Whether it can drive a webkit2gtk-4.1 app (both are 2.54.0) is **[UNVERIFIED]**.
- **Rust tests:** test the repository layer with `Connection::open_in_memory()` plus the migrations.

## 9. Other things to know

**Identifier rules** (https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-cli/src/build.rs; schema https://schema.tauri.app/config/2):
- Only `A-Z a-z 0-9 - .` are allowed, so no underscores.
- `com.tauri.dev` is rejected.
- An identifier ending in `.app` triggers a warning.
- The identifier sets the data paths (`~/.config/<id>`, `~/.local/share/<id>`). Fix it before the first release, because changing it later makes existing data seem to disappear.

**`tauri.conf.json` essentials:**
- Keep the template's `build` block.
- Set `productName`, then add `app.windows[0]`: `{ "label": "main", "title": "Timeblock", "width": 1280, "height": 860, "minWidth": 900, "minHeight": 600 }`.
- Bundle settings: `"category": "Productivity"` (a valid enum value), `"license"`, `"macOS": {"signingIdentity": "-"}`.

**Drag and drop:** `dragDropEnabled` defaults to true, and that **breaks HTML5 drag-and-drop on Windows**. Either set it to `false`, or use a pointer-event library such as dnd-kit (schema: WindowConfig.dragDropEnabled). This matters for dragging and resizing blocks.

**CSP:** the template ships `csp: null`, which means no CSP is enforced.
- The docs' example is `"default-src": "'self'"` and `"connect-src": "ipc: http://ipc.localhost"`. Tauri adds nonces and hashes for bundled assets at compile time (https://v2.tauri.app/security/csp/).
- `devCsp` defaults to `csp`. If Vite HMR breaks in dev, set `"devCsp": null` **[UNVERIFIED that it's needed]**.
- Test the CSP in a release build.

**Icons:** run `npm run tauri icon ./app-icon.png`. The input must be a square PNG or SVG with transparency. Output goes to `src-tauri/icons/` (32x32, 128x128, 128x128@2x, icon.icns, icon.ico, Square*Logo), and these are referenced in `bundle.icon` (https://v2.tauri.app/develop/icons/). A 1024x1024 source is customary but **not stated in the docs**.

**Other:**
- `npm run tauri info` diagnoses missing dependencies.
- The first `tauri dev` compiles roughly 400 crates.
- Debug builds have devtools via right-click → Inspect.
- Optional: a single-instance plugin, so two app instances never write the DB at once; a window-state plugin **[versions not checked]**.
- Don't use any `@next` or 3.0-alpha packages. Every plugin's `next` tag points to 3.0.0-alpha.

### Critical Files for Implementation
- /home/shrey/Documents/Codes/calendar_goals_webapp/src-tauri/tauri.conf.json
- /home/shrey/Documents/Codes/calendar_goals_webapp/src-tauri/capabilities/default.json
- /home/shrey/Documents/Codes/calendar_goals_webapp/src-tauri/src/lib.rs (plugins, DB setup/migrations, bridge commands)
- /home/shrey/Documents/Codes/calendar_goals_webapp/src-tauri/src/main.rs (Linux NVIDIA env workaround, edition-2024 `unsafe`)
- /home/shrey/Documents/Codes/calendar_goals_webapp/.github/workflows/release.yml