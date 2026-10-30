/**
 * Browser platform (the website demo and dev mode): sql.js database persisted to localStorage,
 * file download/upload instead of native dialogs. Never used in the desktop build.
 */
import wasmUrl from "sql.js/dist/sql-wasm-browser.wasm?url";
import { createSqlJsDriver } from "@/data/drivers/sqljsDriver";
import { responseText, type Platform, type SystemTheme } from "./index";

/** Where the demo (and browser dev mode) keeps its database. */
export const STORAGE_KEY = "timeblock.db";

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

const MIME_TYPES: Record<string, string> = { json: "application/json", ics: "text/calendar" };

export const webPlatform: Platform = {
  kind: "web",
  createDriver: () => createSqlJsDriver({ wasmUrl, data: load(), onPersist: save }),
  backupNow: async () => null,
  backupIfStale: async () => null,
  listBackups: async () => [],
  restoreBackup: async () => {
    throw new Error("Backups are only available in the desktop app.");
  },
  async saveTextFile(defaultName, contents, filter) {
    const type = MIME_TYPES[filter.extensions[0] ?? ""] ?? "text/plain";
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const a = Object.assign(document.createElement("a"), { href: url, download: defaultName });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return defaultName;
  },
  openTextFile(filter) {
    return new Promise((resolve) => {
      const accept = filter.extensions.map((ext) => `.${ext}`).join(",");
      const input = Object.assign(document.createElement("input"), { type: "file", accept });
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
  async setTrayNextBlock() {},
  async setCloseToTray() {},
  async onTrayAction() {
    return () => {};
  },
  checkForUpdate: async () => null,
  installUpdate: async () => {},
  async openUrl(url) {
    window.open(url, "_blank", "noopener");
  },
  request: (url, init) => fetch(url, init),
  async fetchText(url) {
    let res: Response;
    try {
      res = await fetch(url, { headers: { Accept: "text/calendar, */*" } });
    } catch {
      // A CORS rejection and a network failure look the same from here (a bare TypeError).
      throw new Error(
        "The browser blocked this request. Most calendar hosts (Google, Outlook) don't allow web pages to read their feeds (CORS), so subscriptions work in the desktop app. You can still download the .ics and import the file.",
      );
    }
    return responseText(res);
  },
};

const notificationClickListeners = new Set<(id: number) => void>();
