import { describe, expect, it } from "vitest";
import type { Block, Goal, Now, WeekTarget } from "../types";
import { computeTrends, trendWeekStarts } from "./trends";

const now: Now = { day: "2026-11-02", minute: 600 }; // Monday

const goal = (id: string, extra: Partial<Goal> = {}): Goal => ({
  id,
  name: id,
  color: "#3b82f6",
  kind: "min",
  sortOrder: 0,
  archivedOn: null,
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

const block = (id: string, day: string, extra: Partial<Block> = {}): Block => ({
  id,
  day,
  layer: "actual",
  startMinute: 540,
  endMinute: 600,
  title: id,
  goalId: "g1",
  notes: "",
  planBlockId: null,
  skipped: false,
  routineId: null,
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

const target = (weekStart: string, minutes: number | null): WeekTarget => ({
  goalId: "g1",
  weekStart,
  targetMinutes: minutes,
  updatedAt: 1,
});

describe("trendWeekStarts", () => {
  it("returns `count` Mondays ending at (and including) the given week, oldest first", () => {
    expect(trendWeekStarts("2026-10-19", 3)).toEqual(["2026-10-05", "2026-10-12", "2026-10-19"]);
  });
});

describe("computeTrends", () => {
  it("builds a per-week point for every goal, even weeks with no activity", () => {
    const weekStarts = trendWeekStarts("2026-10-19", 2); // [2026-10-12, 2026-10-19]
    const trends = computeTrends({ weekStarts, blocks: [], goals: [goal("g1")], targets: [], now });
    expect(trends).toHaveLength(1);
    expect(trends[0]!.weeks).toEqual([
      { weekStart: "2026-10-12", planned: 0, actual: 0, target: null, met: null },
      { weekStart: "2026-10-19", planned: 0, actual: 0, target: null, met: null },
    ]);
    expect(trends[0]!.streak).toBe(0);
  });

  it("marks a week met when actual reaches a min-kind target, and counts a trailing streak", () => {
    const weekStarts = trendWeekStarts("2026-10-19", 3); // [10-05, 10-12, 10-19]
    const blocks = [
      block("a1", "2026-10-05", { endMinute: 540 + 30 }), // 30m: misses 60m target
      block("a2", "2026-10-12", { endMinute: 540 + 90 }), // 90m: meets
      block("a3", "2026-10-19", { endMinute: 540 + 90 }), // 90m: meets
    ];
    const targets = [target("2026-10-05", 60)];
    const trends = computeTrends({ weekStarts, blocks, goals: [goal("g1")], targets, now });
    const weeks = trends[0]!.weeks;
    expect(weeks.map((w) => w.met)).toEqual([false, true, true]);
    expect(trends[0]!.streak).toBe(2);
  });

  it("a max-kind goal is met when actual stays at or under target", () => {
    const weekStarts = trendWeekStarts("2026-10-12", 1);
    const blocks = [block("a1", "2026-10-12", { endMinute: 540 + 30 })];
    const targets = [target("2026-10-12", 60)];
    const trends = computeTrends({ weekStarts, blocks, goals: [goal("g1", { kind: "max" })], targets, now });
    expect(trends[0]!.weeks[0]!.met).toBe(true);
  });

  it("a future week is never counted as met", () => {
    const futureWeek = "2026-11-09"; // after `now`
    const trends = computeTrends({
      weekStarts: [futureWeek],
      blocks: [block("a1", futureWeek, { endMinute: 540 + 120 })],
      goals: [goal("g1")],
      targets: [target(futureWeek, 60)],
      now,
    });
    expect(trends[0]!.weeks[0]!.met).toBeNull();
  });
});
