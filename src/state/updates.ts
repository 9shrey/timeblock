/**
 * In-app updates: the state Settings → Updates shows, and a quiet check on launch and once a
 * day while the desktop app runs (Settings → "Check for updates automatically").
 */
import { toast } from "sonner";
import { create } from "zustand";
import { systemEnv } from "@/domain/env";
import type { InstallProgress, Platform, UpdateInfo } from "@/platform";
import { flushWrites, useStore } from "./store";

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "checkFailed" }
  | { kind: "available"; update: UpdateInfo }
  /** `percent` is null until the server reports a download size. */
  | { kind: "downloading"; update: UpdateInfo; percent: number | null }
  | { kind: "installing"; update: UpdateInfo }
  | { kind: "installFailed"; update: UpdateInfo; message: string };

export const useUpdates = create<{ state: UpdateState }>(() => ({ state: { kind: "idle" } }));

const setState = (state: UpdateState) => useUpdates.setState({ state });

const isBusy = (s: UpdateState) => s.kind === "checking" || s.kind === "downloading" || s.kind === "installing";

export const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** How often the running app asks whether a day has passed since the last check. */
const AUTO_CHECK_POLL_MS = 60 * 60 * 1000;
/** Lets startup work (loading data, calendar sync) go first. */
const FIRST_AUTO_CHECK_DELAY_MS = 15_000;
const LAST_CHECK_KEY = "timeblock.lastUpdateCheck";

let lastCheckFallback = 0;
function lastCheckAt(): number {
  try {
    return Number(localStorage.getItem(LAST_CHECK_KEY)) || lastCheckFallback;
  } catch {
    return lastCheckFallback;
  }
}
function markChecked(at: number) {
  lastCheckFallback = at;
  try {
    localStorage.setItem(LAST_CHECK_KEY, String(at));
  } catch {
    // Private mode or blocked storage: the in-memory value still spaces out checks.
  }
}

/** Versions already announced with a toast this session, so the hourly poll doesn't repeat it. */
const announced = new Set<string>();

/**
 * Asks the update server for a newer release. `quiet` is the background check: a failure
 * keeps the current state, and a new version shows a toast instead of only the Settings row.
 */
export async function checkForUpdate(platform: Platform, { quiet = false } = {}): Promise<void> {
  const before = useUpdates.getState().state;
  if (isBusy(before)) return;
  if (!quiet) setState({ kind: "checking" });
  let update: UpdateInfo | null;
  try {
    update = await platform.checkForUpdate();
  } catch (e) {
    console.warn("Update check failed", e);
    setState(quiet ? before : { kind: "checkFailed" });
    return;
  }
  markChecked(systemEnv.nowMs());
  // A manual check or an install may have started while a quiet check was in flight.
  if (quiet && isBusy(useUpdates.getState().state)) return;
  setState(update ? { kind: "available", update } : { kind: "current" });
  if (update && quiet && !announced.has(update.version)) {
    announced.add(update.version);
    toast(`Timeblock ${update.version} is available`, {
      description: "Install it from Settings → Updates.",
      duration: 10_000,
      action: { label: "View", onClick: () => useStore.setState({ view: "settings" }) },
    });
  }
}

/** Saves pending writes, then backs up, downloads and installs; the app restarts on success. */
export async function installUpdate(platform: Platform): Promise<void> {
  const s = useUpdates.getState().state;
  if (s.kind !== "available" && s.kind !== "installFailed") return;
  const { update } = s;
  setState({ kind: "downloading", update, percent: null });
  const onProgress = (p: InstallProgress) => {
    if (p.phase === "installing") return setState({ kind: "installing", update });
    const percent = p.total ? Math.min(100, Math.floor((p.downloaded / p.total) * 100)) : null;
    const cur = useUpdates.getState().state;
    // Thousands of chunks per download: only re-render when the shown number changes.
    if (cur.kind !== "downloading" || cur.percent !== percent) setState({ kind: "downloading", update, percent });
  };
  try {
    await flushWrites();
    await platform.installUpdate(onProgress);
  } catch (e) {
    console.error("Update install failed", e);
    setState({ kind: "installFailed", update, message: e instanceof Error ? e.message : String(e) });
  }
}

/** Starts the background check (desktop only). Call once at boot; returns a stop function. */
export function startUpdateChecks(platform: Platform): () => void {
  if (platform.kind !== "tauri") return () => {};
  const tick = () => {
    if (!useStore.getState().settings.autoCheckUpdates) return;
    if (systemEnv.nowMs() - lastCheckAt() < AUTO_CHECK_INTERVAL_MS) return;
    void checkForUpdate(platform, { quiet: true });
  };
  const first = setTimeout(tick, FIRST_AUTO_CHECK_DELAY_MS);
  const timer = setInterval(tick, AUTO_CHECK_POLL_MS);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

/**
 * Release notes as plain text for the Settings row: the CHANGELOG section's Markdown with
 * emphasis, code ticks and heading marks removed, and links reduced to their text.
 */
export function plainReleaseNotes(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** For tests: forget the last check time, announced versions and state. */
export function resetUpdatesForTest() {
  lastCheckFallback = 0;
  announced.clear();
  try {
    localStorage.removeItem(LAST_CHECK_KEY);
  } catch {
    // ignore
  }
  setState({ kind: "idle" });
}
