/** Global keyboard shortcuts. Ignored while typing in a field or while a dialog/menu has focus. */
import { useEffect } from "react";
import {
  clearMulti,
  confirm,
  deleteMulti,
  selectAllOn,
  confirmRestOfDay,
  deleteItem,
  nudge,
  redo,
  resizeItemBy,
  select,
  setGoal,
  skip,
  undo,
} from "@/state/commands";
import { goalList, weekOf } from "@/state/selectors";
import { useStore, type View } from "@/state/store";
import { closeEditor, openEditor, openQuickAdd, setCommandPaletteOpen, setShortcutsOpen, useUi } from "@/state/ui";
import type { ItemRef } from "@/features/timeline/dragMachine";
import { goToday, stepCursor } from "./TopBar";

const VIEW_KEYS: Record<string, View> = { d: "day", w: "week", m: "month", g: "goals", r: "review", i: "trends" };

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return !!el.closest("input, textarea, select, [contenteditable=true], [role=dialog], [role=menu], [role=listbox]");
}

function selectedRef(): ItemRef | null {
  const sel = useStore.getState().selection;
  return sel ? (sel.kind === "block" ? { kind: "block", id: sel.id } : sel) : null;
}

/** Plan block id behind a selection (the ghost's plan, or a selected plan block). */
function selectedPlanId(ref: ItemRef): string | null {
  if (ref.kind === "ghost") return ref.planBlockId;
  const b = useStore.getState().data.blocks[ref.id];
  return b?.layer === "plan" ? b.id : null;
}

export function handleKey(e: KeyboardEvent): boolean {
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key;
  const s = useStore.getState();

  if (ctrl && !e.altKey) {
    if (key.toLowerCase() === "z") {
      if (e.shiftKey) redo();
      else undo();
      return true;
    }
    if (key.toLowerCase() === "y") {
      redo();
      return true;
    }
    if (key.toLowerCase() === "b") {
      useStore.setState({ budgetOpen: !s.budgetOpen });
      return true;
    }
    if (key.toLowerCase() === "a" && (s.view === "day" || s.view === "week")) {
      selectAllOn(s.view === "day" ? [s.cursor] : weekOf(s.cursor, s.settings).days);
      return true;
    }
    if (key.toLowerCase() === "k") {
      setCommandPaletteOpen(true);
      return true;
    }
    return false;
  }
  if (e.altKey) return false;

  if (useUi.getState().multiSelected.length > 0) {
    if (key === "Delete" || key === "Backspace") {
      deleteMulti();
      return true;
    }
    if (key === "Escape") {
      clearMulti();
      return true;
    }
  }

  if (key === "Escape") {
    if (useUi.getState().editing) closeEditor();
    else if (s.selection) select(null);
    else return false;
    return true;
  }

  if (key === "?") {
    setShortcutsOpen(true);
    return true;
  }

  const ref = selectedRef();
  // Enter on some other focused button (Today, nav rail, ✓/✗) keeps its own meaning.
  const onOtherButton = !!(e.target as HTMLElement | null)?.closest?.("button:not([data-item]), a, [data-nodrag]");
  if (ref && !(onOtherButton && (key === "Enter" || key === " "))) {
    const step = s.settings.snapMinutes;
    switch (key) {
      case "Enter":
        openEditor(ref, false, true);
        return true;
      case "Delete":
      case "Backspace":
        deleteItem(ref);
        return true;
      case "ArrowUp":
        if (e.shiftKey) resizeItemBy(ref, -step);
        else nudge(ref, -step);
        return true;
      case "ArrowDown":
        if (e.shiftKey) resizeItemBy(ref, step);
        else nudge(ref, step);
        return true;
      case "a": {
        const planId = selectedPlanId(ref);
        if (planId) confirm(planId);
        return true;
      }
      case "s": {
        const planId = selectedPlanId(ref);
        if (planId) skip(planId);
        return true;
      }
    }
    if (/^[1-9]$/.test(key)) {
      const goal = goalList(s.data.goals).filter((g) => !g.archivedOn)[Number(key) - 1];
      if (goal) {
        const next = setGoal(ref, goal.id);
        if (next) select(next);
      }
      return true;
    }
  }

  if (key === "A" && e.shiftKey && s.view === "day") {
    confirmRestOfDay(s.cursor);
    return true;
  }
  if (key === "n" && s.view === "day" && !useUi.getState().editing) {
    openQuickAdd(s.cursor, "plan");
    return true;
  }
  if (VIEW_KEYS[key]) {
    useStore.setState({ view: VIEW_KEYS[key], selection: null });
    return true;
  }
  if (key === "t") {
    goToday();
    return true;
  }
  if (key === "[" || key === "]") {
    stepCursor(key === "[" ? -1 : 1);
    return true;
  }
  return false;
}

export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target)) return;
      if (handleKey(e)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
