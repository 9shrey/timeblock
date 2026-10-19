/**
 * Per-goal, per-week checklist items. Unfinished items can be carried over to a later
 * week; `carriedFromId` makes that idempotent.
 */
import { del, put } from "../changes";
import type { ChangeSet, ChecklistItem, Env, LocalDate } from "../types";

/** Done / total counts. */
export function progress(items: readonly ChecklistItem[]): { done: number; total: number } {
  return { done: items.filter((i) => i.done).length, total: items.length };
}

function nextSortOrder(items: readonly ChecklistItem[], goalId: string, weekStart: LocalDate): number {
  return (
    items.reduce((m, i) => (i.goalId === goalId && i.weekStart === weekStart ? Math.max(m, i.sortOrder) : m), -1) + 1
  );
}

/** New item (trimmed text) at the end of its goal + week list. */
export function addItem(
  goalId: string,
  weekStart: LocalDate,
  text: string,
  existing: readonly ChecklistItem[],
  env: Env,
): { item: ChecklistItem; changes: ChangeSet } {
  const now = env.nowMs();
  const item: ChecklistItem = {
    id: env.newId(),
    goalId,
    weekStart,
    text: text.trim(),
    done: false,
    sortOrder: nextSortOrder(existing, goalId, weekStart),
    carriedFromId: null,
    createdAt: now,
    updatedAt: now,
  };
  return { item, changes: [put("checklistItems", item)] };
}

/** Patches an item (text is trimmed). */
export function updateItem(
  item: ChecklistItem,
  patch: Partial<Pick<ChecklistItem, "text" | "done" | "sortOrder">>,
  env: Env,
): ChangeSet {
  const next: ChecklistItem = { ...item, ...patch, updatedAt: env.nowMs() };
  if (patch.text !== undefined) next.text = patch.text.trim();
  return [put("checklistItems", next)];
}

export function deleteItem(item: ChecklistItem): ChangeSet {
  return [del("checklistItems", item.id)];
}

/** Unfinished items of `fromWeek` (optionally one goal) not yet carried into `toWeek`. */
function carryable(
  items: readonly ChecklistItem[],
  fromWeek: LocalDate,
  toWeek: LocalDate,
  goalId?: string,
): ChecklistItem[] {
  const carried = new Set<string>();
  for (const i of items) if (i.weekStart === toWeek && i.carriedFromId) carried.add(i.carriedFromId);
  return items
    .filter(
      (i) =>
        i.weekStart === fromWeek &&
        !i.done &&
        (goalId === undefined || i.goalId === goalId) &&
        !carried.has(i.id),
    )
    .sort((a, b) => (a.goalId < b.goalId ? -1 : a.goalId > b.goalId ? 1 : a.sortOrder - b.sortOrder));
}

/** Number of items `carryOver` would copy. */
export function carryableCount(
  items: readonly ChecklistItem[],
  fromWeek: LocalDate,
  toWeek: LocalDate,
  goalId?: string,
): number {
  if (fromWeek === toWeek) return 0;
  return carryable(items, fromWeek, toWeek, goalId).length;
}

/**
 * Copies unfinished items of `fromWeek` into `toWeek` (appended per goal) with
 * `carriedFromId` = source id. Idempotent: sources already carried into `toWeek` are skipped.
 */
export function carryOver(
  items: readonly ChecklistItem[],
  fromWeek: LocalDate,
  toWeek: LocalDate,
  env: Env,
  goalId?: string,
): ChangeSet {
  if (fromWeek === toWeek) return [];
  const sources = carryable(items, fromWeek, toWeek, goalId);
  const next = new Map<string, number>();
  const changes: ChangeSet = [];
  for (const s of sources) {
    const order = next.get(s.goalId) ?? nextSortOrder(items, s.goalId, toWeek);
    next.set(s.goalId, order + 1);
    const now = env.nowMs();
    changes.push(
      put("checklistItems", {
        id: env.newId(),
        goalId: s.goalId,
        weekStart: toWeek,
        text: s.text,
        done: false,
        sortOrder: order,
        carriedFromId: s.id,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }
  return changes;
}
