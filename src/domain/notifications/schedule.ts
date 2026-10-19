/**
 * Pure decision logic for the three desktop notifications (M11). The clock tick in
 * `src/main.tsx` calls these every minute with the current state; this module owns no
 * timers or I/O, only "what should fire right now, given what has already fired".
 */
import { planStates } from "../blocks/reconcile";
import { weekDays, weekStartOf } from "../time/localDate";
import type { Block, LocalDate, Now, WeekStartDay } from "../types";

/** How far ahead of a block's start the "next block" notification fires. */
const NEXT_BLOCK_LEAD_MINUTES = 5;
/** Local time the evening nudge may fire, if there are unconfirmed blocks. */
export const EVENING_NUDGE_MINUTE = 21 * 60;
/** Local time the weekly-review notification may fire, on the week's last day. */
export const WEEKLY_REVIEW_MINUTE = 18 * 60;

export interface NextBlockNotice {
  kind: "nextBlock";
  blockId: string;
  title: string;
}

export interface EveningNudgeNotice {
  kind: "eveningNudge";
  day: LocalDate;
  unconfirmedCount: number;
}

export interface WeeklyReviewNotice {
  kind: "weeklyReview";
  weekStart: LocalDate;
}

export type Notice = NextBlockNotice | EveningNudgeNotice | WeeklyReviewNotice;

/**
 * The next plan block (today, not yet started) whose start is within the lead window.
 * `alreadyNotified` holds block ids a notice has already been sent for, so the tick that
 * runs a minute later doesn't re-fire it.
 */
export function dueNextBlockNotice(now: Now, todaysPlanBlocks: readonly Block[], alreadyNotified: ReadonlySet<string>): NextBlockNotice | null {
  for (const b of todaysPlanBlocks) {
    if (b.day !== now.day) continue;
    const minutesUntil = b.startMinute - now.minute;
    if (minutesUntil < 0 || minutesUntil > NEXT_BLOCK_LEAD_MINUTES) continue;
    if (alreadyNotified.has(b.id)) continue;
    return { kind: "nextBlock", blockId: b.id, title: b.title || "Untitled" };
  }
  return null;
}

/**
 * Whether the evening nudge should fire: at/after `EVENING_NUDGE_MINUTE`, today has at
 * least one plan block still "unconfirmed" (past its end, neither confirmed nor skipped),
 * and it hasn't already fired today. `todaysBlocks` is both layers for the day, since
 * `planState` needs the linked actuals to tell "done"/"adjusted" from "unconfirmed".
 */
export function dueEveningNudge(now: Now, todaysBlocks: readonly Block[], firedToday: boolean): EveningNudgeNotice | null {
  if (firedToday) return null;
  if (now.minute < EVENING_NUDGE_MINUTE) return null;
  const states = planStates(todaysBlocks, now);
  const unconfirmedCount = todaysBlocks.filter((b) => b.layer === "plan" && states.get(b.id) === "unconfirmed").length;
  if (unconfirmedCount === 0) return null;
  return { kind: "eveningNudge", day: now.day, unconfirmedCount };
}

/**
 * Whether the weekly-review notification should fire: today is the last day of the week
 * (by `weekStartDay`), it's at/after `WEEKLY_REVIEW_MINUTE`, and it hasn't fired this week.
 */
export function dueWeeklyReview(now: Now, weekStartDay: WeekStartDay, firedForWeek: LocalDate | null): WeeklyReviewNotice | null {
  const weekStart = weekStartOf(now.day, weekStartDay);
  const days = weekDays(weekStart);
  const lastDay = days[days.length - 1];
  if (now.day !== lastDay) return null;
  if (now.minute < WEEKLY_REVIEW_MINUTE) return null;
  if (firedForWeek === weekStart) return null;
  return { kind: "weeklyReview", weekStart };
}
