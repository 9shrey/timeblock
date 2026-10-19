/**
 * App state: every loaded row in one `DataState`, mutated only through `commit(ChangeSet)`.
 * Commits apply optimistically, record an inverse for undo, and queue the DB write.
 */
import { create } from "zustand";
import { applyChanges, emptyState, invertChanges, stateFrom } from "@/domain/changes";
import { parseSettings } from "@/domain/settings";
import { addDays, weekShiftDays, weekStartOf } from "@/domain/time/localDate";
import type { ChangeSet, DataState, LocalDate, Now, Repository, Settings, WeekData, WeekStartDay } from "@/domain/types";
import { createWriteQueue, type WriteQueue } from "@/data/writeQueue";
import { emptyHistory, popRedo, popUndo, record, type History } from "./history";

export type View = "day" | "week" | "goals" | "review" | "settings";
export type ResolvedTheme = "light" | "dark";

export type Selection = { kind: "block"; id: string } | { kind: "ghost"; planBlockId: string } | null;

export interface CommitOptions {
  label?: string;
  /** Consecutive commits with the same key become one undo step. */
  coalesceKey?: string;
  /** Skip the undo history (e.g. settings that must not be undone). */
  noHistory?: boolean;
}

export interface AppState {
  ready: boolean;
  data: DataState;
  settings: Settings;
  /** Week starts whose blocks/checklist/notes are in `data`. */
  loadedWeeks: LocalDate[];
  history: History;
  now: Now;
  view: View;
  /** The day the Day view shows (and whose week the Week/Goals/Review views show). */
  cursor: LocalDate;
  selection: Selection;
  budgetOpen: boolean;
  systemTheme: ResolvedTheme;
}

export interface StoreDeps {
  repo: Repository;
  /** Called when a queued write fails, after state was reloaded from the DB. */
  onWriteError?: (error: unknown) => void;
}

let deps: (StoreDeps & { queue: WriteQueue }) | null = null;

function requireDeps() {
  if (!deps) throw new Error("Store used before initStore()");
  return deps;
}

const initialNow: Now = { day: "1970-01-01", minute: 0 };

export const useStore = create<AppState>(() => ({
  ready: false,
  data: emptyState(),
  settings: parseSettings([]),
  loadedWeeks: [],
  history: emptyHistory(),
  now: initialNow,
  view: "day",
  cursor: initialNow.day,
  selection: null,
  budgetOpen: false,
  systemTheme: "light",
}));

const get = useStore.getState;
const set = useStore.setState;

function mergeWeek(data: DataState, week: WeekData): DataState {
  const rows = stateFrom({
    blocks: week.blocks,
    checklistItems: week.checklistItems,
    weekNotes: week.weekNote ? [week.weekNote] : [],
  });
  // Rows already in memory win: they may carry optimistic edits newer than the DB read.
  return {
    ...data,
    blocks: { ...rows.blocks, ...data.blocks },
    checklistItems: { ...rows.checklistItems, ...data.checklistItems },
    weekNotes: { ...rows.weekNotes, ...data.weekNotes },
  };
}

async function loadAll(repo: Repository, weeks: readonly LocalDate[]): Promise<DataState> {
  const base = await repo.loadBase();
  let data = stateFrom({ goals: base.goals, weekTargets: base.weekTargets, settings: base.settings });
  for (const w of weeks) data = mergeWeek(data, await repo.loadWeek(w));
  return data;
}

/** Re-reads every loaded week from the DB and clears undo history (after a failed write or bulk change). */
export async function reloadFromDb(): Promise<void> {
  const { repo, queue } = requireDeps();
  await queue.flush();
  const data = await loadAll(repo, get().loadedWeeks);
  set({ data, settings: parseSettings(Object.values(data.settings)), history: emptyHistory(), selection: null });
}

/**
 * Re-reads everything after a bulk change (import, week-start change): forgets loaded weeks,
 * reloads base data and the weeks around the cursor, clears undo history.
 */
export async function reloadAll(): Promise<void> {
  const { repo, queue } = requireDeps();
  await queue.flush();
  const data = await loadAll(repo, []);
  const settings = parseSettings(Object.values(data.settings));
  set({ data, settings, loadedWeeks: [], history: emptyHistory(), selection: null });
  await ensureWeeksAround(weekStartOf(get().cursor, settings.weekStartDay));
}

/** Switches the week start day, remapping every stored week key in one transaction. */
export async function changeWeekStartDay(day: WeekStartDay): Promise<void> {
  const { repo, queue } = requireDeps();
  const from = get().settings.weekStartDay;
  if (from === day) return;
  await queue.flush();
  await repo.changeWeekStart(weekShiftDays(from, day), day);
  await reloadAll();
}

/** Wires the store to a repository and loads base data plus the weeks around `now`. */
export async function initStore(d: StoreDeps, now: Now): Promise<void> {
  const queue = createWriteQueue(
    (cs) => d.repo.applyChanges(cs),
    (error) => {
      void reloadFromDb().finally(() => d.onWriteError?.(error));
    },
  );
  deps = { ...d, queue };
  const data = await loadAll(d.repo, []);
  const settings = parseSettings(Object.values(data.settings));
  set({ data, settings, now, cursor: now.day, history: emptyHistory(), loadedWeeks: [], selection: null });
  await ensureWeeksAround(weekStartOf(now.day, settings.weekStartDay));
  set({ ready: true });
}

/** Week loads in flight, so concurrent callers share one read. */
const weekLoads = new Map<LocalDate, Promise<void>>();

/** Loads a week (once). A failed load rejects and is retried by the next call. */
export function ensureWeek(weekStart: LocalDate): Promise<void> {
  const { repo, queue } = requireDeps();
  if (get().loadedWeeks.includes(weekStart)) return Promise.resolve();
  let load = weekLoads.get(weekStart);
  if (!load) {
    load = (async () => {
      await queue.flush();
      const week = await repo.loadWeek(weekStart);
      set((s) => ({ data: mergeWeek(s.data, week), loadedWeeks: [...s.loadedWeeks, weekStart] }));
    })().finally(() => weekLoads.delete(weekStart));
    weekLoads.set(weekStart, load);
  }
  return load;
}

/** Loads the given week and its neighbours. */
export async function ensureWeeksAround(weekStart: LocalDate): Promise<void> {
  await Promise.all([ensureWeek(addDays(weekStart, -7)), ensureWeek(weekStart), ensureWeek(addDays(weekStart, 7))]);
}

/** Applies a ChangeSet optimistically, records undo, queues the write. */
export function commit(changes: ChangeSet, opts: CommitOptions = {}): void {
  if (changes.length === 0) return;
  const { queue } = requireDeps();
  const s = get();
  const inverse = invertChanges(s.data, changes);
  const data = applyChanges(s.data, changes);
  const history = opts.noHistory
    ? s.history
    : record(s.history, { forward: changes, inverse, label: opts.label ?? "Edit", coalesceKey: opts.coalesceKey });
  set({ data, history, ...settingsPatch(data, changes) });
  void queue.push(changes);
}

function settingsPatch(data: DataState, changes: ChangeSet): Partial<AppState> {
  return changes.some((c) => c.table === "settings") ? { settings: parseSettings(Object.values(data.settings)) } : {};
}

function replay(changes: ChangeSet): void {
  const { queue } = requireDeps();
  const s = get();
  const data = applyChanges(s.data, changes);
  set({ data, ...settingsPatch(data, changes) });
  void queue.push(changes);
}

export function undo(): string | null {
  const popped = popUndo(get().history);
  if (!popped) return null;
  set({ history: popped.history });
  replay(popped.entry.inverse);
  return popped.entry.label;
}

export function redo(): string | null {
  const popped = popRedo(get().history);
  if (!popped) return null;
  set({ history: popped.history });
  replay(popped.entry.forward);
  return popped.entry.label;
}

export function clearHistory(): void {
  set({ history: emptyHistory() });
}

/** Ends coalescing: the next commit with the same key starts a new undo step. */
export function sealHistory(): void {
  const h = get().history;
  const top = h.undo[h.undo.length - 1];
  if (top?.coalesceKey) set({ history: { ...h, undo: [...h.undo.slice(0, -1), { ...top, coalesceKey: undefined }] } });
}

/** Waits for all queued writes (tests, export, shutdown). */
export function flushWrites(): Promise<void> {
  return requireDeps().queue.flush();
}

/** Number of writes queued or in flight. */
export function pendingWrites(): number {
  return requireDeps().queue.pending;
}

export function getRepo(): Repository {
  return requireDeps().repo;
}
