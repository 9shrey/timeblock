import { describe, expect, it } from "vitest";
import type { Block, Now } from "../types";
import { computeAccuracy, zeroAccuracy } from "./accuracy";

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

describe("computeAccuracy", () => {
  it("is all-zero / null for no blocks", () => {
    expect(computeAccuracy([], now)).toEqual(zeroAccuracy());
  });

  it("ignores plans whose time hasn't passed (pending)", () => {
    const plan = block("p", { day: "2026-10-19", startMinute: 700, endMinute: 760 }); // after `now.minute`
    expect(computeAccuracy([plan], now).countedPlans).toBe(0);
  });

  it("counts confirmed vs skipped past plans, and averages start drift over linked actuals", () => {
    const planDone = block("p1", { startMinute: 540, endMinute: 600 });
    const actualDone = block("a1", { layer: "actual", planBlockId: "p1", startMinute: 540, endMinute: 600 });
    const planLate = block("p2", { startMinute: 600, endMinute: 660 });
    const actualLate = block("a2", { layer: "actual", planBlockId: "p2", startMinute: 615, endMinute: 660 });
    const planSkipped = block("p3", { skipped: true });

    const stats = computeAccuracy([planDone, actualDone, planLate, actualLate, planSkipped], now);
    expect(stats.countedPlans).toBe(3);
    expect(stats.confirmedPct).toBeCloseTo((2 / 3) * 100);
    expect(stats.skippedPct).toBeCloseTo((1 / 3) * 100);
    expect(stats.avgStartDriftMinutes).toBeCloseTo((0 + 15) / 2);
  });

  it("computes unplanned % of total actual minutes", () => {
    const planned = block("p1");
    const linkedActual = block("a1", { layer: "actual", planBlockId: "p1", startMinute: 540, endMinute: 600 }); // 60m
    const unplannedActual = block("a2", { layer: "actual", startMinute: 600, endMinute: 630 }); // 30m
    const stats = computeAccuracy([planned, linkedActual, unplannedActual], now);
    expect(stats.unplannedPct).toBeCloseTo((30 / 90) * 100);
  });

  it("treats an adjusted (different-time) linked actual as confirmed, not skipped", () => {
    const plan = block("p1", { startMinute: 540, endMinute: 600 });
    const adjustedActual = block("a1", { layer: "actual", planBlockId: "p1", startMinute: 550, endMinute: 610 });
    const stats = computeAccuracy([plan, adjustedActual], now);
    expect(stats.confirmedPct).toBe(100);
    expect(stats.skippedPct).toBe(0);
    expect(stats.avgStartDriftMinutes).toBe(10);
  });
});
