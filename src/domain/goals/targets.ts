/**
 * Goals and their weekly targets. A target carries forward: the effective target for
 * week W is the latest row with weekStart <= W.
 */
import { del, keyOf, put } from "../changes";
import type { Block, ChangeSet, ChecklistItem, Env, Goal, GoalKind, GoalTrackBy, LocalDate, WeekTarget } from "../types";

/**
 * Latest target row for `goalId` at or before `weekStart`; `minutes`/`count` null = tracked
 * only / none. Which field applies depends on the goal's `trackBy`.
 */
export function effectiveTarget(
  rows: readonly WeekTarget[],
  goalId: string,
  weekStart: LocalDate,
): { minutes: number | null; count: number | null; fromWeek: LocalDate | null } {
  let best: WeekTarget | null = null;
  for (const r of rows) {
    if (r.goalId !== goalId || r.weekStart > weekStart) continue;
    if (!best || r.weekStart > best.weekStart) best = r;
  }
  return best
    ? { minutes: best.targetMinutes, count: best.targetCount, fromWeek: best.weekStart }
    : { minutes: null, count: null, fromWeek: null };
}

/** Upserts only the row for `weekStart`; later weeks keep their own rows. */
export function setTargetChanges(goalId: string, weekStart: LocalDate, minutes: number | null, env: Env): ChangeSet {
  return [put("weekTargets", { goalId, weekStart, targetMinutes: minutes, targetCount: null, updatedAt: env.nowMs() })];
}

/** Upserts only the row for `weekStart` with a task-count target; later weeks keep their own rows. */
export function setTaskTargetChanges(goalId: string, weekStart: LocalDate, count: number | null, env: Env): ChangeSet {
  return [put("weekTargets", { goalId, weekStart, targetMinutes: null, targetCount: count, updatedAt: env.nowMs() })];
}

/** New goal at the end of the list, plus a target row for the viewed week. */
export function createGoal(
  input: { name: string; color: string; kind: GoalKind; trackBy: GoalTrackBy; targetMinutes: number | null; targetCount: number | null },
  weekStart: LocalDate,
  existingGoals: readonly Goal[],
  env: Env,
): { goal: Goal; changes: ChangeSet } {
  const now = env.nowMs();
  const sortOrder = existingGoals.reduce((m, g) => Math.max(m, g.sortOrder), -1) + 1;
  const goal: Goal = {
    id: env.newId(),
    name: input.name.trim(),
    color: input.color,
    kind: input.kind,
    trackBy: input.trackBy,
    sortOrder,
    archivedOn: null,
    createdAt: now,
    updatedAt: now,
  };
  return {
    goal,
    changes: [
      put("goals", goal),
      put("weekTargets", {
        goalId: goal.id,
        weekStart,
        targetMinutes: input.targetMinutes,
        targetCount: input.targetCount,
        updatedAt: now,
      }),
    ],
  };
}

/** Patches a goal (name is trimmed). */
export function updateGoal(
  goal: Goal,
  patch: Partial<Pick<Goal, "name" | "color" | "kind" | "trackBy" | "sortOrder" | "archivedOn">>,
  env: Env,
): ChangeSet {
  const next: Goal = { ...goal, ...patch, updatedAt: env.nowMs() };
  if (patch.name !== undefined) next.name = patch.name.trim();
  return [put("goals", next)];
}

/**
 * Deletes a goal explicitly: its blocks get goalId null, its checklist items and target
 * rows are deleted, then the goal itself (mirrors the DB cascade / set-null, so it inverts).
 */
export function deleteGoalChanges(
  goal: Goal,
  rows: { targets: readonly WeekTarget[]; checklist: readonly ChecklistItem[]; blocks: readonly Block[] },
  env: Env,
): ChangeSet {
  const now = env.nowMs();
  const changes: ChangeSet = [];
  for (const b of rows.blocks) {
    if (b.goalId === goal.id) changes.push(put("blocks", { ...b, goalId: null, updatedAt: now }));
  }
  for (const c of rows.checklist) {
    if (c.goalId === goal.id) changes.push(del("checklistItems", c.id));
  }
  for (const t of rows.targets) {
    if (t.goalId === goal.id) changes.push(del("weekTargets", keyOf("weekTargets", t)));
  }
  changes.push(del("goals", goal.id));
  return changes;
}

/**
 * Writes `sortOrder` for every goal in `orderedIds` (0, 1, 2, …), skipping any already at
 * that index. Used for drag-to-reorder; `goals` need not already be sorted.
 */
export function reorderGoalsChanges(goals: readonly Goal[], orderedIds: readonly string[], env: Env): ChangeSet {
  const now = env.nowMs();
  const byId = new Map(goals.map((g) => [g.id, g]));
  const changes: ChangeSet = [];
  orderedIds.forEach((id, i) => {
    const g = byId.get(id);
    if (g && g.sortOrder !== i) changes.push(put("goals", { ...g, sortOrder: i, updatedAt: now }));
  });
  return changes;
}
