/**
 * How a goal is judged for one week.
 *
 * Only confirmed (actual) time counts as progress. Plan is a forecast shown next to the
 * status, never the status itself. During the week, an "at least" goal is compared with a
 * steady pace over its active days, so Monday morning is never "behind" and Friday-night
 * cramming shows up early.
 */
import { dayOfWeek } from "../time/localDate";
import type { GoalKind, LocalDate, Now } from "../types";

export type GoalStatus =
  | "met" // at least: reached the target
  | "missed" // at least, past week: didn't reach it
  | "on_pace" // at least, this week: keeping up with the steady pace
  | "behind" // at least, this week: more than a day's share behind the pace
  | "within" // at most: under the limit
  | "over" // at most: over the limit
  | "watch" // at most: what's done plus what's planned goes over the limit
  | "planned" // at least, future week: the plan covers the target
  | "under_planned" // at least, future week: the plan falls short
  | "open" // outcomes only, this or a future week: not judged until the week ends
  | "no_target";

export type WeekPhase = "past" | "current" | "future";

/** Every day of the week. Bit d = weekday d (0 = Sunday … 6 = Saturday), as in routines. */
export const ALL_DAYS = 127;

export function isActiveDay(activeDays: number, day: LocalDate): boolean {
  return (activeDays & (1 << dayOfWeek(day))) !== 0;
}

export function activeDayCount(activeDays: number): number {
  let n = 0;
  for (let d = 0; d < 7; d++) if (activeDays & (1 << d)) n++;
  return n;
}

export interface Pace {
  /** The week's target after proration (equal to the target unless the goal started mid-week). */
  target: number;
  /** How much of `target` a steady pace would have done by now. */
  expected: number;
  /** `target` divided by the active days it is spread over. */
  dayShare: number;
  /** True when the goal started this week, so its target was scaled down. */
  prorated: boolean;
}

/**
 * Spreads `target` evenly over the week's active days, from `startDay` on (the goal's
 * creation day, if it falls in this week). Today counts by the fraction of it that's gone.
 */
export function paceOf(
  target: number,
  days: readonly LocalDate[],
  activeDays: number,
  now: Now,
  startDay: LocalDate | null = null,
): Pace {
  const mask = activeDays & ALL_DAYS || ALL_DAYS;
  let all = 0;
  let total = 0;
  let elapsed = 0;
  for (const d of days) {
    if (!isActiveDay(mask, d)) continue;
    all++;
    if (startDay !== null && d < startDay) continue;
    total++;
    if (d < now.day) elapsed += 1;
    else if (d === now.day) elapsed += now.minute / 1440;
  }
  if (all === 0) return { target, expected: target, dayShare: target, prorated: false };
  // A goal created after its last active day of the week has nothing left to do.
  const prorated = total < all;
  const t = prorated ? Math.round((target * total) / all) : target;
  if (total === 0) return { target: t, expected: t, dayShare: 0, prorated };
  return { target: t, expected: (t * elapsed) / total, dayShare: t / total, prorated };
}

export interface ProgressInput {
  kind: GoalKind;
  phase: WeekPhase;
  /** Minutes, already prorated; null (or 0 for "at least") = no time target. */
  target: number | null;
  /** Confirmed time so far. */
  actual: number;
  /** Plan not yet done: plan blocks from now on (future weeks: the whole plan). Skipped blocks excluded. */
  remainingPlan: number;
  /** Pace for the current week; ignored for past and future weeks. */
  expected: number;
  dayShare: number;
  outcomes: { done: number; total: number };
}

export interface Progress {
  status: GoalStatus;
  /** Current week, "at least": actual minus expected (negative = behind pace). Null otherwise. */
  paceDelta: number | null;
  /**
   * "At least": how much the target exceeds actual + remaining plan (> 0 = plan short).
   * "At most": how much actual + remaining plan exceeds the limit (> 0 = plan goes over).
   * Null without a time target.
   */
  planGap: number | null;
}

export function hasTimeTarget(kind: GoalKind, target: number | null): target is number {
  return target !== null && (kind === "max" || target > 0);
}

export function goalProgress(p: ProgressInput): Progress {
  if (!hasTimeTarget(p.kind, p.target)) {
    const { done, total } = p.outcomes;
    if (total === 0) return { status: "no_target", paceDelta: null, planGap: null };
    if (p.phase === "past") return { status: done >= total ? "met" : "missed", paceDelta: null, planGap: null };
    return { status: done >= total ? "met" : "open", paceDelta: null, planGap: null };
  }
  const t = p.target;
  const reach = p.actual + p.remainingPlan;
  if (p.kind === "min") {
    const planGap = Math.max(0, t - reach);
    if (p.phase === "past") return { status: p.actual >= t ? "met" : "missed", paceDelta: null, planGap };
    if (p.phase === "future") return { status: planGap > 0 ? "under_planned" : "planned", paceDelta: null, planGap };
    if (p.actual >= t) return { status: "met", paceDelta: null, planGap: 0 };
    const paceDelta = p.actual - p.expected;
    return { status: paceDelta >= -p.dayShare ? "on_pace" : "behind", paceDelta, planGap };
  }
  const planGap = Math.max(0, reach - t);
  if (p.actual > t) return { status: "over", paceDelta: null, planGap };
  if (p.phase === "past") return { status: "within", paceDelta: null, planGap };
  return { status: planGap > 0 ? "watch" : "within", paceDelta: null, planGap };
}

/** Whether a week counts as a success for streaks; null while it can still go either way. */
export function weekMet(status: GoalStatus, phase: WeekPhase): boolean | null {
  if (status === "met") return true;
  if (status === "over") return false;
  if (phase !== "past") return null;
  if (status === "within") return true;
  if (status === "missed") return false;
  return null;
}
