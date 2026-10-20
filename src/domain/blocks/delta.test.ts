import { describe, expect, it } from "vitest";
import type { Block, Goal } from "../types";
import { blockDelta, formatBlockDelta } from "./delta";

const block = (id: string, extra: Partial<Block> = {}): Block => ({
  id,
  day: "2026-10-19",
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

const goal = (id: string, name: string): Goal => ({
  id,
  name,
  color: "#3b82f6",
  kind: "min",
  trackBy: "time",
  sortOrder: 0,
  archivedOn: null,
  createdAt: 1,
  updatedAt: 1,
});

describe("blockDelta", () => {
  it("is null for an exact realisation", () => {
    const plan = block("p", { layer: "plan" });
    const actual = block("a", { planBlockId: "p" });
    expect(blockDelta(actual, plan)).toBeNull();
  });

  it("reports a positive drift as late", () => {
    const plan = block("p", { layer: "plan", startMinute: 540 });
    const actual = block("a", { planBlockId: "p", startMinute: 555 });
    const delta = blockDelta(actual, plan);
    expect(delta).toEqual({ startDriftMinutes: 15, goalChanged: false });
    expect(formatBlockDelta(delta!, null)).toBe("+15m late");
  });

  it("reports a negative drift without the 'late' suffix", () => {
    const plan = block("p", { layer: "plan", startMinute: 540 });
    const actual = block("a", { planBlockId: "p", startMinute: 510 });
    const delta = blockDelta(actual, plan);
    expect(delta!.startDriftMinutes).toBe(-30);
    expect(formatBlockDelta(delta!, null)).toBe("−30m");
  });

  it("reports a goal change with the actual's new goal name", () => {
    const plan = block("p", { layer: "plan", goalId: "g1" });
    const actual = block("a", { planBlockId: "p", goalId: "g2" });
    const delta = blockDelta(actual, plan);
    expect(delta).toEqual({ startDriftMinutes: 0, goalChanged: true });
    expect(formatBlockDelta(delta!, goal("g2", "Admin"))).toBe("goal: Admin");
  });

  it("joins drift and goal change", () => {
    const plan = block("p", { layer: "plan", startMinute: 540, goalId: "g1" });
    const actual = block("a", { planBlockId: "p", startMinute: 555, goalId: "g2" });
    const delta = blockDelta(actual, plan);
    expect(formatBlockDelta(delta!, goal("g2", "Admin"))).toBe("+15m late · goal: Admin");
  });
});
