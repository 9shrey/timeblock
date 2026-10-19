import { describe, expect, it } from "vitest";
import { computeTrend, metStreak } from "./trends";
import { addDays, weekStartOf } from "../time/localDate";
import type { Block, Goal, Now } from "../types";

const WEEK = weekStartOf("2026-10-21", 1); // the Monday of the week containing this Wednesday
const now: Now = { day: "2026-10-21", minute: 840 };

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

const goal = (id: string, kind: Goal["kind"] = "min"): Goal => ({ id, name: id, color: "#336699", kind, sortOrder: 0, archivedOn: null, createdAt: 0, updatedAt: 0 });

describe("computeTrend", () => {
  it("returns `weeks` consecutive weeks ending at endDay's week, oldest first", () => {
    const trend = computeTrend({ blocks: [], goals: [], targets: [], weekStartDay: 1, endDay: "2026-10-21", now, weeks: 3 });
    expect(trend.map((w) => w.weekStart)).toEqual([addDays(WEEK, -14), addDays(WEEK, -7), WEEK]);
  });

  it("only includes blocks that fall within each week", () => {
    const inWeek = block({ day: WEEK, startMinute: 0, endMinute: 60 });
    const lastWeek = block({ day: addDays(WEEK, -7), startMinute: 0, endMinute: 120 });
    const trend = computeTrend({ blocks: [inWeek, lastWeek], goals: [goal("g1")], targets: [], weekStartDay: 1, endDay: "2026-10-21", now, weeks: 2 });
    expect(trend[0]!.stats.totals.actual).toBe(120);
    expect(trend[1]!.stats.totals.actual).toBe(60);
  });
});

describe("metStreak", () => {
  it("counts consecutive met weeks backward from the most recent past week", () => {
    const w1 = addDays(WEEK, -21);
    const w2 = addDays(WEEK, -14);
    const w3 = addDays(WEEK, -7);
    // All four weeks past; met in w2 and w3, missed in w1.
    const blocks = [
      block({ day: w1, startMinute: 0, endMinute: 10 }),
      block({ day: w2, startMinute: 0, endMinute: 600 }),
      block({ day: w3, startMinute: 0, endMinute: 600 }),
    ];
    const targets = [
      { goalId: "g1", weekStart: w1, targetMinutes: 600, updatedAt: 0 },
      { goalId: "g1", weekStart: w2, targetMinutes: 600, updatedAt: 0 },
      { goalId: "g1", weekStart: w3, targetMinutes: 600, updatedAt: 0 },
    ];
    const trend = computeTrend({ blocks, goals: [goal("g1")], targets, weekStartDay: 1, endDay: addDays(WEEK, -1), now, weeks: 3 });
    expect(metStreak(trend, "g1", "min")).toBe(2);
  });

  it("stops at the first break, and ignores the current (not-yet-decided) week", () => {
    const met = addDays(WEEK, -7);
    const blocks = [block({ day: met, startMinute: 0, endMinute: 600 }), block({ day: WEEK, startMinute: 0, endMinute: 10 })];
    const targets = [
      { goalId: "g1", weekStart: met, targetMinutes: 600, updatedAt: 0 },
      { goalId: "g1", weekStart: WEEK, targetMinutes: 600, updatedAt: 0 },
    ];
    const trend = computeTrend({ blocks, goals: [goal("g1")], targets, weekStartDay: 1, endDay: "2026-10-21", now, weeks: 2 });
    expect(trend[1]!.stats.phase).toBe("current");
    expect(metStreak(trend, "g1", "min")).toBe(1);
  });

  it("uses 'within' as success for a max-kind goal", () => {
    const past = addDays(WEEK, -7);
    const blocks = [block({ day: past, startMinute: 0, endMinute: 30 })];
    const targets = [{ goalId: "g1", weekStart: past, targetMinutes: 60, updatedAt: 0 }];
    const trend = computeTrend({ blocks, goals: [goal("g1", "max")], targets, weekStartDay: 1, endDay: addDays(WEEK, -1), now, weeks: 1 });
    expect(metStreak(trend, "g1", "max")).toBe(1);
  });
});
