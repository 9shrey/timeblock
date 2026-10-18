/**
 * Memoized views over `DataState`. Caches are keyed on table identity, which only changes
 * when a commit touches that table, so components get stable references.
 */
import { useStore } from "./store";
import { computeStats, type WeekStats } from "@/domain/stats/stats";
import { weekDays, weekStartOf } from "@/domain/time/localDate";
import type { Block, ChecklistItem, DataState, Goal, LocalDate, Now, Settings, WeekTarget } from "@/domain/types";

function memoByIdentity<K extends object, V>(fn: (k: K) => V): (k: K) => V {
  const cache = new WeakMap<K, V>();
  return (k) => {
    let v = cache.get(k);
    if (v === undefined) {
      v = fn(k);
      cache.set(k, v);
    }
    return v;
  };
}

const byStart = (a: Block, b: Block) => a.startMinute - b.startMinute || a.endMinute - b.endMinute || (a.id < b.id ? -1 : 1);

const blocksByDay = memoByIdentity((blocks: DataState["blocks"]) => {
  const map = new Map<LocalDate, Block[]>();
  for (const b of Object.values(blocks)) {
    const list = map.get(b.day);
    if (list) list.push(b);
    else map.set(b.day, [b]);
  }
  for (const list of map.values()) list.sort(byStart);
  return map;
});

const EMPTY: never[] = [];

export function blocksOn(data: DataState, day: LocalDate): Block[] {
  return blocksByDay(data.blocks).get(day) ?? EMPTY;
}

/** All blocks as an array (domain reconcile functions filter by day themselves). */
export const allBlocks = memoByIdentity((blocks: DataState["blocks"]) => Object.values(blocks));

export const goalList = memoByIdentity((goals: DataState["goals"]): Goal[] =>
  Object.values(goals).sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt),
);

/** Goals offered in pickers for `weekStart`: not archived by then. */
export function activeGoals(data: DataState, weekStart: LocalDate): Goal[] {
  return goalList(data.goals).filter((g) => !g.archivedOn || g.archivedOn > weekStart);
}

export const targetList = memoByIdentity((t: DataState["weekTargets"]): WeekTarget[] => Object.values(t));
export const checklistList = memoByIdentity((c: DataState["checklistItems"]): ChecklistItem[] => Object.values(c));

export function weekOf(day: LocalDate, settings: Settings): { weekStart: LocalDate; days: LocalDate[] } {
  const weekStart = weekStartOf(day, settings.weekStartDay);
  return { weekStart, days: weekDays(weekStart) };
}

export function statsFor(data: DataState, days: readonly LocalDate[], weekStart: LocalDate, now: Now): WeekStats {
  const set = new Set(days);
  return computeStats({
    days,
    weekStart,
    blocks: allBlocks(data.blocks).filter((b) => set.has(b.day)),
    goals: goalList(data.goals),
    targets: targetList(data.weekTargets),
    checklist: checklistList(data.checklistItems),
    now,
  });
}

// --- hooks -----------------------------------------------------------------

export const useData = () => useStore((s) => s.data);
export const useNow = () => useStore((s) => s.now);
export const useSettings = () => useStore((s) => s.settings);
export const useDayBlocks = (day: LocalDate) => useStore((s) => blocksOn(s.data, day));
export const useGoals = () => useStore((s) => goalList(s.data.goals));
export const useGoalMap = () => useStore((s) => s.data.goals);
