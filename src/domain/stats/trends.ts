/**
 * Multi-week per-goal trend data for the Trends view: planned/actual/target per week, and a
 * streak of consecutive met weeks. Reuses `computeStats` week by week (checklist is not
 * needed here, so it's passed empty); keep this loop pure so the view can memoize it.
 */
import { addDays, weekDays } from "../time/localDate";
import type { Block, Goal, LocalDate, Now, WeekTarget } from "../types";
import { computeStats } from "./stats";

export interface TrendWeek {
  weekStart: LocalDate;
  planned: number;
  actual: number;
  target: number | null;
  /** Whether the goal's target was met that week; null when there's no target, or the week hasn't happened yet. */
  met: boolean | null;
}

export interface GoalTrend {
  goalId: string;
  goal: Goal | null;
  weeks: TrendWeek[];
  /** Consecutive met weeks, counting back from the most recent. */
  streak: number;
}

export interface TrendsInput {
  /** Oldest first. */
  weekStarts: readonly LocalDate[];
  blocks: readonly Block[];
  goals: readonly Goal[];
  targets: readonly WeekTarget[];
  now: Now;
}

/** Pure; the caller (a selector/hook) is responsible for memoizing by its inputs' identity. */
export function computeTrends(input: TrendsInput): GoalTrend[] {
  const byGoal = new Map<string, TrendWeek[]>();
  for (const goal of input.goals) byGoal.set(goal.id, []);

  for (const weekStart of input.weekStarts) {
    const days = weekDays(weekStart);
    const daySet = new Set(days);
    const weekBlocks = input.blocks.filter((b) => daySet.has(b.day));
    const stats = computeStats({
      days,
      weekStart,
      blocks: weekBlocks,
      goals: input.goals,
      targets: input.targets,
      checklist: [],
      now: input.now,
    });
    const statsByGoal = new Map(stats.goals.map((g) => [g.goalId, g]));
    for (const goal of input.goals) {
      const list = byGoal.get(goal.id)!;
      const g = statsByGoal.get(goal.id);
      if (!g) {
        list.push({ weekStart, planned: 0, actual: 0, target: null, met: null });
        continue;
      }
      const met =
        g.target === null || stats.phase === "future" ? null : g.kind === "min" ? g.actual >= g.target : g.actual <= g.target;
      list.push({ weekStart, planned: g.planned, actual: g.actual, target: g.target, met });
    }
  }

  return input.goals.map((goal) => {
    const weeks = byGoal.get(goal.id) ?? [];
    let streak = 0;
    for (let i = weeks.length - 1; i >= 0; i--) {
      if (weeks[i]!.met === true) streak++;
      else break;
    }
    return { goalId: goal.id, goal, weeks, streak };
  });
}

/** `weekStarts` for a window of `count` weeks ending at (and including) `lastWeekStart`, oldest first. */
export function trendWeekStarts(lastWeekStart: LocalDate, count: number): LocalDate[] {
  const out: LocalDate[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(addDays(lastWeekStart, -i * 7));
  return out;
}
