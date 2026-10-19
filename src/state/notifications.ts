/**
 * Drives the three M11 desktop notifications from the clock tick in `src/main.tsx`. The
 * decision logic itself is pure (`src/domain/notifications/schedule.ts`); this module only
 * owns the "did we already fire this one" bookkeeping and the platform calls to show a
 * notification or update the tray.
 */
import { dueEveningNudge, dueNextBlockNotice, dueWeeklyReview } from "@/domain/notifications/schedule";
import type { LocalDate, Now } from "@/domain/types";
import { getPlatform } from "@/platform";
import { blocksOn } from "./selectors";
import { useStore } from "./store";

let notifiedBlockIds = new Set<string>();
let notifiedBlockIdsDay: LocalDate | null = null;
let eveningNudgeFiredDay: LocalDate | null = null;
let weeklyReviewFiredWeek: LocalDate | null = null;

/** Exposed for tests: resets all "already fired" bookkeeping. */
export function resetNotificationState(): void {
  notifiedBlockIds = new Set();
  notifiedBlockIdsDay = null;
  eveningNudgeFiredDay = null;
  weeklyReviewFiredWeek = null;
}

function openToday(day: LocalDate): void {
  useStore.setState({ view: "day", cursor: day });
}

/** Called once a minute (or whenever `now` changes) from `main.tsx`. */
export async function checkNotifications(now: Now): Promise<void> {
  const state = useStore.getState();
  const { settings } = state;
  const platform = await getPlatform();

  if (notifiedBlockIdsDay !== now.day) {
    notifiedBlockIds = new Set();
    notifiedBlockIdsDay = now.day;
  }

  const todaysBlocks = blocksOn(state.data, now.day);

  // Tray's "next block" label updates regardless of the notification setting; it's a
  // status display, not an alert. No-op on the web platform.
  const upcoming = todaysBlocks.filter((b) => b.layer === "plan" && b.startMinute >= now.minute).sort((a, b) => a.startMinute - b.startMinute)[0];
  await platform.setTrayNextBlock(upcoming ? upcoming.title || "Untitled" : null);

  if (settings.notifyNextBlock) {
    const notice = dueNextBlockNotice(now, todaysBlocks, notifiedBlockIds);
    if (notice) {
      notifiedBlockIds.add(notice.blockId);
      await platform.showNotification({ title: `Next block in 5 min: ${notice.title}`, body: "" });
    }
  }

  if (settings.notifyEveningNudge) {
    const nudge = dueEveningNudge(now, todaysBlocks, eveningNudgeFiredDay === now.day);
    if (nudge) {
      eveningNudgeFiredDay = now.day;
      const plural = nudge.unconfirmedCount === 1 ? "" : "s";
      await platform.showNotification({
        title: `Today has ${nudge.unconfirmedCount} unconfirmed block${plural}`,
        body: "",
        onAction: () => openToday(nudge.day),
      });
    }
  }

  if (settings.notifyWeeklyReview) {
    const review = dueWeeklyReview(now, settings.weekStartDay, weeklyReviewFiredWeek);
    if (review) {
      weeklyReviewFiredWeek = review.weekStart;
      await platform.showNotification({ title: "Weekly review is ready", body: "" });
    }
  }
}
