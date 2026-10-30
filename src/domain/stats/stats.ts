/**
 * Weekly statistics per goal. Every amount is minutes of the per-day UNION of intervals,
 * so overlapping blocks never double count. Unconfirmed ghost time never counts as actual.
 * How each goal is judged lives in `../goals/progress`.
 */
import { clip, unionLength, type Interval } from "../blocks/intervals";
import { ghostsOf, isPast } from "../blocks/reconcile";
import { progress } from "../goals/checklist";
import { goalProgress, paceOf, type GoalStatus, type WeekPhase } from "../goals/progress";
import { effectiveTarget } from "../goals/targets";
import { nowFrom } from "../time/clock";
import type { Block, ChecklistItem, Goal, GoalKind, LocalDate, Now, WeekTarget } from "../types";

export type { GoalStatus, WeekPhase } from "../goals/progress";

/** Bucket id for blocks without a (known) goal. */
export const UNASSIGNED = "__unassigned__";

export interface StatsInput {
  days: readonly LocalDate[];
  weekStart: LocalDate;
  blocks: readonly Block[];
  goals: readonly Goal[];
  targets: readonly WeekTarget[];
  checklist: readonly ChecklistItem[];
  now: Now;
}

export interface Amounts {
  /** Plan blocks, including skipped ones. */
  planned: number;
  actual: number;
  /** Actual time up to now (later actual blocks, e.g. a running timer's end, don't count yet). */
  actualSoFar: number;
  /** Ghost time before now. */
  unconfirmed: number;
  /** Ghost time from now on. */
  upcoming: number;
  /** actual ∪ ghosts. */
  projected: number;
  /** Actual blocks not linked to a plan block. */
  unplanned: number;
  /** Plan blocks marked skipped. */
  skipped: number;
}

export interface GoalStats extends Amounts {
  /** Goal id, or `UNASSIGNED`. */
  goalId: string;
  goal: Goal | null;
  kind: GoalKind;
  /** This week's time target in minutes (prorated if the goal started mid-week); null = none. */
  target: number | null;
  /** The target as set, before proration. */
  weeklyTarget: number | null;
  targetFromWeek: LocalDate | null;
  /** True when the goal started this week, so `target` covers only its remaining active days. */
  prorated: boolean;
  /** Current week: where a steady pace would be by now. Null otherwise or without a target. */
  expected: number | null;
  /** Current week, "at least": actualSoFar − expected. Negative = behind pace. */
  paceDelta: number | null;
  /** See `Progress.planGap`. */
  planGap: number | null;
  /** This week's outcomes. */
  checklist: { done: number; total: number };
  byDay: Record<LocalDate, Amounts>;
  status: GoalStatus;
}

export interface WeekStats {
  phase: WeekPhase;
  goals: GoalStats[];
  unassigned: GoalStats | null;
  totals: Amounts;
  byDay: Record<LocalDate, Amounts>;
  uncorrectedDays: LocalDate[];
}

interface Lists {
  planned: Interval[];
  actual: Interval[];
  actualSoFar: Interval[];
  unconfirmed: Interval[];
  upcoming: Interval[];
  ghosts: Interval[];
  unplanned: Interval[];
  skipped: Interval[];
}

const emptyLists = (): Lists => ({
  planned: [],
  actual: [],
  actualSoFar: [],
  unconfirmed: [],
  upcoming: [],
  ghosts: [],
  unplanned: [],
  skipped: [],
});

export const zeroAmounts = (): Amounts => ({
  planned: 0,
  actual: 0,
  actualSoFar: 0,
  unconfirmed: 0,
  upcoming: 0,
  projected: 0,
  unplanned: 0,
  skipped: 0,
});

function amountsOf(l: Lists): Amounts {
  return {
    planned: unionLength(l.planned),
    actual: unionLength(l.actual),
    actualSoFar: unionLength(l.actualSoFar),
    unconfirmed: unionLength(l.unconfirmed),
    upcoming: unionLength(l.upcoming),
    projected: unionLength([...l.actual, ...l.ghosts]),
    unplanned: unionLength(l.unplanned),
    skipped: unionLength(l.skipped),
  };
}

function addInto(sum: Amounts, a: Amounts): void {
  sum.planned += a.planned;
  sum.actual += a.actual;
  sum.actualSoFar += a.actualSoFar;
  sum.unconfirmed += a.unconfirmed;
  sum.upcoming += a.upcoming;
  sum.projected += a.projected;
  sum.unplanned += a.unplanned;
  sum.skipped += a.skipped;
}

/** Phase of a week relative to now. */
export function weekPhase(days: readonly LocalDate[], weekStart: LocalDate, now: Now): WeekPhase {
  const last = days[days.length - 1] ?? weekStart;
  if (last < now.day) return "past";
  if (weekStart > now.day) return "future";
  return "current";
}

/** Per-goal, per-day and total amounts, targets, statuses and checklist progress for a week. */
export function computeStats(input: StatsInput): WeekStats {
  const { days, weekStart, now } = input;
  const daySet = new Set(days);
  const goalById = new Map(input.goals.map((g) => [g.id, g]));
  const bucketOf = (goalId: string | null) => (goalId !== null && goalById.has(goalId) ? goalId : UNASSIGNED);

  // lists[bucket][day]; the whole-week view uses bucket "" (all goals).
  const ALL = "";
  const lists = new Map<string, Map<LocalDate, Lists>>();
  const listFor = (bucket: string, day: LocalDate): Lists => {
    let byDay = lists.get(bucket);
    if (!byDay) lists.set(bucket, (byDay = new Map()));
    let l = byDay.get(day);
    if (!l) byDay.set(day, (l = emptyLists()));
    return l;
  };
  const add = (goalId: string | null, day: LocalDate, key: keyof Lists, i: Interval) => {
    listFor(bucketOf(goalId), day)[key].push(i);
    listFor(ALL, day)[key].push(i);
  };

  for (const b of input.blocks) {
    if (!daySet.has(b.day)) continue;
    const i = { start: b.startMinute, end: b.endMinute };
    if (b.layer === "plan") {
      add(b.goalId, b.day, "planned", i);
      if (b.skipped) add(b.goalId, b.day, "skipped", i);
    } else {
      add(b.goalId, b.day, "actual", i);
      const soFar = b.day < now.day ? i : b.day === now.day ? clip(i, { start: 0, end: now.minute }) : null;
      if (soFar) add(b.goalId, b.day, "actualSoFar", soFar);
      if (b.planBlockId === null) add(b.goalId, b.day, "unplanned", i);
    }
  }

  const uncorrected = new Set<LocalDate>();
  for (const g of ghostsOf(input.blocks)) {
    if (!daySet.has(g.day)) continue;
    const i = { start: g.startMinute, end: g.endMinute };
    add(g.goalId, g.day, "ghosts", i);
    const cut = g.day < now.day ? 1440 : g.day > now.day ? 0 : now.minute;
    const before = clip(i, { start: 0, end: cut });
    const after = clip(i, { start: cut, end: 1440 });
    if (before) add(g.goalId, g.day, "unconfirmed", before);
    if (after) add(g.goalId, g.day, "upcoming", after);
    if (isPast(g.day, g.endMinute, now)) uncorrected.add(g.day);
  }

  const summarize = (bucket: string): { total: Amounts; byDay: Record<LocalDate, Amounts> } => {
    const total = zeroAmounts();
    const byDay: Record<LocalDate, Amounts> = {};
    const perDay = lists.get(bucket);
    for (const d of days) {
      const l = perDay?.get(d);
      const a = l ? amountsOf(l) : zeroAmounts();
      byDay[d] = a;
      addInto(total, a);
    }
    return { total, byDay };
  };

  const phase = weekPhase(days, weekStart, now);
  const lastDay = days[days.length - 1] ?? weekStart;
  const weekItems = input.checklist.filter((c) => c.weekStart === weekStart);
  const hasTime = (a: Amounts) => a.planned > 0 || a.actual > 0;

  const goals: GoalStats[] = [];
  const sorted = [...input.goals].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  for (const goal of sorted) {
    const { total, byDay } = summarize(goal.id);
    const checklist = progress(weekItems.filter((c) => c.goalId === goal.id));
    const used = hasTime(total) || checklist.total > 0;
    const archived = goal.archivedOn !== null && goal.archivedOn <= weekStart;
    const createdOn = nowFrom(new Date(goal.createdAt)).day;
    if (!used && (archived || createdOn > lastDay)) continue;

    const t = effectiveTarget(input.targets, goal.id, weekStart);
    const weeklyTarget = t.minutes;
    const startDay = createdOn > weekStart && createdOn <= lastDay ? createdOn : null;
    const pace = weeklyTarget === null ? null : paceOf(weeklyTarget, days, goal.activeDays, now, startDay);
    const target = pace ? pace.target : null;
    const p = goalProgress({
      kind: goal.kind,
      phase,
      target,
      actual: phase === "current" ? total.actualSoFar : total.actual,
      remainingPlan: total.upcoming,
      expected: pace?.expected ?? 0,
      dayShare: pace?.dayShare ?? 0,
      outcomes: checklist,
    });
    goals.push({
      ...total,
      goalId: goal.id,
      goal,
      kind: goal.kind,
      target,
      weeklyTarget,
      targetFromWeek: t.fromWeek,
      prorated: pace?.prorated ?? false,
      expected: phase === "current" && pace ? pace.expected : null,
      paceDelta: p.paceDelta,
      planGap: p.planGap,
      checklist,
      byDay,
      status: p.status,
    });
  }

  const un = summarize(UNASSIGNED);
  const unassigned: GoalStats | null = hasTime(un.total)
    ? {
        ...un.total,
        goalId: UNASSIGNED,
        goal: null,
        kind: "min",
        target: null,
        weeklyTarget: null,
        targetFromWeek: null,
        prorated: false,
        expected: null,
        paceDelta: null,
        planGap: null,
        checklist: { done: 0, total: 0 },
        byDay: un.byDay,
        status: "no_target",
      }
    : null;

  const all = summarize(ALL);
  return {
    phase,
    goals,
    unassigned,
    totals: all.total,
    byDay: all.byDay,
    uncorrectedDays: days.filter((d) => d <= now.day && uncorrected.has(d)),
  };
}
