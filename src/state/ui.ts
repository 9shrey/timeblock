/** Transient UI state that is not part of the data model or undo history. */
import { create } from "zustand";
import type { ItemRef } from "@/features/timeline/dragMachine";
import type { Layer, LocalDate } from "@/domain/types";

export interface Editing {
  ref: ItemRef;
  /** A just-created block: Esc with nothing entered cancels the create. */
  isNew: boolean;
  /** Coalesce key for all edits of this popover session. */
  session: string;
  /** Opened from the keyboard: move focus into the popover. */
  focus: boolean;
}

export type TemplateDialogState =
  | { kind: "save"; scope: "day" | "week"; day: LocalDate }
  | { kind: "apply"; scope: "day" | "week"; day: LocalDate };

interface UiState {
  editing: Editing | null;
  /** Past days whose Plan lane was unlocked for this session. */
  unlockedPlanDays: LocalDate[];
  /** Right-clicked thing for the shared context menu. */
  menu: { kind: "item"; ref: ItemRef; col: number; minute: number } | { kind: "empty"; col: number; minute: number } | null;
  /** Save-as-template or apply-template dialog, opened from a context menu or empty-day prompt. */
  templateDialog: TemplateDialogState | null;
  /** One-line quick-add input (`n` key), for a day and lane. */
  quickAdd: { day: LocalDate; layer: Layer } | null;
}

export const useUi = create<UiState>(() => ({
  editing: null,
  unlockedPlanDays: [],
  menu: null,
  templateDialog: null,
  quickAdd: null,
}));

let sessionCounter = 0;

export function openEditor(ref: ItemRef, isNew = false, focus = false): void {
  useUi.setState({ editing: { ref, isNew, focus, session: `edit-${++sessionCounter}` } });
}

export function closeEditor(): void {
  useUi.setState({ editing: null });
}

export function unlockPlanDay(day: LocalDate): void {
  useUi.setState((s) => (s.unlockedPlanDays.includes(day) ? s : { unlockedPlanDays: [...s.unlockedPlanDays, day] }));
}

export function openTemplateDialog(state: TemplateDialogState): void {
  useUi.setState({ templateDialog: state });
}

export function closeTemplateDialog(): void {
  useUi.setState({ templateDialog: null });
}

export function openQuickAdd(day: LocalDate, layer: Layer): void {
  useUi.setState({ quickAdd: { day, layer } });
}

export function closeQuickAdd(): void {
  useUi.setState({ quickAdd: null });
}
