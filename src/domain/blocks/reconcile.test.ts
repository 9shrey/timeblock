import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { applyChanges, invertChanges, stateFrom } from "../changes";
import { testEnv } from "../env";
import type { Block, ChangeSet, DataState, Now } from "../types";
import { overlaps } from "./intervals";
import {
  confirmGhost,
  confirmRestOfDay,
  copyPlan,
  createBlock,
  deleteBlock,
  ghostsOf,
  isActualReadOnly,
  materializeGhost,
  moveBlock,
  planState,
  planStates,
  rescheduleSkipped,
  restorePlan,
  skipPlan,
  splitAtMidnight,
  updateBlock,
} from "./reconcile";

const DAY = "2026-10-19";
const NEXT = "2026-10-20";
const T0 = 1_000;

function blk(
  id: string,
  layer: Block["layer"],
  start: number,
  end: number,
  extra: Partial<Block> = {},
): Block {
  return {
    id,
    day: DAY,
    layer,
    startMinute: start,
    endMinute: end,
    title: id,
    goalId: null,
    notes: "",
    planBlockId: null,
    skipped: false,
    routineId: null,
    createdAt: T0,
    updatedAt: T0,
    ...extra,
  };
}

const plan = (
  id: string,
  start: number,
  end: number,
  extra: Partial<Block> = {},
) => blk(id, "plan", start, end, extra);
const actual = (
  id: string,
  start: number,
  end: number,
  extra: Partial<Block> = {},
) => blk(id, "actual", start, end, extra);

function run(
  blocks: Block[],
  changes: ChangeSet,
): { state: DataState; all: Block[] } {
  const state = applyChanges(stateFrom({ blocks }), changes);
  return { state, all: Object.values(state.blocks) };
}

const linkedTo = (all: Block[], planId: string) =>
  all
    .filter((b) => b.planBlockId === planId)
    .sort((a, b) => a.startMinute - b.startMinute);
const span = (b: Block) => [b.startMinute, b.endMinute];

describe("createBlock / updateBlock", () => {
  it("fills defaults and timestamps from env", () => {
    const env = testEnv(5_000);
    const { block, changes } = createBlock(
      {
        day: DAY,
        layer: "plan",
        startMinute: 60,
        endMinute: 120,
        planBlockId: "x",
      },
      env,
    );
    expect(block).toMatchObject({
      id: "id1",
      title: "",
      goalId: null,
      notes: "",
      planBlockId: null,
      skipped: false,
      routineId: null,
    });
    expect(block.createdAt).toBe(5_000);
    expect(changes).toEqual([{ op: "put", table: "blocks", row: block }]);
  });

  it("updates fields and updatedAt without mutating the input", () => {
    const p = plan("p", 540, 600);
    const [c] = updateBlock(
      p,
      { title: "Deep work", endMinute: 660 },
      testEnv(9_000),
    );
    expect(c).toMatchObject({
      op: "put",
      row: {
        title: "Deep work",
        endMinute: 660,
        updatedAt: 9_000,
        createdAt: T0,
      },
    });
    expect(p.title).toBe("p");
  });
});

describe("confirmGhost", () => {
  it("splits around an existing unplanned actual", () => {
    const p = plan("p", 540, 660, { goalId: "g", notes: "n" });
    const blocks = [p, actual("a", 600, 630)];
    const { all } = run(blocks, confirmGhost(p, blocks, testEnv()));
    const pieces = linkedTo(all, "p");
    expect(pieces.map(span)).toEqual([
      [540, 600],
      [630, 660],
    ]);
    for (const b of pieces)
      expect(b).toMatchObject({
        layer: "actual",
        day: DAY,
        title: "p",
        goalId: "g",
        notes: "n",
      });
    expect(ghostsOf(all)).toEqual([]);
  });

  it("also subtracts linked actuals of other plans and ignores other days", () => {
    const p = plan("p", 540, 660);
    const blocks = [
      p,
      actual("a", 500, 560, { planBlockId: "q" }),
      actual("b", 540, 660, { day: NEXT }),
    ];
    const { all } = run(blocks, confirmGhost(p, blocks, testEnv()));
    expect(linkedTo(all, "p").map(span)).toEqual([[560, 660]]);
  });

  it("drops pieces shorter than 5 minutes", () => {
    const p = plan("p", 540, 660);
    const blocks = [p, actual("a", 544, 656)];
    const { all } = run(blocks, confirmGhost(p, blocks, testEnv()));
    expect(linkedTo(all, "p")).toEqual([]);
    expect(all.find((b) => b.id === "p")!.skipped).toBe(true);

    const blocks2 = [p, actual("a", 545, 660)];
    expect(
      linkedTo(run(blocks2, confirmGhost(p, blocks2, testEnv())).all, "p").map(
        span,
      ),
    ).toEqual([[540, 545]]);
  });

  it("marks the plan skipped when fully covered", () => {
    const p = plan("p", 540, 660);
    const blocks = [p, actual("a", 500, 600), actual("b", 600, 700)];
    const changes = confirmGhost(p, blocks, testEnv(7_000));
    expect(changes).toHaveLength(1);
    const { all } = run(blocks, changes);
    expect(all.find((b) => b.id === "p")).toMatchObject({
      skipped: true,
      updatedAt: 7_000,
    });
  });

  it("is a no-op for a plan that is not a ghost", () => {
    const p = plan("p", 540, 660);
    expect(
      confirmGhost(p, [p, actual("a", 0, 30, { planBlockId: "p" })], testEnv()),
    ).toEqual([]);
    const s = plan("s", 540, 660, { skipped: true });
    expect(confirmGhost(s, [s], testEnv())).toEqual([]);
  });

  it("property: pieces are linked, inside the plan, >= 5 min and never overlap other actuals", () => {
    const arbIv = fc
      .tuple(
        fc.integer({ min: 0, max: 1439 }),
        fc.integer({ min: 1, max: 300 }),
      )
      .map(([s, l]) => [s, Math.min(1440, s + l)] as const);
    fc.assert(
      fc.property(
        arbIv,
        fc.array(arbIv, { maxLength: 8 }),
        ([ps, pe], acts) => {
          const p = plan("p", ps, pe);
          const blocks = [p, ...acts.map(([s, e], i) => actual(`a${i}`, s, e))];
          const changes = confirmGhost(p, blocks, testEnv());
          const { state, all } = run(blocks, changes);
          const pieces = linkedTo(all, "p");
          const others = all.filter(
            (b) => b.layer === "actual" && b.planBlockId !== "p",
          );
          for (const x of pieces) {
            expect(x.endMinute - x.startMinute).toBeGreaterThanOrEqual(5);
            expect(x.startMinute).toBeGreaterThanOrEqual(ps);
            expect(x.endMinute).toBeLessThanOrEqual(pe);
            for (const o of others)
              expect(
                overlaps(
                  { start: x.startMinute, end: x.endMinute },
                  { start: o.startMinute, end: o.endMinute },
                ),
              ).toBe(false);
          }
          expect(pieces.length > 0 || state.blocks["p"]!.skipped).toBe(true);
          expect(
            applyChanges(state, invertChanges(stateFrom({ blocks }), changes)),
          ).toEqual(stateFrom({ blocks }));
        },
      ),
    );
  });
});

describe("materializeGhost", () => {
  it("creates one linked actual with the patch applied", () => {
    const p = plan("p", 540, 660, { goalId: "g" });
    const { block, changes } = materializeGhost(
      p,
      { startMinute: 570, goalId: null },
      testEnv(),
    );
    expect(changes).toHaveLength(1);
    expect(block).toMatchObject({
      layer: "actual",
      planBlockId: "p",
      startMinute: 570,
      endMinute: 660,
      goalId: null,
      title: "p",
    });
  });
});

describe("skipPlan / restorePlan", () => {
  it("sets and clears the flag", () => {
    const p = plan("p", 540, 660);
    const { all } = run([p], skipPlan(p, testEnv()));
    const skipped = all[0]!;
    expect(skipped.skipped).toBe(true);
    expect(ghostsOf(all)).toEqual([]);
    expect(skipPlan(skipped, testEnv())).toEqual([]);
    const restored = run(all, restorePlan(skipped, testEnv()));
    expect(restored.all[0]!.skipped).toBe(false);
    expect(ghostsOf(restored.all)).toHaveLength(1);
    expect(restorePlan(p, testEnv())).toEqual([]);
  });
});

describe("deleteBlock", () => {
  it("deleting the last linked actual marks the plan skipped", () => {
    const p = plan("p", 540, 660);
    const a = actual("a", 540, 660, { planBlockId: "p" });
    const { state, all } = run([p, a], deleteBlock(a, [p, a], testEnv()));
    expect(state.blocks["a"]).toBeUndefined();
    expect(state.blocks["p"]!.skipped).toBe(true);
    expect(ghostsOf(all)).toEqual([]);
  });

  it("deleting one of two links does not skip", () => {
    const p = plan("p", 540, 660);
    const a = actual("a", 540, 600, { planBlockId: "p" });
    const b = actual("b", 600, 660, { planBlockId: "p" });
    const changes = deleteBlock(a, [p, a, b], testEnv());
    expect(changes).toEqual([{ op: "del", table: "blocks", key: "a" }]);
  });

  it("deleting an unplanned actual only deletes it", () => {
    const a = actual("a", 540, 600);
    expect(deleteBlock(a, [a], testEnv())).toEqual([
      { op: "del", table: "blocks", key: "a" },
    ]);
  });

  it("deleting a plan block unlinks its actuals", () => {
    const p = plan("p", 540, 660);
    const a = actual("a", 540, 600, { planBlockId: "p" });
    const b = actual("b", 600, 660, { planBlockId: "p" });
    const { state } = run([p, a, b], deleteBlock(p, [p, a, b], testEnv(8_000)));
    expect(state.blocks["p"]).toBeUndefined();
    expect(state.blocks["a"]).toMatchObject({
      planBlockId: null,
      updatedAt: 8_000,
    });
    expect(state.blocks["b"]!.planBlockId).toBeNull();
  });
});

describe("moveBlock", () => {
  const p = plan("p", 540, 660);
  const a = actual("a", 540, 660, { planBlockId: "p" });

  it("same-day move keeps the link", () => {
    const { block, changes } = moveBlock(
      a,
      { day: DAY, startMinute: 600, endMinute: 720 },
      [p, a],
      testEnv(),
    );
    expect(block).toMatchObject({
      id: "a",
      planBlockId: "p",
      startMinute: 600,
      endMinute: 720,
    });
    expect(changes).toHaveLength(1);
    expect(planState(p, [block], { day: DAY, minute: 0 })).toBe("adjusted");
  });

  it("moving a plan block to another day unlinks its actuals", () => {
    const { block, changes } = moveBlock(
      p,
      { day: NEXT, startMinute: 540, endMinute: 660 },
      [p, a],
      testEnv(),
    );
    expect(block).toMatchObject({ id: "p", day: NEXT });
    const { state } = run([p, a], changes);
    expect(state.blocks["a"]!.planBlockId).toBeNull();
    expect(state.blocks["p"]!.day).toBe(NEXT);
  });

  it("moving the last linked actual to another day unlinks it and skips the plan", () => {
    const { block, changes } = moveBlock(
      a,
      { day: NEXT, startMinute: 540, endMinute: 660 },
      [p, a],
      testEnv(),
    );
    expect(block).toMatchObject({ id: "a", day: NEXT, planBlockId: null });
    const { state } = run([p, a], changes);
    expect(state.blocks["p"]!.skipped).toBe(true);
  });

  it("moving one of two links to another day does not skip", () => {
    const b = actual("b", 400, 420, { planBlockId: "p" });
    const { changes } = moveBlock(
      a,
      { day: NEXT, startMinute: 540, endMinute: 660 },
      [p, a, b],
      testEnv(),
    );
    expect(changes).toHaveLength(1);
  });

  it("copy gets a new id, is unlinked and leaves the original untouched", () => {
    const { block, changes } = moveBlock(
      a,
      { day: DAY, startMinute: 700, endMinute: 760 },
      [p, a],
      testEnv(),
      { copy: true },
    );
    expect(block).toMatchObject({
      id: "id1",
      planBlockId: null,
      layer: "actual",
      title: "a",
      startMinute: 700,
    });
    const { state } = run([p, a], changes);
    expect(state.blocks["a"]).toEqual(a);

    const sp = plan("sp", 540, 600, { skipped: true });
    const copied = moveBlock(
      sp,
      { day: NEXT, startMinute: 540, endMinute: 600 },
      [sp],
      testEnv(),
      { copy: true },
    ).block;
    expect(copied).toMatchObject({ id: "id1", day: NEXT, skipped: false });
  });
});

describe("confirmRestOfDay", () => {
  it("confirms only past ghosts, in start order, as one ChangeSet", () => {
    const now: Now = { day: DAY, minute: 720 };
    const blocks = [
      plan("late", 700, 780), // ends after now: left alone
      plan("b", 600, 720), // overlaps a: gets only the remainder
      plan("a", 540, 660),
      plan("done", 300, 360),
      actual("x", 300, 360, { planBlockId: "done" }),
      plan("other", 540, 600, { day: NEXT }),
    ];
    const changes = confirmRestOfDay(DAY, blocks, now, testEnv());
    const { all } = run(blocks, changes);
    expect(linkedTo(all, "a").map(span)).toEqual([[540, 660]]);
    expect(linkedTo(all, "b").map(span)).toEqual([[660, 720]]);
    expect(linkedTo(all, "late")).toEqual([]);
    expect(linkedTo(all, "other")).toEqual([]);
    expect(changes).toHaveLength(2);
    expect(
      ghostsOf(all)
        .map((g) => g.planBlockId)
        .sort(),
    ).toEqual(["late", "other"]);
  });

  it("skips a later ghost fully covered by an earlier confirm", () => {
    const blocks = [plan("a", 540, 660), plan("b", 560, 600)];
    const { state } = run(
      blocks,
      confirmRestOfDay(DAY, blocks, { day: NEXT, minute: 0 }, testEnv()),
    );
    expect(state.blocks["b"]!.skipped).toBe(true);
    expect(state.blocks["a"]!.skipped).toBe(false);
  });
});

describe("copyPlan", () => {
  it("copies one day's plan blocks with new ids and skipped false", () => {
    const blocks = [
      plan("p2", 600, 660, { goalId: "g", notes: "n", skipped: true }),
      plan("p1", 540, 600),
      actual("a", 540, 600),
      plan("p3", 0, 60, { day: NEXT }),
    ];
    const { all } = run(blocks, copyPlan(DAY, NEXT, blocks, testEnv()));
    const copies = all
      .filter((b) => b.day === NEXT && b.id.startsWith("id"))
      .sort((x, y) => x.startMinute - y.startMinute);
    expect(
      copies.map((b) => [
        b.id,
        b.title,
        b.startMinute,
        b.goalId,
        b.notes,
        b.skipped,
      ]),
    ).toEqual([
      ["id1", "p1", 540, null, "", false],
      ["id2", "p2", 600, "g", "n", false],
    ]);
  });
});

describe("rescheduleSkipped", () => {
  it("copies skipped plan blocks across the given days onto one target day, unskipped and unlinked", () => {
    const blocks = [
      plan("p1", 540, 600, { skipped: true, goalId: "g", notes: "n" }),
      plan("p2", 600, 660, { day: NEXT, skipped: true }),
      plan("p3", 660, 720), // not skipped
      actual("a1", 540, 600, { skipped: false }),
    ];
    const { all } = run(blocks, rescheduleSkipped([DAY, NEXT], "2026-10-26", blocks, testEnv()));
    const copies = all.filter((b) => b.day === "2026-10-26").sort((x, y) => x.startMinute - y.startMinute);
    expect(copies.map((b) => [b.title, b.startMinute, b.goalId, b.notes, b.skipped, b.planBlockId])).toEqual([
      ["p1", 540, "g", "n", false, null],
      ["p2", 600, null, "", false, null],
    ]);
  });

  it("is empty when there's nothing skipped in range", () => {
    const blocks = [plan("p1", 540, 600)];
    expect(rescheduleSkipped([DAY], NEXT, blocks, testEnv())).toEqual([]);
  });
});

describe("planState / planStates", () => {
  it("covers every transition", () => {
    const p = plan("p", 540, 660, { goalId: "g" });
    const before: Now = { day: DAY, minute: 600 };
    const after: Now = { day: DAY, minute: 660 };
    expect(planState(p, [], before)).toBe("pending");
    expect(planState(p, [], after)).toBe("unconfirmed");
    expect(planState(p, [], { day: NEXT, minute: 0 })).toBe("unconfirmed");
    const exact = actual("a", 540, 660, { goalId: "g", planBlockId: "p" });
    expect(planState(p, [exact], after)).toBe("done");
    expect(planState(p, [{ ...exact, goalId: null }], after)).toBe("adjusted");
    expect(planState(p, [{ ...exact, endMinute: 650 }], after)).toBe(
      "adjusted",
    );
    expect(
      planState(
        p,
        [
          actual("a", 540, 600, { goalId: "g" }),
          actual("b", 600, 660, { goalId: "g" }),
        ],
        after,
      ),
    ).toBe("adjusted");
    expect(planState({ ...p, skipped: true }, [exact], after)).toBe("skipped");
  });

  it("maps every plan block through confirm/skip", () => {
    const env = testEnv();
    const now: Now = { day: DAY, minute: 720 };
    let blocks = [
      plan("a", 540, 600),
      plan("b", 600, 660),
      plan("c", 800, 900),
      actual("u", 0, 30),
    ];
    expect([...planStates(blocks, now)]).toEqual([
      ["a", "unconfirmed"],
      ["b", "unconfirmed"],
      ["c", "pending"],
    ]);
    blocks = run(blocks, confirmGhost(blocks[0]!, blocks, env)).all;
    blocks = run(
      blocks,
      skipPlan(
        blocks.find((b) => b.id === "b")!,
        env,
      ),
    ).all;
    const states = planStates(blocks, now);
    expect(states.get("a")).toBe("done");
    expect(states.get("b")).toBe("skipped");
    expect(states.get("c")).toBe("pending");
    expect(states.has("u")).toBe(false);
  });
});

describe("isActualReadOnly", () => {
  it("is true only for days after today", () => {
    const now: Now = { day: DAY, minute: 600 };
    expect(isActualReadOnly(NEXT, now)).toBe(true);
    expect(isActualReadOnly(DAY, now)).toBe(false);
    expect(isActualReadOnly("2026-10-18", now)).toBe(false);
  });
});

describe("splitAtMidnight", () => {
  it("trims the block to end at midnight and creates an unlinked continuation on the next day", () => {
    const p = blk("p", "plan", 1320, 1440, { title: "Deep sleep", goalId: "g", notes: "n" }); // 22:00-24:00, already at the boundary
    const { continuation, changes } = splitAtMidnight(p, 1320, 90, testEnv(9));
    const trimmed = (changes[0] as { row: Block }).row;
    expect(trimmed).toMatchObject({ id: "p", day: DAY, startMinute: 1320, endMinute: 1440, updatedAt: 9 });
    expect(continuation).toMatchObject({
      day: NEXT,
      layer: "plan",
      startMinute: 0,
      endMinute: 90,
      title: "Deep sleep",
      goalId: "g",
      notes: "n",
      planBlockId: null,
      skipped: false,
      routineId: null,
    });
    expect(changes).toHaveLength(2);
    expect(changes[1]).toEqual({ op: "put", table: "blocks", row: continuation });
  });

  it("applies the resize's start too (the far edge may have given way)", () => {
    const p = blk("p", "plan", 1430, 1440, {});
    const { changes } = splitAtMidnight(p, 1400, 30, testEnv());
    expect((changes[0] as { row: Block }).row.startMinute).toBe(1400);
  });

  it("clamps the continuation to [1, 1440]", () => {
    const p = blk("p", "actual", 1400, 1440, { planBlockId: "plan1" });
    expect(splitAtMidnight(p, 1400, 0, testEnv()).continuation.endMinute).toBe(1);
    expect(splitAtMidnight(p, 1400, 5000, testEnv()).continuation.endMinute).toBe(1440);
    // The continuation is a fresh, unlinked block even though the original was linked.
    expect(splitAtMidnight(p, 1400, 30, testEnv()).continuation.planBlockId).toBeNull();
  });
});
