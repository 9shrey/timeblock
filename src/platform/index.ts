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
