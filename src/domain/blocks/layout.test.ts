import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { layoutLanes } from "./layout";

const item = (id: string, startMinute: number, endMinute: number) => ({ id, startMinute, endMinute });

describe("layoutLanes", () => {
  it("9-11, 10-12, 11-13 get lanes 0/1/0 with 2 lanes", () => {
    const m = layoutLanes([item("a", 540, 660), item("b", 600, 720), item("c", 660, 780)]);
    expect(m.get("a")).toEqual({ lane: 0, lanes: 2 });
    expect(m.get("b")).toEqual({ lane: 1, lanes: 2 });
    expect(m.get("c")).toEqual({ lane: 0, lanes: 2 });
  });

  it("touching blocks are separate single-lane clusters", () => {
    const m = layoutLanes([item("a", 540, 600), item("b", 600, 660)]);
    expect(m.get("a")).toEqual({ lane: 0, lanes: 1 });
    expect(m.get("b")).toEqual({ lane: 0, lanes: 1 });
  });

  it("puts the longest block first on equal starts", () => {
    const m = layoutLanes([item("short", 540, 570), item("long", 540, 720)]);
    expect(m.get("long")).toEqual({ lane: 0, lanes: 2 });
    expect(m.get("short")).toEqual({ lane: 1, lanes: 2 });
  });

  it("clusters are independent", () => {
    const m = layoutLanes([item("a", 0, 60), item("b", 30, 90), item("c", 30, 90), item("d", 600, 660)]);
    expect(m.get("a")?.lanes).toBe(3);
    expect(m.get("d")).toEqual({ lane: 0, lanes: 1 });
  });

  it("empty input gives an empty map", () => {
    expect(layoutLanes([]).size).toBe(0);
  });

  it("overlapping items never share a lane, and lane < lanes", () => {
    const arbItems = fc
      .array(
        fc
          .tuple(fc.integer({ min: 0, max: 1439 }), fc.integer({ min: 1, max: 300 }))
          .map(([s, l]) => ({ startMinute: s, endMinute: Math.min(1440, s + l) })),
        { maxLength: 15 },
      )
      .map((list) => list.map((x, i) => ({ id: `b${i}`, ...x })));
    fc.assert(
      fc.property(arbItems, (items) => {
        const m = layoutLanes(items);
        expect(m.size).toBe(items.length);
        for (const a of items) {
          const sa = m.get(a.id)!;
          expect(sa.lane).toBeGreaterThanOrEqual(0);
          expect(sa.lane).toBeLessThan(sa.lanes);
          for (const b of items) {
            if (a === b) continue;
            const sb = m.get(b.id)!;
            if (a.startMinute < b.endMinute && b.startMinute < a.endMinute) {
              expect(sa.lane).not.toBe(sb.lane);
              expect(sa.lanes).toBe(sb.lanes);
            }
          }
        }
      }),
    );
  });
});
