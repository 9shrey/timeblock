import { describe, expect, it } from "vitest";
import { weekDays } from "../time/localDate";
import type { Block, Now } from "../types";
import { computeAccuracy } from "./accuracy";

const WEEK = "2026-10-19";
const DAYS = weekDays(WEEK);
const MON = "2026-10-19";
const now: Now = { day: "2026-10-23", minute: 0 }; // Friday: Mon-Thu are past, Fri-Sun future

let seq = 0;
function block(p: Partial<Block> & Pick<Block, "day" | "startMinute" | "endMinute">): Block {
  return {
    id: `b${++seq}`,
    layer: "plan",
    title: "",
    goalId: null,
    notes: "",
    planBlockId: null,
    skipped: false,
    routineId: null,
    createdAt: 0,
    updatedAt: 0,
    ...p,
  };
}
const plan = (day: string, s: number, e: number, p: Partial<Block> = {}) => block({ day, startMinute: s, endMinute: e, ...p });
const actual = (day: string, s: number, e: number, p: Partial<Block> = {}) => block({ day, startMinute: s, endMinute: e, layer: "actual", ...p });

describe("computeAccuracy", () => {
  it("returns nulls when nothing is decided yet", () => {
    const stats = computeAccuracy([plan(MON, 540, 600)], DAYS, { day: MON, minute: 0 });
    expect(stats).toEqual({ decidedPlanCount: 0, confirmedAsPlannedPct: null, skippedPct: null, unplannedPct: null, avgStartDriftMinutes: null });
  });

  it("counts a block confirmed exactly as planned as 'confirmed'", () => {
    const p = plan(MON, 540, 600, { id: "p1" });
    const a = actual(MON, 540, 600, { planBlockId: "p1" });
    const stats = computeAccuracy([p, a], DAYS, now);
    expect(stats.decidedPlanCount).toBe(1);
    expect(stats.confirmedAsPlannedPct).toBe(100);
    expect(stats.skippedPct).toBe(0);
    expect(stats.avgStartDriftMinutes).toBe(0);
  });

  it("counts an adjusted (moved) confirmation separately from an exact one", () => {
    const p = plan(MON, 540, 600, { id: "p1" });
    const a = actual(MON, 555, 615, { planBlockId: "p1" }); // started 15 min late
    const stats = computeAccuracy([p, a], DAYS, now);
    expect(stats.confirmedAsPlannedPct).toBe(0);
    expect(stats.avgStartDriftMinutes).toBe(15);
  });

  it("counts a skipped plan block whether or not its time has passed", () => {
    const future = plan("2026-10-25", 540, 600, { skipped: true }); // Sunday, still future
    const stats = computeAccuracy([future], DAYS, now);
    expect(stats.decidedPlanCount).toBe(1);
    expect(stats.skippedPct).toBe(100);
  });

  it("an unconfirmed (past, no linked actual) plan block counts toward the denominator but neither numerator", () => {
    const p = plan(MON, 540, 600);
    const stats = computeAccuracy([p], DAYS, now);
    expect(stats.decidedPlanCount).toBe(1);
    expect(stats.confirmedAsPlannedPct).toBe(0);
    expect(stats.skippedPct).toBe(0);
  });

  it("measures unplannedPct over past actual blocks with no linked plan", () => {
    const linked = actual(MON, 540, 600, { planBlockId: "p1" });
    const unplanned = actual(MON, 600, 660);
    const stats = computeAccuracy([plan(MON, 540, 600, { id: "p1" }), linked, unplanned], DAYS, now);
    expect(stats.unplannedPct).toBe(50);
  });

  it("ignores blocks outside the given days", () => {
    const stats = computeAccuracy([plan("2026-09-01", 540, 600)], DAYS, now);
    expect(stats.decidedPlanCount).toBe(0);
  });
});
