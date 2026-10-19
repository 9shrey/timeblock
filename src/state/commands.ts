/**
 * User-level actions. Each one builds a ChangeSet with pure domain functions, validates it,
 * and commits it as a single undo step.
 */
import { toast } from "sonner";
import { nudgeInterval, resizeBy } from "@/domain/blocks/edit";
import {
  confirmGhost,
  confirmRestOfDay as confirmRestOfDayChanges,
  copyPlan,
  createBlock,
  deleteBlock,
  isActualReadOnly,
  materializeGhost,
  moveBlock,
  restorePlan,
  skipPlan,
  updateBlock,
  type BlockPatch,
} from "@/domain/blocks/reconcile";
import { validateBlock } from "@/domain/blocks/validate";
import { applyChanges, put } from "@/domain/changes";
import { systemEnv } from "@/domain/env";
import { weekDays } from "@/domain/time/localDate";
import type { Block, ChangeSet, Layer, LocalDate } from "@/domain/types";
import type { ItemRef } from "@/features/timeline/dragMachine";
import { activeGoals, allBlocks } from "./selectors";
import { commit, redo as storeRedo, undo as storeUndo, useStore } from "./store";
import { closeEditor, openEditor, useUi } from "./ui";

const env = systemEnv;
const state = () => useStore.getState();
const blocks = () => allBlocks(state().data.blocks);
const blockById = (id: string): Block | undefined => state().data.blocks[id];

/** Past Plan lanes are locked until unlocked for the session. */
export function isPlanLocked(day: LocalDate): boolean {
  return day < state().now.day && !useUi.getState().unlockedPlanDays.includes(day);
}

/** Whether the lane holding (day, layer) accepts edits. */
export function canEditLane(day: LocalDate, layer: Layer): boolean {
  return layer === "plan" ? !isPlanLocked(day) : !isActualReadOnly(day, state().now);
}

function laneError(layer: Layer): string {
  return layer === "plan" ? "This day's plan is locked. Click the lock icon to edit it." : "You can't log time in the future.";
}

/** Validates every block the ChangeSet writes, then commits. Returns false (and toasts) on error. */
function commitChecked(changes: ChangeSet, label: string, coalesceKey?: string): boolean {
  if (changes.length === 0) return false;
  const before = state().data;
  const after = applyChanges(before, changes);
  for (const c of changes) {
    if (c.table !== "blocks" || c.op !== "put") continue;
    const errors = validateBlock(c.row, { goals: after.goals, blocks: after.blocks, previous: before.blocks[c.row.id] ?? null });
    if (errors.length > 0) {
      toast.error(errors[0]!);
      return false;
    }
  }
  commit(changes, { label, coalesceKey });
  return true;
}

export function select(ref: ItemRef | null): void {
  useStore.setState({ selection: ref ? (ref.kind === "block" ? { kind: "block", id: ref.id } : ref) : null });
}

// --- create / edit ---------------------------------------------------------

export function createBlockAt(day: LocalDate, layer: Layer, start: number, end: number, openPopover = true): string | null {
  if (!canEditLane(day, layer)) {
    toast(laneError(layer));
    return null;
  }
  const { block, changes } = createBlock({ day, layer, startMinute: start, endMinute: end }, env);
  if (!commitChecked(changes, "Create block")) return null;
  select({ kind: "block", id: block.id });
  if (openPopover) openEditor({ kind: "block", id: block.id }, true);
  return block.id;
}

/** Double-click on empty space: a default-length block at the snapped slot. */
export function createDefaultAt(day: LocalDate, layer: Layer, minute: number): string | null {
  const { snapMinutes, defaultBlockMinutes } = state().settings;
  const start = Math.min(Math.floor(minute / snapMinutes) * snapMinutes, 1440 - defaultBlockMinutes);
  return createBlockAt(day, layer, Math.max(0, start), Math.min(1440, Math.max(0, start) + defaultBlockMinutes));
}

export function updateBlockFields(id: string, patch: BlockPatch, coalesceKey?: string): boolean {
  const b = blockById(id);
  if (!b) return false;
  if ((Object.keys(patch) as (keyof BlockPatch)[]).every((k) => b[k] === patch[k])) return true; // nothing changes
  if (!canEditLane(b.day, b.layer)) {
    toast(laneError(b.layer));
    return false;
  }
  return commitChecked(updateBlock(b, patch, env), "Edit block", coalesceKey);
}

export function resizeBlock(id: string, start: number, end: number): void {
  updateBlockFields(id, { startMinute: start, endMinute: end });
}

export function moveBlockTo(id: string, day: LocalDate, start: number, end: number, copy: boolean): void {
  const b = blockById(id);
  if (!b) return;
  if (!canEditLane(day, b.layer) || (!copy && !canEditLane(b.day, b.layer))) {
    toast(laneError(b.layer));
    return;
  }
  const { block, changes } = moveBlock(b, { day, startMinute: start, endMinute: end }, blocks(), env, { copy });
  if (commitChecked(changes, copy ? "Copy block" : "Move block")) select({ kind: "block", id: block.id });
}

export function removeBlock(id: string): void {
  const b = blockById(id);
  if (!b) return;
  if (!canEditLane(b.day, b.layer)) {
    toast(laneError(b.layer));
    return;
  }
  if (commitChecked(deleteBlock(b, blocks(), env), "Delete block")) {
    const sel = state().selection;
    if (sel?.kind === "block" && sel.id === id) select(null);
    const ed = useUi.getState().editing;
    if (ed?.ref.kind === "block" && ed.ref.id === id) closeEditor();
  }
}

// --- ghosts & plan state ---------------------------------------------------

function planOf(planBlockId: string): Block | null {
  const p = blockById(planBlockId);
  return p && p.layer === "plan" ? p : null;
}

/** Turns a ghost into a linked actual block with `patch`. Returns the new block id. */
export function materialize(planBlockId: string, patch: BlockPatch, coalesceKey?: string): string | null {
  const plan = planOf(planBlockId);
  if (!plan) return null;
  if (!canEditLane(plan.day, "actual")) {
    toast(laneError("actual"));
    return null;
  }
  const { block, changes } = materializeGhost(plan, patch, env);
  if (!commitChecked(changes, "Log block", coalesceKey)) return null;
  select({ kind: "block", id: block.id });
  return block.id;
}

export function confirm(planBlockId: string): void {
  const plan = planOf(planBlockId);
  if (!plan) return;
  if (!canEditLane(plan.day, "actual")) {
    toast(laneError("actual"));
    return;
  }
  if (commitChecked(confirmGhost(plan, blocks(), env), "Confirm as planned")) select(null);
}

export function skip(planBlockId: string): void {
  const plan = planOf(planBlockId);
  if (plan && commitChecked(skipPlan(plan, env), "Skip")) select(null);
}

export function restore(planBlockId: string): void {
  const plan = planOf(planBlockId);
  if (plan) commitChecked(restorePlan(plan, env), "Restore");
}

export function confirmRestOfDay(day: LocalDate): void {
  if (!canEditLane(day, "actual")) {
    toast(laneError("actual"));
    return;
  }
  const changes = confirmRestOfDayChanges(day, blocks(), state().now, env);
  if (changes.length === 0) toast("Nothing left to confirm.");
  else commitChecked(changes, "Confirm rest of day");
}

export function copyPlanFrom(fromDay: LocalDate, toDay: LocalDate): void {
  if (!canEditLane(toDay, "plan")) {
    toast(laneError("plan"));
    return;
  }
  const changes = copyPlan(fromDay, toDay, blocks(), env);
  if (changes.length === 0) toast("That day has no plan to copy.");
  else commitChecked(changes, "Copy plan");
}

/**
 * Copies every day of `fromWeek` onto the same weekday of `toWeek`, in one undo step.
 * Locked and past target days are skipped (even if manually unlocked); a copied block
 * whose goal is archived as of `toWeek` has its goal cleared so `validateBlock` doesn't
 * reject the whole change.
 */
export function copyWeekPlan(fromWeek: LocalDate, toWeek: LocalDate): void {
  const now = state().now;
  const fromDays = weekDays(fromWeek);
  const toDays = weekDays(toWeek);
  const activeGoalIds = new Set(activeGoals(state().data, toWeek).map((g) => g.id));
  const all = blocks();
  const changes: ChangeSet = [];
  let eligibleDays = 0;
  for (let i = 0; i < 7; i++) {
    const toDay = toDays[i]!;
    if (toDay < now.day || isPlanLocked(toDay)) continue;
    eligibleDays++;
    for (const c of copyPlan(fromDays[i]!, toDay, all, env)) {
      if (c.op === "put" && c.table === "blocks" && c.row.goalId !== null && !activeGoalIds.has(c.row.goalId)) {
        changes.push(put("blocks", { ...c.row, goalId: null }));
      } else {
        changes.push(c);
      }
    }
  }
  if (eligibleDays === 0) {
    toast("No unlocked, upcoming days to copy into.");
    return;
  }
  if (changes.length === 0) toast("Last week has no plan to copy.");
  else commitChecked(changes, "Copy last week's plan");
}

// --- item-level helpers used by keyboard and menus -------------------------

export function intervalOfRef(ref: ItemRef): { start: number; end: number } | null {
  const b = blockById(ref.kind === "block" ? ref.id : ref.planBlockId);
  return b ? { start: b.startMinute, end: b.endMinute } : null;
}

/** Applies a patch to a block, or materializes a ghost with it. */
export function patchItem(ref: ItemRef, patch: BlockPatch, coalesceKey?: string): ItemRef | null {
  if (ref.kind === "block") return updateBlockFields(ref.id, patch, coalesceKey) ? ref : null;
  const id = materialize(ref.planBlockId, patch, coalesceKey);
  return id ? { kind: "block", id } : null;
}

export function setGoal(ref: ItemRef, goalId: string | null): ItemRef | null {
  return patchItem(ref, { goalId });
}

export function nudge(ref: ItemRef, delta: number): void {
  const iv = intervalOfRef(ref);
  if (!iv) return;
  const next = nudgeInterval(iv, delta);
  if (next.start !== iv.start || next.end !== iv.end) patchItem(ref, { startMinute: next.start, endMinute: next.end });
}

export function resizeItemBy(ref: ItemRef, delta: number): void {
  const iv = intervalOfRef(ref);
  if (!iv) return;
  const step = state().settings.snapMinutes;
  const next = resizeBy(iv, delta, step);
  if (next.end !== iv.end) patchItem(ref, { endMinute: next.end });
}

/** Delete key: deletes blocks, skips ghosts. */
export function deleteItem(ref: ItemRef): void {
  if (ref.kind === "ghost") skip(ref.planBlockId);
  else removeBlock(ref.id);
}

export function undo(): void {
  closeEditor();
  const label = storeUndo();
  if (label) toast(`Undid: ${label}`, { duration: 1500 });
}

export function redo(): void {
  closeEditor();
  const label = storeRedo();
  if (label) toast(`Redid: ${label}`, { duration: 1500 });
}
