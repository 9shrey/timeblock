import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  createInterval,
  minuteToPx,
  moveInterval,
  nudgeInterval,
  pxToMinute,
  resizeBy,
  resizeInterval,
  snap,
} from "./edit";

describe("snap", () => {
  it("rounds to the nearest step", () => {
    expect(snap(547, 15)).toBe(540);
    expect(snap(548, 15)).toBe(555);
    expect(snap(552, 5)).toBe(550);
    expect(snap(553, 5)).toBe(555);
  });

  it("clamps to [0, 1440]", () => {
    expect(snap(-20, 15)).toBe(0);
    expect(snap(1500, 15)).toBe(1440);
  });
});

describe("px conversion", () => {
  it("round-trips at 96 px/h", () => {
    expect(minuteToPx(90, 96)).toBe(144);
    expect(pxToMinute(144, 96)).toBe(90);
  });

  it("clamps", () => {
    expect(pxToMinute(-10, 96)).toBe(0);
    expect(pxToMinute(96 * 30, 96)).toBe(1440);
    expect(minuteToPx(2000, 96)).toBe(96 * 24);
  });
});

describe("moveInterval", () => {
  it("keeps length and snaps the start", () => {
    expect(moveInterval({ start: 540, end: 600 }, 22, 15)).toEqual({ start: 555, end: 615 });
  });

  it("clamps at 0", () => {
    expect(moveInterval({ start: 30, end: 90 }, -100, 15)).toEqual({ start: 0, end: 60 });
  });

  it("clamps at 1440", () => {
    expect(moveInterval({ start: 1380, end: 1430 }, 100, 15)).toEqual({ start: 1390, end: 1440 });
  });

  it("always stays within the day with the same length", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1439 }),
        fc.integer({ min: 1, max: 1440 }),
        fc.integer({ min: -3000, max: 3000 }),
        fc.constantFrom(5, 10, 15, 30),
        (s, l, d, step) => {
          const iv = { start: s, end: Math.min(1440, s + l) };
          const r = moveInterval(iv, d, step);
          expect(r.start).toBeGreaterThanOrEqual(0);
          expect(r.end).toBeLessThanOrEqual(1440);
          expect(r.end - r.start).toBe(iv.end - iv.start);
        },
      ),
    );
  });
});

describe("resizeInterval", () => {
  it("snaps the moved end edge", () => {
    expect(resizeInterval({ start: 540, end: 600 }, "end", 668, 15)).toEqual({ start: 540, end: 675 });
  });

  it("snaps the moved start edge", () => {
    expect(resizeInterval({ start: 540, end: 600 }, "start", 512, 15)).toEqual({ start: 510, end: 600 });
  });

  it("keeps at least minLength", () => {
    expect(resizeInterval({ start: 540, end: 600 }, "end", 400, 15)).toEqual({ start: 540, end: 555 });
    expect(resizeInterval({ start: 540, end: 600 }, "start", 700, 15, 30)).toEqual({ start: 570, end: 600 });
  });

  it("clamps at 0 and 1440", () => {
    expect(resizeInterval({ start: 540, end: 600 }, "start", -50, 15)).toEqual({ start: 0, end: 600 });
    expect(resizeInterval({ start: 540, end: 600 }, "end", 1600, 15)).toEqual({ start: 540, end: 1440 });
  });

  it("gives way at the day edge when there is no room for minLength", () => {
    expect(resizeInterval({ start: 1435, end: 1440 }, "end", 1440, 15)).toEqual({ start: 1425, end: 1440 });
    expect(resizeInterval({ start: 0, end: 5 }, "start", 0, 15)).toEqual({ start: 0, end: 15 });
  });
});

describe("createInterval", () => {
  it("drags forward", () => {
    expect(createInterval(541, 628, 15)).toEqual({ start: 540, end: 630 });
  });

  it("drags in reverse", () => {
    expect(createInterval(630, 541, 15)).toEqual({ start: 540, end: 630 });
  });

  it("a click grows to minLength away from the anchor", () => {
    expect(createInterval(540, 540, 15, 60)).toEqual({ start: 540, end: 600 });
    expect(createInterval(540, 535, 15, 60)).toEqual({ start: 480, end: 540 });
  });

  it("clamps at 0 and 1440", () => {
    expect(createInterval(1440, 1440, 15, 60)).toEqual({ start: 1380, end: 1440 });
    expect(createInterval(10, -40, 15, 60)).toEqual({ start: 0, end: 60 });
    expect(createInterval(1300, 2000, 15)).toEqual({ start: 1305, end: 1440 });
  });

  it("is always a valid interval of at least minLength", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100, max: 1600 }),
        fc.integer({ min: -100, max: 1600 }),
        fc.constantFrom(5, 10, 15, 30),
        (a, c, step) => {
          const r = createInterval(a, c, step);
          expect(r.start).toBeGreaterThanOrEqual(0);
          expect(r.end).toBeLessThanOrEqual(1440);
          expect(r.end - r.start).toBeGreaterThanOrEqual(step);
        },
      ),
    );
  });
});

describe("keyboard", () => {
  it("nudges keeping length, clamped", () => {
    expect(nudgeInterval({ start: 540, end: 600 }, 15)).toEqual({ start: 555, end: 615 });
    expect(nudgeInterval({ start: 5, end: 65 }, -15)).toEqual({ start: 0, end: 60 });
    expect(nudgeInterval({ start: 1380, end: 1435 }, 15)).toEqual({ start: 1385, end: 1440 });
  });

  it("resizes the end edge, clamped and at least minLength", () => {
    expect(resizeBy({ start: 540, end: 600 }, 15, 15)).toEqual({ start: 540, end: 615 });
    expect(resizeBy({ start: 540, end: 555 }, -15, 15)).toEqual({ start: 540, end: 555 });
    expect(resizeBy({ start: 1380, end: 1435 }, 15, 15)).toEqual({ start: 1380, end: 1440 });
  });
});
