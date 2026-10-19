import { describe, expect, it } from "vitest";
import type { Block, Now } from "../types";
import { biggestGaps } from "./gaps";

const now: Now = { day: "2026-10-19", minute: 600 };

const block = (id: string, extra: Partial<Block> = {}): Block => ({
  id,
  day: "2026-10-18",
  layer: "plan",
  startMinute: 540,
  endMinute: 600,
  title: id,
  goalId: null,
  notes: "",
  planBlockId: null,
  skipped: false,
  routineId: null,
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

describe("biggestGaps", () => {
  it("is empty with nothing unplanned or unconfirmed", () => {
    const plan = block("p1");
    const actual = block("a1", { layer: "actual", planBlockId: "p1" });
    expect(biggestGaps([plan, actual], now)).toEqual([]);
  });

  it("finds unplanned actual blocks", () => {
    const unplanned = block("a1", { layer: "actual", startMinute: 540, endMinute: 630 });
    const gaps = biggestGaps([unplanned], now);
    expect(gaps).toEqual([{ day: "2026-10-18", startMinute: 540, endMinute: 630, minutes: 90, kind: "unplanned", title: "a1", goalId: null }]);
  });

  it("finds past unconfirmed ghosts but not future ones", () => {
    const pastPlan = block("p1", { day: "2026-10-18", startMinute: 540, endMinute: 600 });
    const futurePlan = block("p2", { day: "2026-10-19", startMinute: 700, endMinute: 760 }); // after now.minute
    const gaps = biggestGaps([pastPlan, futurePlan], now);
    expect(gaps).toEqual([expect.objectContaining({ day: "2026-10-18", kind: "unconfirmed", minutes: 60 })]);
  });

  it("sorts longest first and respects the limit", () => {
    const a = block("a1", { layer: "actual", startMinute: 0, endMinute: 30 }); // 30m
    const b = block("a2", { layer: "actual", startMinute: 100, endMinute: 220 }); // 120m
    const c = block("a3", { layer: "actual", startMinute: 300, endMinute: 360 }); // 60m
    const gaps = biggestGaps([a, b, c], now, 2);
    expect(gaps.map((g) => g.minutes)).toEqual([120, 60]);
  });
});
