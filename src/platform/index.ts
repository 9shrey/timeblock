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
  saveTextFile(defaultName: string, contents: string): Promise<string | null>;
  /** Open dialog; null if cancelled. */
  openTextFile(): Promise<OpenedFile | null>;
  dataDir(): Promise<string | null>;
  revealDataDir(): Promise<void>;
  systemTheme(): Promise<SystemTheme>;
  onSystemThemeChange(cb: (theme: SystemTheme) => void): Promise<() => void>;
  appVersion(): Promise<string>;
  /** Keeps the window open until queued writes are saved (desktop) or warns before leaving (web). */
  guardClose(writes: { flush(): Promise<void>; pending(): number }): Promise<void>;

  /** Save dialog filtered to `.ics`; returns the path written, or null if cancelled (web: browser download). */
  saveIcsFile(defaultName: string, contents: string): Promise<string | null>;
  /** Open dialog filtered to `.ics`; null if cancelled. */
  openIcsFile(): Promise<OpenedFile | null>;

  /** Whether OS notification permission is granted (web: always false, notifications aren't wired up). */
  notificationsEnabled(): Promise<boolean>;
  /** Requests OS notification permission if not already decided. Returns the resulting state. */
  requestNotificationPermission(): Promise<boolean>;
  /** Shows a notification. `onAction`, if given, fires if the user clicks it (desktop only). */
  showNotification(opts: { title: string; body: string; onAction?: () => void }): Promise<void>;

  /** Mirrors the `closeToTray` setting into the native close handler (no-op on web). */
  setCloseToTray(enabled: boolean): Promise<void>;
  /** Updates the tray's "next block" label (no-op on web). */
  setTrayNextBlock(title: string | null): Promise<void>;
  /** Tray "Start timer" / "Confirm rest of day" clicks (web: never fires). */
  onTrayAction(cb: (action: "start-timer" | "confirm-rest-of-day") => void): Promise<() => void>;

  /** Whether autostart-on-login is currently enabled (web: always false). */
  autostartEnabled(): Promise<boolean>;
  setAutostart(enabled: boolean): Promise<void>;
}

export { isTauri };

let platform: Promise<Platform> | null = null;

export function getPlatform(): Promise<Platform> {
  platform ??= (async () => {
    if (isTauri()) return (await import("./tauri")).tauriPlatform;
    return (await import("./web")).webPlatform;
  })();
  return platform;
}
