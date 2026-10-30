import { describe, expect, it } from "vitest";
import { nextUpcomingBlock } from "./tray";
import type { Block, Goal, Now } from "./types";

const DAY = "2026-10-19";
const now: Now = { day: DAY, minute: 540 };

const block = (over: Partial<Block> = {}): Block => ({
  id: "b",
  day: DAY,
  layer: "plan",
  startMinute: 540,
  endMinute: 600,
  title: "Write",
  goalId: null,
  notes: "",
  planBlockId: null,
  skipped: false,
  routineId: null,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

const goal = (id: string, name: string): Goal => ({
  id,
  name,
  color: "#336699",
  kind: "min",
  trackBy: "time", activeDays: 127,
  sortOrder: 0,
  archivedOn: null,
  createdAt: 0,
  updatedAt: 0,
});

describe("nextUpcomingBlock", () => {
  it("returns null when today has no remaining plan blocks", () => {
    expect(nextUpcomingBlock([], {}, now)).toBeNull();
    expect(nextUpcomingBlock([block({ endMinute: 500 })], {}, now)).toBeNull();
  });

  it("skips skipped and actual blocks, and other days", () => {
    const blocks = [block({ id: "skip", skipped: true }), block({ id: "actual", layer: "actual" }), block({ id: "other-day", day: "2026-10-20" })];
    expect(nextUpcomingBlock(blocks, {}, now)).toBeNull();
  });

  it("picks the earliest upcoming block and shows its start time", () => {
    const blocks = [block({ id: "later", startMinute: 700, endMinute: 760, title: "Later" }), block({ id: "soon", startMinute: 600, endMinute: 660, title: "Soon" })];
    expect(nextUpcomingBlock(blocks, {}, now)).toBe("Soon · 10:00");
    expect(nextUpcomingBlock(blocks, {}, now, "12h")).toBe("Soon · 10:00 AM");
  });

  it("shows \"now\" for a block already running, and falls back to the goal's name", () => {
    const blocks = [block({ title: "", goalId: "g1" })];
    expect(nextUpcomingBlock(blocks, { g1: goal("g1", "Thesis") }, now)).toBe("Thesis · now");
  });
});
