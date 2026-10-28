import { BundleType, getBundleType, getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { fetch as httpFetch } from "@tauri-apps/plugin-http";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isPermissionGranted, onAction, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { createTauriDriver } from "@/data/drivers/tauriDriver";
import {
  responseText,
  type BackupInfo,
  type InstallProgress,
  type OpenedFile,
  type Platform,
  type SystemTheme,
  type TrayAction,
} from "./index";

const CLOSE_FLUSH_TIMEOUT_MS = 3000;

let pendingUpdate: Update | null = null;

const toTheme = (t: string | null): SystemTheme => (t === "dark" ? "dark" : "light");

export const tauriPlatform: Platform = {
  kind: "tauri",
  createDriver: async () => createTauriDriver(),
  backupNow: (reason) => invoke<string>("backup_now", { reason }),
  backupIfStale: (maxAgeHours) => invoke<string | null>("backup_if_stale", { maxAgeHours }),
  listBackups: () => invoke<BackupInfo[]>("list_backups"),
  restoreBackup: (name) => invoke("restore_backup", { name }),
  saveTextFile: (defaultName, contents, filter) =>
    invoke<string | null>("save_text_file", { defaultName, contents, filterName: filter.name, filterExtensions: filter.extensions }),
  openTextFile: (filter) => invoke<OpenedFile | null>("open_text_file", { filterName: filter.name, filterExtensions: filter.extensions }),
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
  async notify(id, title, body) {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (granted) sendNotification({ id, title, body });
  },
  async onNotificationClick(cb) {
    // `tap` covers both an actual click and (per the plugin's docs) is the only actionId
    // desktop ever reports, since we never register custom action types/buttons.
    const listener = await onAction((event) => {
      if (event.actionId === "tap" && event.notification) cb(event.notification.id);
    });
    return () => listener.unregister();
  },
  setTrayNextBlock: (label) => invoke("set_tray_next_block", { label }),
  setCloseToTray: (enabled) => invoke("set_close_to_tray", { enabled }),
  onTrayAction: (cb) => listen<TrayAction>("tray-action", (event) => cb(event.payload)),
  async checkForUpdate() {
    pendingUpdate = await check();
    if (!pendingUpdate) return null;
    const bundle = await getBundleType().catch(() => null);
    return {
      version: pendingUpdate.version,
      notes: pendingUpdate.body?.trim() || null,
      needsPassword: bundle === BundleType.Deb || bundle === BundleType.Rpm,
    };
  },
  async installUpdate(onProgress?: (progress: InstallProgress) => void) {
    if (!pendingUpdate) throw new Error("No update to install. Check for updates first.");
    // A backup first keeps data recoverable if a release misbehaves.
    await invoke("backup_now", { reason: "pre-update" });
    let downloaded = 0;
    let total: number | null = null;
    await pendingUpdate.downloadAndInstall((event) => {
      if (event.event === "Started") total = event.data.contentLength ?? null;
      else if (event.event === "Progress") downloaded += event.data.chunkLength;
      onProgress?.(event.event === "Finished" ? { phase: "installing" } : { phase: "downloading", downloaded, total });
    });
    await relaunch();
  },
  openUrl: (url) => openUrl(url),
  request: (url, init) => httpFetch(url, init),
  async fetchText(url) {
    let res: Response;
    try {
      res = await httpFetch(url, { method: "GET", headers: { Accept: "text/calendar, */*" } });
    } catch (e) {
      throw new Error(`Couldn't reach the server: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
    }
    return responseText(res);
  },
};
