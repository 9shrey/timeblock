import { describe, expect, it } from "vitest";
import type { Interval } from "@/domain/blocks/intervals";
import { draftOf, IDLE, reduce, type DragCtx, type DragEvent, type DragState, type ItemRef } from "./dragMachine";
import type { ColumnSpec } from "./geometry";

const col = (day: string, layer: "plan" | "actual", extra: Partial<ColumnSpec> = {}): ColumnSpec => ({
  key: `${day}:${layer}`,
  day,
  layer,
  readOnly: false,
  locked: false,
  showGhosts: layer === "actual",
  ...extra,
});

const items: Record<string, Interval> = {
  b1: { start: 540, end: 660 }, // plan 9–11 in col 0
  g1: { start: 600, end: 720 }, // ghost 10–12 in col 1
};

const ctx: DragCtx = {
  columns: [
    col("2026-10-21", "plan"),
    col("2026-10-21", "actual"),
    col("2026-10-22", "plan"),
    col("2026-10-22", "actual", { readOnly: true }),
    col("2026-10-20", "plan", { locked: true }),
  ],
  snap: 15,
  intervalOf: (ref: ItemRef) => items[ref.kind === "block" ? ref.id : ref.planBlockId] ?? null,
};

const move = (minute: number, extra: Partial<Extract<DragEvent, { type: "move" }>> = {}): DragEvent => ({
  type: "move",
  x: 100,
  y: 100,
  minute,
  col: null,
  shift: false,
  ctrl: false,
  ...extra,
});

function run(events: DragEvent[]) {
  let state: DragState = IDLE;
  const effects = [];
  for (const e of events) {
    const step = reduce(state, e, ctx);
    state = step.state;
    if (step.effect) effects.push(step.effect);
  }
  return { state, effects };
}

const down = (target: Extract<DragEvent, { type: "down" }>["target"], minute: number): DragEvent => ({
  type: "down",
  target,
  x: 0,
  y: 0,
  minute,
});

describe("dragMachine", () => {
  it("below the 4px threshold a press is a click", () => {
    const { effects, state } = run([
      down({ type: "item", ref: { kind: "block", id: "b1" }, col: 0 }, 560),
      move(565, { x: 2, y: 2 }),
      { type: "up", ctrl: false },
    ]);
    expect(state).toEqual(IDLE);
    expect(effects).toEqual([{ type: "click", target: { type: "item", ref: { kind: "block", id: "b1" }, col: 0 } }]);
  });

  it("drag-create snaps both ends, either direction", () => {
    expect(run([down({ type: "empty", col: 0 }, 602), move(668), { type: "up", ctrl: false }]).effects).toEqual([
      { type: "create", col: 0, start: 600, end: 675 },
    ]);
    expect(run([down({ type: "empty", col: 0 }, 602), move(530), { type: "up", ctrl: false }]).effects).toEqual([
      { type: "create", col: 0, start: 525, end: 600 },
    ]);
  });

  it("Shift snaps to 5 minutes", () => {
    const { effects } = run([down({ type: "empty", col: 0 }, 600), move(623, { shift: true }), { type: "up", ctrl: false }]);
    expect(effects).toEqual([{ type: "create", col: 0, start: 600, end: 625 }]);
  });

  it("move keeps the grab offset and clamps to the day", () => {
    const grab = down({ type: "item", ref: { kind: "block", id: "b1" }, col: 0 }, 570); // 30 min into the block
    expect(run([grab, move(700), { type: "up", ctrl: false }]).effects).toEqual([
      { type: "move", id: "b1", col: 0, start: 675, end: 795, copy: false },
    ]);
    expect(run([grab, move(1430), { type: "up", ctrl: false }]).effects).toEqual([
      { type: "move", id: "b1", col: 0, start: 1320, end: 1440, copy: false },
    ]);
    expect(run([grab, move(-50), { type: "up", ctrl: false }]).effects[0]).toMatchObject({ start: 0, end: 120 });
  });

  it("moves across days within a layer; rejects other layers, read-only and locked columns", () => {
    const grab = down({ type: "item", ref: { kind: "block", id: "b1" }, col: 0 }, 540);
    expect(run([grab, move(600, { col: 2 }), { type: "up", ctrl: false }]).effects[0]).toMatchObject({ col: 2 });
    expect(run([grab, move(600, { col: 1 }), { type: "up", ctrl: false }]).effects[0]).toMatchObject({ col: 0 });
    expect(run([grab, move(600, { col: 4 }), { type: "up", ctrl: false }]).effects[0]).toMatchObject({ col: 0 });
  });

  it("Ctrl at drop copies", () => {
    const { effects } = run([
      down({ type: "item", ref: { kind: "block", id: "b1" }, col: 0 }, 540),
      move(600, { ctrl: true }),
      { type: "up", ctrl: true },
    ]);
    expect(effects[0]).toMatchObject({ type: "move", copy: true });
  });

  it("Esc / pointercancel cancels without an effect", () => {
    const { effects, state } = run([down({ type: "empty", col: 0 }, 600), move(700), { type: "cancel" }]);
    expect(state).toEqual(IDLE);
    expect(effects).toEqual([]);
  });

  it("resize clamps, and an edge press without movement is a click", () => {
    const edge = down({ type: "edge", ref: { kind: "block", id: "b1" }, edge: "end", col: 0 }, 660);
    expect(run([edge, move(1500), { type: "up", ctrl: false }]).effects).toEqual([
      { type: "resize", id: "b1", start: 540, end: 1440 },
    ]);
    expect(run([edge, move(500), { type: "up", ctrl: false }]).effects).toEqual([
      { type: "resize", id: "b1", start: 540, end: 555 },
    ]);
    // A press on an edge without movement selects.
    expect(run([edge, { type: "up", ctrl: false }]).effects[0]).toMatchObject({ type: "click" });
  });

  it("dragging or resizing a ghost materializes it, within its own column", () => {
    const ghost = { kind: "ghost", planBlockId: "g1" } as const;
    expect(run([down({ type: "item", ref: ghost, col: 1 }, 600), move(660, { col: 3 }), { type: "up", ctrl: true }]).effects).toEqual([
      { type: "materialize", planBlockId: "g1", start: 660, end: 780 },
    ]);
    expect(
      run([down({ type: "edge", ref: ghost, edge: "start", col: 1 }, 600), move(630), { type: "up", ctrl: false }])
        .effects,
    ).toEqual([{ type: "materialize", planBlockId: "g1", start: 630, end: 720 }]);
  });

  it("drags starting in read-only or locked columns are blocked", () => {
    const r1 = run([down({ type: "empty", col: 3 }, 600), move(700), { type: "up", ctrl: false }]);
    expect(r1.effects).toEqual([{ type: "blocked", col: 3 }]);
    const r2 = run([down({ type: "edge", ref: { kind: "block", id: "b1" }, edge: "end", col: 4 }, 660), move(700)]);
    expect(r2.effects).toEqual([{ type: "blocked", col: 4 }]);
    // Clicks still work there (selection).
    expect(run([down({ type: "empty", col: 3 }, 600), { type: "up", ctrl: false }]).effects[0]).toMatchObject({
      type: "click",
    });
  });

  it("exposes the draft while active", () => {
    const { state } = run([down({ type: "empty", col: 0 }, 600), move(700)]);
    expect(draftOf(state)).toMatchObject({ op: "create", start: 600, end: 705 });
  });

  it("an unchanged drop is a no-op", () => {
    const { effects } = run([
      down({ type: "item", ref: { kind: "block", id: "b1" }, col: 0 }, 545),
      move(560),
      move(545),
      { type: "up", ctrl: false },
    ]);
    expect(effects).toEqual([]);
  });
});
