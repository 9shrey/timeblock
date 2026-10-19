/**
 * Keeps the desktop tray menu's "next block" line in sync with the clock tick, and routes
 * tray actions that need app state (unlike Show/Hide/Quit, which the Rust side handles itself).
 */
import { confirmRestOfDay, startTimer } from "@/state/commands";
import { nextUpcomingBlock } from "@/domain/tray";
import type { Now } from "@/domain/types";
import type { Platform } from "@/platform";
import { allBlocks } from "./selectors";
import { useStore } from "./store";

let lastLabel: string | null | undefined;

/** Call on every clock tick (and once at boot). Skips the IPC call when the label hasn't changed. */
export function scheduleTray(platform: Platform, now: Now): void {
  const { data } = useStore.getState();
  const label = nextUpcomingBlock(allBlocks(data.blocks), data.goals, now);
  if (label === lastLabel) return;
  lastLabel = label;
  void platform.setTrayNextBlock(label);
}

/** Call once at boot. */
export function wireTrayActions(platform: Platform): Promise<() => void> {
  return platform.onTrayAction((action) => {
    const now = useStore.getState().now;
    if (action === "startTimer") startTimer();
    else confirmRestOfDay(now.day);
  });
}
