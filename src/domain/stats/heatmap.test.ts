import { describe, expect, it } from "vitest";
import { dailyActualMinutes } from "./heatmap";
import type { Block } from "../types";

let seq = 0;
function block(p: Partial<Block> & Pick<Block, "day" | "startMinute" | "endMinute">): Block {
  return {
    id: `b${++seq}`,
    layer: "actual",
    title: "",
    goalId: "g1",
    notes: "",
    planBlockId: null,
    skipped: false,
    routineId: null,
    createdAt: 0,
    updatedAt: 0,
    ...p,
  };
}

describe("dailyActualMinutes", () => {
  it("sums actual time per day", () => {
    const out = dailyActualMinutes([block({ day: "2026-01-02", startMinute: 0, endMinute: 60 }), block({ day: "2026-01-02", startMinute: 120, endMinute: 150 })], "2026-01-01", "2026-01-31", null);
    expect(out["2026-01-02"]).toBe(90);
  });

  it("unions overlapping intervals instead of double-counting", () => {
    const out = dailyActualMinutes([block({ day: "2026-01-02", startMinute: 0, endMinute: 60 }), block({ day: "2026-01-02", startMinute: 30, endMinute: 90 })], "2026-01-01", "2026-01-31", null);
    expect(out["2026-01-02"]).toBe(90);
  });

  it("ignores plan blocks and days outside the range", () => {
    const out = dailyActualMinutes(
      [block({ day: "2026-01-02", startMinute: 0, endMinute: 60, layer: "plan" }), block({ day: "2026-02-01", startMinute: 0, endMinute: 60 })],
      "2026-01-01",
      "2026-01-31",
      null,
    );
    expect(out).toEqual({});
  });

  it("filters to one goal when given", () => {
    const out = dailyActualMinutes(
      [block({ day: "2026-01-02", startMinute: 0, endMinute: 60, goalId: "g1" }), block({ day: "2026-01-02", startMinute: 60, endMinute: 90, goalId: "g2" })],
      "2026-01-01",
      "2026-01-31",
      "g1",
    );
    expect(out["2026-01-02"]).toBe(60);
  });
});
