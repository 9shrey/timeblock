/** Transient UI state that is not part of the data model or undo history. */
import { create } from "zustand";
import type { ItemRef } from "@/features/timeline/dragMachine";
import type { LocalDate } from "@/domain/types";

export interface Editing {
  ref: ItemRef;
  /** A just-created block: Esc with nothing entered cancels the create. */
  isNew: boolean;
  /** Coalesce key for all edits of this popover session. */
  session: string;
}

interface UiState {
  editing: Editing | null;
  /** Past days whose Plan lane was unlocked for this session. */
  unlockedPlanDays: LocalDate[];
  /** Right-clicked thing for the shared context menu. */
  menu: { kind: "item"; ref: ItemRef; col: number; minute: number } | { kind: "empty"; col: number; minute: number } | null;
}

export const useUi = create<UiState>(() => ({ editing: null, unlockedPlanDays: [], menu: null }));

let sessionCounter = 0;

export function openEditor(ref: ItemRef, isNew = false): void {
  useUi.setState({ editing: { ref, isNew, session: `edit-${++sessionCounter}` } });
}

export function closeEditor(): void {
  useUi.setState({ editing: null });
}

export function unlockPlanDay(day: LocalDate): void {
  useUi.setState((s) => (s.unlockedPlanDays.includes(day) ? s : { unlockedPlanDays: [...s.unlockedPlanDays, day] }));
}
