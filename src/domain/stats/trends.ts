/** Per-goal weekly stats over a trailing range of weeks, for the Trends view. */
import { computeStats, type WeekStats } from "./stats";
import { addDays, weekDays, weekStartOf } from "../time/localDate";
import type { Block, Goal, LocalDate, Now, WeekStartDay, WeekTarget } from "../types";

export interface TrendWeek {
  weekStart: LocalDate;
  stats: WeekStats;
}

export interface TrendInput {
  blocks: readonly Block[];
  goals: readonly Goal[];
  targets: readonly WeekTarget[];
  weekStartDay: WeekStartDay;
  /** The most recent week in the trend is the one containing this day. */
  endDay: LocalDate;
  now: Now;
  weeks: number;
}

/** `weeks` consecutive weeks ending at (and including) the week containing `endDay`, oldest first. */
export function computeTrend({ blocks, goals, targets, weekStartDay, endDay, now, weeks }: TrendInput): TrendWeek[] {
  const endWeekStart = weekStartOf(endDay, weekStartDay);
  const out: TrendWeek[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const weekStart = addDays(endWeekStart, -7 * i);
    const days = weekDays(weekStart);
    const daySet = new Set(days);
    const stats = computeStats({
      days,
      weekStart,
      blocks: blocks.filter((b) => daySet.has(b.day)),
      goals,
      targets,
      checklist: [],
      now,
    });
    out.push({ weekStart, stats });
  }
  return out;
}

const SUCCESS_STATUS: Record<Goal["kind"], WeekStats["goals"][number]["status"]> = { min: "met", max: "within" };

/** How many of the most recent *past* weeks a goal met its target, counting back from the newest. */
export function metStreak(trend: readonly TrendWeek[], goalId: string, kind: Goal["kind"]): number {
  let streak = 0;
  for (let i = trend.length - 1; i >= 0; i--) {
    const week = trend[i]!;
    if (week.stats.phase !== "past") continue;
    const g = week.stats.goals.find((g) => g.goalId === goalId);
    if (!g || g.status !== SUCCESS_STATUS[kind]) break;
    streak++;
  }
  return streak;
}
