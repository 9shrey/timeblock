import { compactChanges } from "@/domain/changes";
import type { ChangeSet } from "@/domain/types";

export const HISTORY_LIMIT = 100;

export interface HistoryEntry {
  forward: ChangeSet;
  inverse: ChangeSet;
  label: string;
  /** Consecutive commits with the same key merge into one entry (e.g. live popover edits). */
  coalesceKey?: string;
}

export interface History {
  undo: HistoryEntry[];
  redo: HistoryEntry[];
}

export const emptyHistory = (): History => ({ undo: [], redo: [] });

/** Records a commit; merges into the top entry when the coalesce keys match. Clears redo. */
export function record(h: History, entry: HistoryEntry): History {
  const top = h.undo[h.undo.length - 1];
  if (top && entry.coalesceKey && top.coalesceKey === entry.coalesceKey) {
    const merged: HistoryEntry = {
      ...top,
      forward: compactChanges([...top.forward, ...entry.forward]),
      // Undo applies the newer inverse first, then the older one; per row the oldest "before" wins.
      inverse: compactChanges([...entry.inverse, ...top.inverse]),
    };
    return { undo: [...h.undo.slice(0, -1), merged], redo: [] };
  }
  return { undo: [...h.undo, entry].slice(-HISTORY_LIMIT), redo: [] };
}

/** Moves the top undo entry to redo. Returns null when there is nothing to undo. */
export function popUndo(h: History): { entry: HistoryEntry; history: History } | null {
  const entry = h.undo[h.undo.length - 1];
  if (!entry) return null;
  return { entry, history: { undo: h.undo.slice(0, -1), redo: [...h.redo, entry] } };
}

export function popRedo(h: History): { entry: HistoryEntry; history: History } | null {
  const entry = h.redo[h.redo.length - 1];
  if (!entry) return null;
  return { entry, history: { undo: [...h.undo, entry], redo: h.redo.slice(0, -1) } };
}
