/**
 * Imported .ics events: a read-only overlay for this session only. We deliberately don't
 * persist these (no new DB table/migration): they're a thin, disposable staging area —
 * "Copy to plan" turns one into an ordinary, undoable plan block, and the rest you don't
 * copy are just as easy to re-import later. See docs/roadmap.md's M11 section for why.
 */
import { create } from "zustand";
import type { IcsEvent } from "@/domain/ics/ics";

interface IcsState {
  /** Null until an import has been attempted this session. */
  imported: { fileName: string; events: IcsEvent[]; skipped: string[] } | null;
}

export const useIcs = create<IcsState>(() => ({ imported: null }));

export function setImportedIcs(fileName: string, events: IcsEvent[], skipped: string[]): void {
  useIcs.setState({ imported: { fileName, events, skipped } });
}

/** Removes an event from the overlay (after copying it to the plan, or to dismiss it). */
export function removeImportedIcsEvent(uid: string): void {
  useIcs.setState((s) => (s.imported ? { imported: { ...s.imported, events: s.imported.events.filter((e) => e.uid !== uid) } } : s));
}

export function clearImportedIcs(): void {
  useIcs.setState({ imported: null });
}
