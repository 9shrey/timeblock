/**
 * Host integration. The Tauri implementation talks to Rust commands; the web one
 * (plain browser, e.g. the GitHub Pages build) uses sql.js + localStorage.
 */
import { isTauri } from "@tauri-apps/api/core";
import type { SqlDriver } from "@/data/drivers/SqlDriver";

export type SystemTheme = "light" | "dark";

export interface OpenedFile {
  path: string;
  contents: string;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export const JSON_FILTER: FileFilter = { name: "JSON", extensions: ["json"] };
export const ICS_FILTER: FileFilter = { name: "Calendar", extensions: ["ics"] };
export const CSV_FILTER: FileFilter = { name: "CSV", extensions: ["csv"] };

export interface BackupInfo {
  name: string;
  /** Unix seconds. */
  createdAt: number;
  sizeBytes: number;
}

export interface Platform {
  readonly kind: "tauri" | "web";
  createDriver(): Promise<SqlDriver>;
  /** Returns the backup path, or null where backups are unsupported (web). */
  backupNow(reason: string): Promise<string | null>;
  backupIfStale(maxAgeHours: number): Promise<string | null>;
  /** Newest first; empty where backups are unsupported (web). */
  listBackups(): Promise<BackupInfo[]>;
  /** Replaces the live data with a backup (after backing up the current data). Reload afterwards. */
  restoreBackup(name: string): Promise<void>;
  /** Save dialog; returns the path written, or null if cancelled. */
  saveTextFile(defaultName: string, contents: string, filter: FileFilter): Promise<string | null>;
  /** Open dialog; null if cancelled. */
  openTextFile(filter: FileFilter): Promise<OpenedFile | null>;
  dataDir(): Promise<string | null>;
  revealDataDir(): Promise<void>;
  systemTheme(): Promise<SystemTheme>;
  onSystemThemeChange(cb: (theme: SystemTheme) => void): Promise<() => void>;
  appVersion(): Promise<string>;
  /** Keeps the window open until queued writes are saved (desktop) or warns before leaving (web). */
  guardClose(writes: { flush(): Promise<void>; pending(): number }): Promise<void>;
  /**
   * Shows a desktop notification tagged with `id`, requesting permission first if it hasn't
   * been granted or denied yet. A denied permission (or an unsupported platform) makes this
   * a silent no-op.
   */
  notify(id: number, title: string, body: string): Promise<void>;
  /** Fires with `id` when the user clicks a notification shown by `notify`. */
  onNotificationClick(cb: (id: number) => void): Promise<() => void>;
  /** Sets the "Today's next block" line in the tray menu. No-op where there is no tray (web). */
  setTrayNextBlock(label: string | null): Promise<void>;
  /** Whether closing the window hides it to the tray instead of quitting. No-op on web. */
  setCloseToTray(enabled: boolean): Promise<void>;
  /** Fires when a tray menu action needing app state (not just show/hide/quit) is clicked. */
  onTrayAction(cb: (action: TrayAction) => void): Promise<() => void>;
  /**
   * GETs an `https://` URL as text (a calendar subscription). Desktop goes through the Tauri
   * http plugin, scoped to https; the browser uses `fetch`, which most calendar hosts block
   * with CORS. Rejects with a readable message on a network error or a non-2xx status.
   */
  fetchText(url: string): Promise<string>;
  /** The newer release, or null if up to date. Always null on web. Rejects if the check fails. */
  checkForUpdate(): Promise<UpdateInfo | null>;
  /** Downloads and installs the update found by the last `checkForUpdate`, then restarts. */
  installUpdate(): Promise<void>;
}

export interface UpdateInfo {
  version: string;
  notes: string | null;
}

/** The body of a successful response, or a readable error for a failed one. */
export async function responseText(res: Response): Promise<string> {
  if (!res.ok) throw new Error(`The server answered ${res.status}${res.statusText ? ` ${res.statusText}` : ""}.`);
  return res.text();
}

export type TrayAction = "startTimer" | "confirmRestOfDay";

export { isTauri };

let platform: Promise<Platform> | null = null;

export function getPlatform(): Promise<Platform> {
  platform ??= (async () => {
    if (isTauri()) return (await import("./tauri")).tauriPlatform;
    return (await import("./web")).webPlatform;
  })();
  return platform;
}
