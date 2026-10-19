import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { disable as autostartDisable, enable as autostartEnable, isEnabled as autostartIsEnabled } from "@tauri-apps/plugin-autostart";
import {
  isPermissionGranted,
  onAction as onNotificationAction,
  registerActionTypes,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { createTauriDriver } from "@/data/drivers/tauriDriver";
import type { BackupInfo, OpenedFile, Platform, SystemTheme } from "./index";

const CLOSE_FLUSH_TIMEOUT_MS = 3000;
const TRAY_EVENT_START_TIMER = "tray://start-timer";
const TRAY_EVENT_CONFIRM_REST_OF_DAY = "tray://confirm-rest-of-day";
/** Action id given to `sendNotification` so a click on the evening nudge opens Day view. */
const CONFIRM_ACTION_ID = "confirm";

const toTheme = (t: string | null): SystemTheme => (t === "dark" ? "dark" : "light");

const CONFIRM_ACTION_TYPE_ID = "evening-nudge";
let actionTypesRegistered: Promise<void> | null = null;
let notificationIdCounter = 1;
const pendingActions = new Map<number, () => void>();

/** Registers the one action type we use (the evening nudge's "Confirm") exactly once. */
function ensureActionTypesRegistered(): Promise<void> {
  actionTypesRegistered ??= registerActionTypes([
    { id: CONFIRM_ACTION_TYPE_ID, actions: [{ id: CONFIRM_ACTION_ID, title: "Confirm" }] },
  ]);
  return actionTypesRegistered;
}

void onNotificationAction((event) => {
  const id = event.notification?.id;
  if (id === undefined) return;
  const cb = pendingActions.get(id);
  if (cb && event.actionId === CONFIRM_ACTION_ID) cb();
  pendingActions.delete(id);
});

export const tauriPlatform: Platform = {
  kind: "tauri",
  createDriver: async () => createTauriDriver(),
  backupNow: (reason) => invoke<string>("backup_now", { reason }),
  backupIfStale: (maxAgeHours) => invoke<string | null>("backup_if_stale", { maxAgeHours }),
  listBackups: () => invoke<BackupInfo[]>("list_backups"),
  restoreBackup: (name) => invoke("restore_backup", { name }),
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

  saveIcsFile: (defaultName, contents) => invoke<string | null>("save_ics_file", { defaultName, contents }),
  openIcsFile: () => invoke<OpenedFile | null>("open_ics_file"),

  notificationsEnabled: () => isPermissionGranted(),
  requestNotificationPermission: async () => (await requestPermission()) === "granted",
  async showNotification({ title, body, onAction }) {
    if (!(await isPermissionGranted())) return;
    const id = notificationIdCounter++;
    if (onAction) {
      await ensureActionTypesRegistered();
      pendingActions.set(id, onAction);
      sendNotification({ id, title, body, actionTypeId: CONFIRM_ACTION_TYPE_ID });
    } else {
      sendNotification({ id, title, body });
    }
  },

  setCloseToTray: (enabled) => invoke("set_close_to_tray", { value: enabled }),
  setTrayNextBlock: (title) => invoke("set_tray_next_block", { title }),
  async onTrayAction(cb) {
    const unlistenStart = await listen(TRAY_EVENT_START_TIMER, () => cb("start-timer"));
    const unlistenConfirm = await listen(TRAY_EVENT_CONFIRM_REST_OF_DAY, () => cb("confirm-rest-of-day"));
    return () => {
      unlistenStart();
      unlistenConfirm();
    };
  },

  autostartEnabled: () => autostartIsEnabled(),
  setAutostart: (enabled) => (enabled ? autostartEnable() : autostartDisable()),
};
