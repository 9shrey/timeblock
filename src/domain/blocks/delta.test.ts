import { describe, expect, it } from "vitest";
import { blockDelta } from "./delta";
import type { Block } from "../types";

const block = (over: Partial<Block> = {}): Block => ({
  id: "b",
  day: "2026-10-21",
  layer: "actual",
  startMinute: 540,
  endMinute: 600,
  title: "",
  goalId: "g1",
  notes: "",
  planBlockId: null,
  skipped: false,
  routineId: null,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

describe("blockDelta", () => {
  it("is null when the actual matches the plan exactly", () => {
    expect(blockDelta(block(), block({ layer: "plan" }))).toBeNull();
  });

  it("reports a positive drift when the actual started late", () => {
    const d = blockDelta(block({ startMinute: 555 }), block({ layer: "plan", startMinute: 540 }));
    expect(d).toEqual({ startDriftMinutes: 15, goalChanged: false });
  });

  it("reports a negative drift when the actual started early", () => {
    const d = blockDelta(block({ startMinute: 525 }), block({ layer: "plan", startMinute: 540 }));
    expect(d).toEqual({ startDriftMinutes: -15, goalChanged: false });
  });

  it("flags a changed goal independent of timing", () => {
    const d = blockDelta(block({ goalId: "g2" }), block({ layer: "plan", goalId: "g1" }));
    expect(d).toEqual({ startDriftMinutes: 0, goalChanged: true });
  });
});
