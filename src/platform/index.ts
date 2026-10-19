/**
 * Host integration. The Tauri implementation talks to Rust commands; the web one
 * (dev-only, `npm run dev` in a plain browser) uses sql.js + localStorage.
 */
import { isTauri } from "@tauri-apps/api/core";
import type { SqlDriver } from "@/data/drivers/SqlDriver";

export type SystemTheme = "light" | "dark";

export interface OpenedFile {
  path: string;
  contents: string;
}

export interface Platform {
  readonly kind: "tauri" | "web";
  createDriver(): Promise<SqlDriver>;
  /** Returns the backup path, or null where backups are unsupported (web). */
  backupNow(reason: string): Promise<string | null>;
  backupIfStale(maxAgeHours: number): Promise<string | null>;
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
    if (import.meta.env.DEV) return (await import("./web")).webPlatform;
    throw new Error("Timeblock must run inside the desktop app.");
  })();
  return platform;
}
