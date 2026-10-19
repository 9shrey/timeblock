import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { clip, intersect, merge, subtract, unionLength, type Interval } from "./intervals";

const arbInterval = fc
  .tuple(fc.integer({ min: 0, max: 1440 }), fc.integer({ min: 0, max: 1440 }))
  .map(([a, b]): Interval => ({ start: Math.min(a, b), end: Math.max(a, b) }));
const arbList = fc.array(arbInterval, { maxLength: 12 });
const len = (i: Interval) => Math.max(0, i.end - i.start);

describe("merge / unionLength", () => {
  it("merges overlapping and touching intervals", () => {
    expect(
      merge([
        { start: 600, end: 720 },
        { start: 540, end: 660 },
        { start: 720, end: 780 },
        { start: 900, end: 900 },
      ]),
    ).toEqual([{ start: 540, end: 780 }]);
  });

  it("9-11 plus 10-12 is 180 minutes", () => {
    expect(
      unionLength([
        { start: 540, end: 660 },
        { start: 600, end: 720 },
      ]),
    ).toBe(180);
  });

  it("unionLength <= sum of lengths", () => {
    fc.assert(
      fc.property(arbList, (list) => {
        expect(unionLength(list)).toBeLessThanOrEqual(list.reduce((s, i) => s + len(i), 0));
      }),
    );
  });

  it("merge output is sorted and disjoint", () => {
    fc.assert(
      fc.property(arbList, (list) => {
        const m = merge(list);
        for (let i = 1; i < m.length; i++) expect(m[i]!.start).toBeGreaterThan(m[i - 1]!.end);
      }),
    );
  });
});

describe("subtract", () => {
  it("splits around holes", () => {
    expect(subtract({ start: 540, end: 660 }, [{ start: 600, end: 630 }])).toEqual([
      { start: 540, end: 600 },
      { start: 630, end: 660 },
    ]);
    expect(subtract({ start: 540, end: 660 }, [{ start: 500, end: 700 }])).toEqual([]);
    expect(subtract({ start: 540, end: 660 }, [])).toEqual([{ start: 540, end: 660 }]);
  });

  it("subtract + intersection gives back the original", () => {
    fc.assert(
      fc.property(arbInterval, arbList, (a, bs) => {
        const rest = subtract(a, bs);
        const inter = intersect([a], bs);
        expect(unionLength(rest) + unionLength(inter)).toBe(len(a));
        expect(merge([...rest, ...inter])).toEqual(merge([a]));
        expect(intersect(rest, bs)).toEqual([]);
      }),
    );
  });
});

describe("clip", () => {
  it("clips or returns null", () => {
    expect(clip({ start: 0, end: 100 }, { start: 50, end: 200 })).toEqual({ start: 50, end: 100 });
    expect(clip({ start: 0, end: 50 }, { start: 50, end: 200 })).toBeNull();
  });
});
