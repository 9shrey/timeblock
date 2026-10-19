import { describe, expect, it } from "vitest";
import type { Block } from "../types";
import { heatmapLevel, heatmapMinutesByDay } from "./heatmap";

const block = (id: string, extra: Partial<Block> = {}): Block => ({
  id,
  day: "2026-10-18",
  layer: "actual",
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

describe("heatmapMinutesByDay", () => {
  it("ignores plan blocks and unions overlapping actuals per day", () => {
    const plan = block("p1", { layer: "plan" });
    const a1 = block("a1", { startMinute: 540, endMinute: 600 });
    const a2 = block("a2", { startMinute: 570, endMinute: 630 }); // overlaps a1 by 30m
    const map = heatmapMinutesByDay({ blocks: [plan, a1, a2], goalId: null });
    expect(map.get("2026-10-18")).toBe(90); // 540..630, not 120
  });

  it("filters by goal when given", () => {
    const g1 = block("a1", { goalId: "g1" });
    const g2 = block("a2", { goalId: "g2", day: "2026-10-18", startMinute: 700, endMinute: 760 });
    const map = heatmapMinutesByDay({ blocks: [g1, g2], goalId: "g1" });
    expect(map.get("2026-10-18")).toBe(60);
  });

  it("days with no matching time are absent", () => {
    expect(heatmapMinutesByDay({ blocks: [], goalId: null }).size).toBe(0);
  });
});

describe("heatmapLevel", () => {
  it("buckets minutes into 0..4", () => {
    expect(heatmapLevel(0)).toBe(0);
    expect(heatmapLevel(30)).toBe(1);
    expect(heatmapLevel(120)).toBe(2);
    expect(heatmapLevel(200)).toBe(3);
    expect(heatmapLevel(400)).toBe(4);
  });
});
