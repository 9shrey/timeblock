import type { Change, ChangeSet, DataState, EntityMap, Table } from "./types";

export const TABLES: readonly Table[] = [
  "settings",
  "goals",
  "weekTargets",
  "checklistItems",
  "templates",
  // Before blocks: occurrences reference their routine.
  "routines",
  "blocks",
  "weekNotes",
  "calendarSubscriptions",
] as const;

/** Primary key of a row, as used in `DataState` and `del` changes. */
export function keyOf<T extends Table>(table: T, row: EntityMap[T]): string {
  switch (table) {
    case "weekTargets": {
      const r = row as EntityMap["weekTargets"];
      return `${r.goalId}|${r.weekStart}`;
    }
    case "weekNotes":
      return (row as EntityMap["weekNotes"]).weekStart;
    case "settings":
      return (row as EntityMap["settings"]).key;
    default:
      return (row as { id: string }).id;
  }
}

export function targetKey(goalId: string, weekStart: string): string {
  return `${goalId}|${weekStart}`;
}

export function emptyState(): DataState {
  return { settings: {}, goals: {}, weekTargets: {}, checklistItems: {}, templates: {}, routines: {}, blocks: {}, weekNotes: {}, calendarSubscriptions: {} };
}

export function stateFrom(rows: { [T in Table]?: EntityMap[T][] }): DataState {
  const s = emptyState();
  for (const t of TABLES) {
    const table = s[t] as Record<string, EntityMap[typeof t]>;
    for (const row of (rows[t] ?? []) as EntityMap[typeof t][]) table[keyOf(t, row)] = row;
  }
  return s;
}

export function put<T extends Table>(table: T, row: EntityMap[T]): Change {
  return { op: "put", table, row } as Change;
}

export function del(table: Table, key: string): Change {
  return { op: "del", table, key } as Change;
}

function changeKey(c: Change): string {
  return c.op === "put" ? keyOf(c.table, c.row) : c.key;
}

/** Applies changes in order. Pure: returns a new state, sharing untouched tables. */
export function applyChanges(state: DataState, changes: ChangeSet): DataState {
  if (changes.length === 0) return state;
  const next = { ...state };
  const copied = new Set<Table>();
  for (const c of changes) {
    if (!copied.has(c.table)) {
      (next as Record<Table, unknown>)[c.table] = { ...state[c.table] };
      copied.add(c.table);
    }
    const table = next[c.table] as Record<string, unknown>;
    if (c.op === "put") table[keyOf(c.table, c.row)] = c.row;
    else delete table[c.key];
  }
  return next;
}

/**
 * The ChangeSet that undoes `changes` when applied to `applyChanges(state, changes)`.
 * Built from the rows as they were before each change.
 */
export function invertChanges(state: DataState, changes: ChangeSet): ChangeSet {
  const inverse: Change[] = [];
  let cur = state;
  for (const c of changes) {
    const key = changeKey(c);
    const before = cur[c.table][key];
    inverse.push(before ? put(c.table, before) : del(c.table, key));
    cur = applyChanges(cur, [c]);
  }
  return inverse.reverse();
}

/**
 * Collapses a ChangeSet to its net effect per row (last write wins), preserving the
 * order in which rows were first touched. Used to coalesce live edits into one undo step.
 */
export function compactChanges(changes: ChangeSet): ChangeSet {
  const last = new Map<string, Change>();
  for (const c of changes) {
    const id = `${c.table}\u0000${changeKey(c)}`;
    last.delete(id);
    last.set(id, c);
  }
  return [...last.values()];
}
