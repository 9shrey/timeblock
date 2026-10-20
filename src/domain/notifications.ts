/**
 * Decides which desktop notifications are due at the current clock tick. Pure: scheduling
 * (the actual OS notification call, and permission handling) lives in the state layer, which
 * calls this every tick and remembers `key`s it has already fired (cleared once the day rolls
 * over, so every key here is naturally unique within a day except weeklyReview's, which is
 * keyed by week start and so survives exactly as long as it needs to).
 */
import { ghostsOf, isPast } from "./blocks/reconcile";
import { addDays, formatMinute, weekStartOf } from "./time/localDate";
import type { Block, Goal, Now, Settings, WeekStartDay } from "./types";

const displayTitle = (title: string, goal: Goal | null) => title.trim() || goal?.name || "Untitled";

function isLastDayOfWeek(day: string, weekStartDay: WeekStartDay): boolean {
  return addDays(weekStartOf(day, weekStartDay), 6) === day;
}

/** Minute of day the evening nudge and weekly-review notification fire at (20:00). */
export const EVENING_MINUTE = 20 * 60;

export const NEXT_BLOCK_LEAD_MINUTES = 5;

export interface NotificationEvent {
  /** Dedupe key; the caller skips anything it has already fired. */
  key: string;
  title: string;
  body: string;
  /** What clicking the notification should do. */
  action: "openDay" | "openReview";
}

export interface NotificationInput {
  blocks: readonly Block[];
  goals: Readonly<Record<string, Goal>>;
  settings: Settings;
  now: Now;
  weekStartDay: WeekStartDay;
}

export function dueNotifications(input: NotificationInput): NotificationEvent[] {
  const { blocks, goals, settings, now } = input;
  const events: NotificationEvent[] = [];
  const todaysBlocks = blocks.filter((b) => b.day === now.day);

  if (settings.notifyNextBlock) {
    for (const b of todaysBlocks) {
      if (b.layer !== "plan" || b.skipped) continue;
      if (b.startMinute === now.minute + NEXT_BLOCK_LEAD_MINUTES) {
        events.push({
          key: `next-block:${b.id}`,
          title: `Next block in ${NEXT_BLOCK_LEAD_MINUTES} min`,
          body: `${displayTitle(b.title, b.goalId ? goals[b.goalId] ?? null : null)} · ${formatMinute(b.startMinute, settings.timeFormat)}`,
          action: "openDay",
        });
      }
    }
  }

  if (now.minute === EVENING_MINUTE) {
    if (settings.notifyUnconfirmed) {
      const unconfirmed = ghostsOf(todaysBlocks).filter((g) => isPast(g.day, g.endMinute, now));
      if (unconfirmed.length > 0) {
        events.push({
          key: `unconfirmed:${now.day}`,
          title: `${unconfirmed.length} unconfirmed block${unconfirmed.length === 1 ? "" : "s"} today`,
          body: "Open Day view to confirm what happened.",
          action: "openDay",
        });
      }
    }
    if (settings.notifyWeeklyReview && isLastDayOfWeek(now.day, input.weekStartDay)) {
      events.push({
        key: `weekly-review:${now.day}`,
        title: "Weekly review is ready",
        body: "This week's plan vs. actual is ready to look back on.",
        action: "openReview",
      });
    }
  }

  return events;
}
