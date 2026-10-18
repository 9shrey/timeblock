/** Goal, weekly target, checklist and week-note actions. Each is one undo step. */
import { toast } from "sonner";
import { addItem, carryOver, deleteItem, updateItem } from "@/domain/goals/checklist";
import { createGoal as createGoalChanges, deleteGoalChanges, setTargetChanges, updateGoal } from "@/domain/goals/targets";
import { put } from "@/domain/changes";
import { systemEnv } from "@/domain/env";
import type { ChecklistItem, Goal, GoalKind, LocalDate } from "@/domain/types";
import { allBlocks, checklistList, goalList, targetList } from "./selectors";
import { commit, getRepo, useStore } from "./store";

const env = systemEnv;
const data = () => useStore.getState().data;

export const MAX_TARGET_MINUTES = 10080;

export function createGoal(input: { name: string; color: string; kind: GoalKind; targetMinutes: number | null }, weekStart: LocalDate): Goal | null {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 80) {
    toast.error("Goal names need 1–80 characters.");
    return null;
  }
  const { goal, changes } = createGoalChanges({ ...input, name }, weekStart, goalList(data().goals), env);
  commit(changes, { label: "Create goal" });
  return goal;
}

export function editGoal(goal: Goal, patch: Partial<Pick<Goal, "name" | "color" | "kind" | "archivedOn" | "sortOrder">>, coalesceKey?: string): void {
  if (patch.name !== undefined && (patch.name.trim().length < 1 || patch.name.trim().length > 80)) return;
  commit(updateGoal(goal, patch, env), { label: "Edit goal", coalesceKey });
}

/** Sets the target for `weekStart` only; later weeks keep their own rows, earlier weeks are untouched. */
export function setTarget(goalId: string, weekStart: LocalDate, minutes: number | null): void {
  if (minutes !== null && (!Number.isFinite(minutes) || minutes < 0 || minutes > MAX_TARGET_MINUTES)) {
    toast.error("Targets must be between 0 and 168 hours.");
    return;
  }
  commit(setTargetChanges(goalId, weekStart, minutes === null ? null : Math.round(minutes), env), { label: "Set target" });
}

/** Deletes a goal only if no block or checklist item (in any week) uses it. */
export async function deleteGoal(goal: Goal): Promise<boolean> {
  const usage = await getRepo().goalUsage(goal.id);
  const d = data();
  const loadedUse = allBlocks(d.blocks).some((b) => b.goalId === goal.id) || checklistList(d.checklistItems).some((c) => c.goalId === goal.id);
  if (usage.blocks > 0 || usage.checklistItems > 0 || loadedUse) {
    toast.error("This goal is in use. Archive it instead.");
    return false;
  }
  commit(
    deleteGoalChanges(goal, { targets: targetList(d.weekTargets), checklist: checklistList(d.checklistItems), blocks: allBlocks(d.blocks) }, env),
    { label: "Delete goal" },
  );
  return true;
}

export function moveGoal(goal: Goal, direction: -1 | 1): void {
  const list = goalList(data().goals);
  const i = list.findIndex((g) => g.id === goal.id);
  const other = list[i + direction];
  if (!other) return;
  // Swap sort orders; normalise to indices first so equal orders still move.
  const changes = [
    ...updateGoal(goal, { sortOrder: i + direction }, env),
    ...updateGoal(other, { sortOrder: i }, env),
    ...list
      .filter((g, j) => g !== goal && g !== other && g.sortOrder !== j)
      .map((g) => put("goals", { ...g, sortOrder: list.indexOf(g) })),
  ];
  commit(changes, { label: "Reorder goals" });
}

// --- checklist -------------------------------------------------------------

export function addChecklistItem(goalId: string, weekStart: LocalDate, text: string): void {
  const t = text.trim();
  if (!t) return;
  if (t.length > 500) {
    toast.error("Outcomes are limited to 500 characters.");
    return;
  }
  const { changes } = addItem(goalId, weekStart, t, checklistList(data().checklistItems), env);
  commit(changes, { label: "Add outcome" });
}

export function toggleChecklistItem(item: ChecklistItem): void {
  commit(updateItem(item, { done: !item.done }, env), { label: item.done ? "Reopen outcome" : "Complete outcome" });
}

export function editChecklistItem(item: ChecklistItem, text: string): void {
  const t = text.trim();
  if (!t) {
    commit(deleteItem(item), { label: "Delete outcome" });
    return;
  }
  if (t !== item.text && t.length <= 500) commit(updateItem(item, { text: t }, env), { label: "Edit outcome" });
}

export function removeChecklistItem(item: ChecklistItem): void {
  commit(deleteItem(item), { label: "Delete outcome" });
}

/** Copies unfinished outcomes of `fromWeek` into `toWeek` (idempotent). */
export function carryOverItems(fromWeek: LocalDate, toWeek: LocalDate, goalId?: string): number {
  const changes = carryOver(checklistList(data().checklistItems), fromWeek, toWeek, env, goalId);
  if (changes.length) commit(changes, { label: "Carry over outcomes" });
  return changes.length;
}

// --- week notes ------------------------------------------------------------

export function setWeekNote(weekStart: LocalDate, text: string, coalesceKey?: string): void {
  commit([put("weekNotes", { weekStart, text, updatedAt: env.nowMs() })], { label: "Edit reflection", coalesceKey });
}
