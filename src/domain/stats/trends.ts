/**
 * Multi-week per-goal trend data for the Trends view: planned/actual/target per week, and a
 * streak of consecutive met weeks. Reuses `computeStats` week by week, so a week is judged
 * exactly as Review judges it; keep this loop pure so the view can memoize it.
 */
import { addDays, weekDays } from "../time/localDate";
import { weekMet } from "../goals/progress";
import type { Block, ChecklistItem, Goal, LocalDate, Now, WeekTarget } from "../types";
import { computeStats } from "./stats";

export interface TrendWeek {
  weekStart: LocalDate;
  planned: number;
  actual: number;
  target: number | null;
  /**
   * Whether the goal was met that week; null when there's nothing to judge, or the week is
   * still open (an unfinished week never breaks a streak).
   */
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
  /** Outcomes for the window's weeks (outcome-only goals are judged by them). */
  checklist?: readonly ChecklistItem[];
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
      checklist: (input.checklist ?? []).filter((c) => c.weekStart === weekStart),
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
      const met = weekMet(g.status, stats.phase);
      list.push({ weekStart, planned: g.planned, actual: g.actual, target: g.target, met });
    }
  }

  return input.goals.map((goal) => {
    const weeks = byGoal.get(goal.id) ?? [];
    // Counts back from the most recent week; a still-open latest week is skipped, not a break.
    let streak = 0;
    let i = weeks.length - 1;
    if (i >= 0 && weeks[i]!.met === null) i--;
    for (; i >= 0; i--) {
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
