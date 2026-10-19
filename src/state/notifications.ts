/**
 * Schedules desktop notifications from the clock tick (no background daemon: the app only
 * has to be running). Dedupe state is in-memory and cleared when the day rolls over, since
 * `dueNotifications`'s keys are themselves scoped to at most one day.
 */
import { dueNotifications, type NotificationEvent } from "@/domain/notifications";
import type { Now } from "@/domain/types";
import type { Platform } from "@/platform";
import { allBlocks } from "./selectors";
import { useStore } from "./store";

let firedKeys = new Set<string>();
let firedOnDay: string | null = null;
let nextId = 1;
const pendingActions = new Map<number, NotificationEvent["action"]>();

/** Call on every clock tick. */
export function scheduleNotifications(platform: Platform, now: Now): void {
  if (firedOnDay !== now.day) {
    firedKeys = new Set();
    firedOnDay = now.day;
  }
  const { data, settings } = useStore.getState();
  const events = dueNotifications({
    blocks: allBlocks(data.blocks),
    goals: data.goals,
    settings,
    now,
    weekStartDay: settings.weekStartDay,
  });
  for (const event of events) {
    if (firedKeys.has(event.key)) continue;
    firedKeys.add(event.key);
    const id = nextId++;
    pendingActions.set(id, event.action);
    void platform.notify(id, event.title, event.body);
  }
}

/** Call once at boot: routes a notification click to the view it's about. */
export function wireNotificationClicks(platform: Platform): Promise<() => void> {
  return platform.onNotificationClick((id) => {
    const action = pendingActions.get(id);
    if (!action) return;
    const now = useStore.getState().now;
    if (action === "openDay") useStore.setState({ view: "day", cursor: now.day, selection: null });
    else useStore.setState({ view: "review", cursor: now.day, selection: null });
  });
}
