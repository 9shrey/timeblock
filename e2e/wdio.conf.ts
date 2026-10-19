/**
 * End-to-end tests against the real Tauri app (WebKitGTK) via tauri-driver.
 *
 * Prerequisites (Linux): `cargo install tauri-driver --locked`, a `WebKitWebDriver`
 * binary (Fedora: webkitgtk6.0, Debian/Ubuntu: webkit2gtk-driver), and the e2e build:
 *   npm run e2e:build   # VITE_E2E=1 tauri build --debug --no-bundle
 *   npm run e2e
 *
 * Every run uses a throwaway XDG_DATA_HOME, so your real data is never touched.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const application = join(root, "src-tauri/target/debug/timeblock");
const nativeDriver = process.env.WEBKIT_WEBDRIVER ?? "/usr/bin/WebKitWebDriver";
// Created once by the launcher; spec workers inherit it through the environment.
const dataHome = (process.env.TIMEBLOCK_E2E_DATA ??= mkdtempSync(join(tmpdir(), "timeblock-e2e-")));

let driver: ChildProcess | undefined;

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./specs/**/*.e2e.ts"],
  maxInstances: 1,
  hostname: "127.0.0.1",
  port: 4444,
  capabilities: [{ "tauri:options": { application } } as WebdriverIO.Capabilities],
  logLevel: "warn",
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { ui: "bdd", timeout: 60_000 },
  // WebKitWebDriver occasionally drops the session mid-drag ("page crash or hang"); in CI,
  // rerun a failed spec file once so that doesn't fail the build. Locally, failures show.
  specFileRetries: process.env.CI ? 1 : 0,
  waitforTimeout: 10_000,
  strictSelectors: false,

  onPrepare() {
    if (!existsSync(application)) throw new Error(`Missing ${application}. Run \`npm run e2e:build\` first.`);
    if (!existsSync(nativeDriver)) throw new Error(`Missing WebKitWebDriver at ${nativeDriver} (set WEBKIT_WEBDRIVER).`);
  },

  // One tauri-driver per worker; the app inherits its environment (isolated data dir).
  beforeSession() {
    driver = spawn("tauri-driver", ["--port", "4444", "--native-driver", nativeDriver], {
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, XDG_DATA_HOME: dataHome },
    });
    return new Promise((r) => setTimeout(r, 1500));
  },

  afterSession() {
    driver?.kill();
  },

  onComplete() {
    rmSync(dataHome, { recursive: true, force: true });
  },
};
