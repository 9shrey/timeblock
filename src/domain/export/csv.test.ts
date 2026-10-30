import { describe, expect, it } from "vitest";
import type { Block, Goal } from "../types";
import { blocksToCsv, csvFileName, weeklyStatsToCsv } from "./csv";

const goal = (id: string, name: string): Goal => ({
  id,
  name,
  color: "#3b82f6",
  kind: "min",
  trackBy: "time", activeDays: 127,
  sortOrder: 0,
  archivedOn: null,
  createdAt: 1,
  updatedAt: 1,
});

const block = (id: string, extra: Partial<Block> = {}): Block => ({
  id,
  day: "2026-10-19",
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

describe("blocksToCsv", () => {
  it("writes a header and one sorted row per block", () => {
    const b1 = block("b1", { day: "2026-10-20", goalId: "g1" });
    const b2 = block("b2", { day: "2026-10-19", startMinute: 600, endMinute: 660 });
    const csv = blocksToCsv([b1, b2], new Map([["g1", goal("g1", "Thesis")]]));
    expect(csv).toBe(
      "day,layer,start,end,title,goal,skipped,linked_plan_id\n" +
        "2026-10-19,plan,10:00,11:00,b2,,0,\n" +
        "2026-10-20,plan,09:00,10:00,b1,Thesis,0,\n",
    );
  });

  it("escapes commas, quotes and newlines in titles", () => {
    const b = block("b1", { title: 'Call "Bob", re: plans\nfollow up' });
    const csv = blocksToCsv([b], new Map());
    expect(csv).toContain('"Call ""Bob"", re: plans\nfollow up"');
  });

  it("is deterministic across runs (stable sort, same order every time)", () => {
    const blocks = [block("c"), block("a"), block("b")];
    expect(blocksToCsv(blocks, new Map())).toBe(blocksToCsv([...blocks].reverse(), new Map()));
  });
});

describe("weeklyStatsToCsv", () => {
  it("writes a header and sorts by week then goal name", () => {
    const csv = weeklyStatsToCsv([
      { weekStart: "2026-10-19", goalName: "Thesis", plannedMinutes: 600, actualMinutes: 300, targetMinutes: 600, status: "behind" },
      { weekStart: "2026-10-12", goalName: "Admin", plannedMinutes: 120, actualMinutes: 120, targetMinutes: null, status: "no_target" },
    ]);
    expect(csv).toBe(
      "week_start,goal,planned_minutes,actual_minutes,target_minutes,status\n" +
        "2026-10-12,Admin,120,120,,no_target\n" +
        "2026-10-19,Thesis,600,300,600,behind\n",
    );
  });
});

describe("csvFileName", () => {
  it("names the file by kind and range", () => {
    expect(csvFileName("blocks", "2026-10-01", "2026-10-31")).toBe("timeblock-blocks-2026-10-01-to-2026-10-31.csv");
  });
});
