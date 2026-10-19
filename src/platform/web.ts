/**
 * Dev-only browser platform: sql.js database persisted to localStorage, file
 * download/upload instead of native dialogs. Never shipped in the desktop build.
 */
import wasmUrl from "sql.js/dist/sql-wasm-browser.wasm?url";
import { createSqlJsDriver } from "@/data/drivers/sqljsDriver";
import type { Platform, SystemTheme } from "./index";

const STORAGE_KEY = "timeblock.db";

function load(): Uint8Array | null {
  try {
    const b64 = localStorage.getItem(STORAGE_KEY);
    if (!b64) return null;
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function save(image: Uint8Array): void {
  let bin = "";
  for (let i = 0; i < image.length; i += 0x8000) bin += String.fromCharCode(...image.subarray(i, i + 0x8000));
  try {
    localStorage.setItem(STORAGE_KEY, btoa(bin));
  } catch (e) {
    console.warn("Could not persist the dev database to localStorage", e);
  }
}

const media = () => window.matchMedia("(prefers-color-scheme: dark)");
const current = (): SystemTheme => (media().matches ? "dark" : "light");

export const webPlatform: Platform = {
  kind: "web",
  createDriver: () => createSqlJsDriver({ wasmUrl, data: load(), onPersist: save }),
  backupNow: async () => null,
  backupIfStale: async () => null,
  listBackups: async () => [],
  restoreBackup: async () => {
    throw new Error("Backups are only available in the desktop app.");
  },
  async saveTextFile(defaultName, contents) {
    const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: defaultName });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return defaultName;
  },
  openTextFile() {
    return new Promise((resolve) => {
      const input = Object.assign(document.createElement("input"), { type: "file", accept: ".json,application/json" });
      input.onchange = async () => {
        const file = input.files?.[0];
        resolve(file ? { path: file.name, contents: await file.text() } : null);
      };
      input.oncancel = () => resolve(null);
      input.click();
    });
  },
  dataDir: async () => null,
  revealDataDir: async () => {},
  systemTheme: async () => current(),
  async onSystemThemeChange(cb) {
    const m = media();
    const listener = () => cb(current());
    m.addEventListener("change", listener);
    return () => m.removeEventListener("change", listener);
  },
  appVersion: async () => __APP_VERSION__,
  async guardClose(writes) {
    window.addEventListener("beforeunload", (e) => {
      if (writes.pending() > 0) e.preventDefault();
    });
  },
  async notify(id, title, body) {
    if (!("Notification" in window)) return;
    let permission = Notification.permission;
    if (permission === "default") permission = await Notification.requestPermission();
    if (permission !== "granted") return;
    const n = new Notification(title, { body, tag: String(id) });
    n.onclick = () => notificationClickListeners.forEach((cb) => cb(id));
  },
  async onNotificationClick(cb) {
    notificationClickListeners.add(cb);
    return () => notificationClickListeners.delete(cb);
  },
};

const notificationClickListeners = new Set<(id: number) => void>();
