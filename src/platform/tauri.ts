import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createTauriDriver } from "@/data/drivers/tauriDriver";
import type { OpenedFile, Platform, SystemTheme } from "./index";

const CLOSE_FLUSH_TIMEOUT_MS = 3000;

const toTheme = (t: string | null): SystemTheme => (t === "dark" ? "dark" : "light");

export const tauriPlatform: Platform = {
  kind: "tauri",
  createDriver: async () => createTauriDriver(),
  backupNow: (reason) => invoke<string>("backup_now", { reason }),
  backupIfStale: (maxAgeHours) => invoke<string | null>("backup_if_stale", { maxAgeHours }),
  saveTextFile: (defaultName, contents) => invoke<string | null>("save_text_file", { defaultName, contents }),
  openTextFile: () => invoke<OpenedFile | null>("open_text_file"),
  dataDir: () => invoke<string>("data_dir"),
  revealDataDir: () => invoke("reveal_data_dir"),
  // Follows the desktop (KDE/GNOME) theme. Never call setTheme on Linux: it pins GTK's theme.
  systemTheme: async () => toTheme(await getCurrentWindow().theme()),
  onSystemThemeChange: (cb) => getCurrentWindow().onThemeChanged(({ payload }) => cb(toTheme(payload))),
  appVersion: () => getVersion(),
  async guardClose(writes) {
    // The window closes once the handler settles; a stuck write must not keep it open for good.
    await getCurrentWindow().onCloseRequested(() =>
      Promise.race([writes.flush(), new Promise<void>((resolve) => setTimeout(resolve, CLOSE_FLUSH_TIMEOUT_MS))]),
    );
  },
};
