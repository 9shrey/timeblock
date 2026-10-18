/**
 * Pure pointer state machine for the timeline:
 *
 *   idle ─down(empty)→ pending:create │ down(block|ghost)→ pending:move │ down(edge)→ pending:resize
 *   pending ─move ≥ 4px→ active │ up→ click
 *   active ─move→ draft (snap: Shift = 5 min, else settings; clamp; target column; Ctrl = copy)
 *          ─cancel→ idle (no write) │ up→ effect (create | move | resize | materialize)
 *
 * The component feeds it events with pre-computed minutes and column indices and executes
 * the returned effect; the reducer itself never touches the DOM or the store.
 */
import { createInterval, resizeInterval, snap } from "@/domain/blocks/edit";
import type { Interval } from "@/domain/blocks/intervals";
import { DRAG_THRESHOLD_PX, FINE_SNAP, isEditable, type ColumnSpec } from "./geometry";

export type ItemRef = { kind: "block"; id: string } | { kind: "ghost"; planBlockId: string };

export type DragTarget =
  | { type: "empty"; col: number }
  | { type: "item"; ref: ItemRef; col: number }
  | { type: "edge"; ref: ItemRef; edge: "start" | "end"; col: number };

export interface DragCtx {
  columns: readonly ColumnSpec[];
  /** Snap step from settings. */
  snap: number;
  /** Current interval of a block or ghost. */
  intervalOf(ref: ItemRef): Interval | null;
}

export type DraftOp = "create" | "move" | "resize";

export interface Draft {
  op: DraftOp;
  col: number;
  start: number;
  end: number;
  copy: boolean;
  ref: ItemRef | null;
}

export type DragState =
  | { kind: "idle" }
  | { kind: "pending"; target: DragTarget; x: number; y: number; minute: number; grabOffset: number }
  | { kind: "active"; target: DragTarget; anchor: number; grabOffset: number; draft: Draft }
  /** A drag that started where editing is not allowed; swallowed until release. */
  | { kind: "blocked" };

export type DragEvent =
  | { type: "down"; target: DragTarget; x: number; y: number; minute: number }
  | { type: "move"; x: number; y: number; minute: number; col: number | null; shift: boolean; ctrl: boolean }
  | { type: "up"; ctrl: boolean }
  | { type: "cancel" };

export type DragEffect =
  | { type: "click"; target: DragTarget }
  | { type: "blocked"; col: number }
  | { type: "create"; col: number; start: number; end: number }
  | { type: "move"; id: string; col: number; start: number; end: number; copy: boolean }
  | { type: "resize"; id: string; start: number; end: number }
  | { type: "materialize"; planBlockId: string; start: number; end: number };

export interface Step {
  state: DragState;
  effect?: DragEffect;
}

export const IDLE: DragState = { kind: "idle" };

function startActive(target: DragTarget, anchor: number, grabOffset: number, ctx: DragCtx): Step {
  if (!isEditable(ctx.columns[target.col])) return { state: { kind: "blocked" }, effect: { type: "blocked", col: target.col } };
  const ref = target.type === "empty" ? null : target.ref;
  const iv = ref ? ctx.intervalOf(ref) : { start: anchor, end: anchor };
  if (!iv) return { state: IDLE };
  const op: DraftOp = target.type === "empty" ? "create" : target.type === "edge" ? "resize" : "move";
  return {
    state: { kind: "active", target, anchor, grabOffset, draft: { op, col: target.col, ...iv, copy: false, ref } },
  };
}

/** Column the draft may move to: same layer and editable; ghosts stay in their own column. */
function acceptColumn(target: DragTarget, col: number | null, current: number, ctx: DragCtx): number {
  if (col === null || col === current) return current;
  if (target.type !== "item") return current; // creates and resizes stay in their column
  if (target.ref.kind === "ghost") return current;
  const from = ctx.columns[target.col];
  const to = ctx.columns[col];
  return to && from && to.layer === from.layer && isEditable(to) ? col : current;
}

function recompute(
  s: Extract<DragState, { kind: "active" }>,
  e: Extract<DragEvent, { type: "move" }>,
  ctx: DragCtx,
): Draft {
  const step = e.shift ? FINE_SNAP : ctx.snap;
  const { target, draft } = s;
  if (target.type === "empty") {
    return { ...draft, ...createInterval(s.anchor, e.minute, step) };
  }
  const iv = ctx.intervalOf(target.ref);
  if (!iv) return draft;
  if (target.type === "edge") {
    // Short pieces (e.g. 5 min from a confirm) may be shorter than a snap step.
    return { ...draft, ...resizeInterval(iv, target.edge, e.minute, step, Math.min(step, iv.end - iv.start)) };
  }
  const len = iv.end - iv.start;
  const start = Math.min(1440 - len, Math.max(0, snap(e.minute - s.grabOffset, step)));
  const col = acceptColumn(target, e.col, draft.col, ctx);
  const copy = e.ctrl && target.ref.kind === "block";
  return { ...draft, col, start, end: start + len, copy };
}

function commitEffect(s: Extract<DragState, { kind: "active" }>, ctrl: boolean, ctx: DragCtx): DragEffect | undefined {
  const { draft, target } = s;
  if (target.type === "empty") return { type: "create", col: draft.col, start: draft.start, end: draft.end };
  const iv = ctx.intervalOf(target.ref);
  if (!iv) return undefined;
  const copy = ctrl && target.ref.kind === "block";
  const unchanged = draft.start === iv.start && draft.end === iv.end && draft.col === target.col;
  if (unchanged && !copy) {
    // A press on a resize edge without movement is a click on the item.
    return target.type === "edge" ? { type: "click", target: { type: "item", ref: target.ref, col: target.col } } : undefined;
  }
  if (target.ref.kind === "ghost") {
    return { type: "materialize", planBlockId: target.ref.planBlockId, start: draft.start, end: draft.end };
  }
  if (target.type === "edge") return { type: "resize", id: target.ref.id, start: draft.start, end: draft.end };
  return { type: "move", id: target.ref.id, col: draft.col, start: draft.start, end: draft.end, copy };
}

export function reduce(state: DragState, e: DragEvent, ctx: DragCtx): Step {
  switch (e.type) {
    case "down": {
      if (state.kind !== "idle") return { state };
      const iv = e.target.type === "item" ? ctx.intervalOf(e.target.ref) : null;
      const grabOffset = iv && e.target.type === "item" ? e.minute - iv.start : 0;
      return { state: { kind: "pending", target: e.target, x: e.x, y: e.y, minute: e.minute, grabOffset } };
    }
    case "move": {
      if (state.kind === "pending") {
        if (Math.hypot(e.x - state.x, e.y - state.y) < DRAG_THRESHOLD_PX) return { state };
        const started = startActive(state.target, state.minute, state.grabOffset, ctx);
        if (started.state.kind !== "active") return started;
        return { state: { ...started.state, draft: recompute(started.state, e, ctx) } };
      }
      if (state.kind === "active") return { state: { ...state, draft: recompute(state, e, ctx) } };
      return { state };
    }
    case "up": {
      if (state.kind === "pending") {
        const t = state.target;
        // A press on a resize edge without movement is a click on the item.
        return { state: IDLE, effect: { type: "click", target: t.type === "edge" ? { type: "item", ref: t.ref, col: t.col } : t } };
      }
      if (state.kind === "active") return { state: IDLE, effect: commitEffect(state, e.ctrl, ctx) };
      return { state: IDLE };
    }
    case "cancel":
      return { state: IDLE };
  }
}

/** The draft to render, if any. */
export const draftOf = (s: DragState): Draft | null => (s.kind === "active" ? s.draft : null);
