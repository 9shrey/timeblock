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

/** The previous result, so days whose blocks didn't change keep their array identity. */
let lastByDay = new Map<LocalDate, Block[]>();

const sameItems = (a: readonly Block[], b: readonly Block[]) => a.length === b.length && a.every((x, i) => x === b[i]);

const blocksByDay = memoByIdentity((blocks: DataState["blocks"]) => {
  const map = new Map<LocalDate, Block[]>();
  for (const b of Object.values(blocks)) {
    const list = map.get(b.day);
    if (list) list.push(b);
    else map.set(b.day, [b]);
  }
  for (const [day, list] of map) {
    list.sort(byStart);
    // A commit rebuilds every day; reuse the old array where nothing changed so only
    // the edited day's lanes re-render.
    const prev = lastByDay.get(day);
    if (prev && sameItems(prev, list)) map.set(day, prev);
  }
  lastByDay = map;
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

/**
 * The clock as one lane needs it: today's minute, or a fixed value for any past (1440) or
 * future (-1) day, so a minute tick re-renders only today's lanes.
 */
export const useLaneMinute = (day: LocalDate) =>
  useStore((s) => (s.now.day === day ? s.now.minute : s.now.day > day ? 1440 : -1));

/** The selection key if the selected block or ghost is in this lane, else null. */
export const useLaneSelection = (day: LocalDate, layer: Block["layer"], showGhosts: boolean) =>
  useStore((s): string | null => {
    const sel = s.selection;
    if (!sel) return null;
    if (sel.kind === "block") {
      const b = s.data.blocks[sel.id];
      return b && b.day === day && b.layer === layer ? `block:${sel.id}` : null;
    }
    return showGhosts && s.data.blocks[sel.planBlockId]?.day === day ? `ghost:${sel.planBlockId}` : null;
  });
export const useGoals = () => useStore((s) => goalList(s.data.goals));
export const useGoalMap = () => useStore((s) => s.data.goals);
