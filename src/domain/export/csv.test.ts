import { describe, expect, it } from "vitest";
import { blocksToCsv, goalStatsToCsv } from "./csv";
import type { GoalStats } from "../stats/stats";
import type { Block, Goal } from "../types";

const block = (over: Partial<Block> = {}): Block => ({
  id: "b1",
  day: "2026-10-21",
  layer: "plan",
  startMinute: 540,
  endMinute: 600,
  title: "Write",
  goalId: "g1",
  notes: "",
  planBlockId: null,
  skipped: false,
  routineId: null,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

const goal = (id: string, name: string): Goal => ({ id, name, color: "#336699", kind: "min", sortOrder: 0, archivedOn: null, createdAt: 0, updatedAt: 0 });

describe("blocksToCsv", () => {
  it("emits a header and one row per block in range, resolving the goal name", () => {
    const csv = blocksToCsv([block()], { g1: goal("g1", "Thesis") }, "2026-10-21", "2026-10-21");
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("day,layer,start,end,title,goal,notes,skipped");
    expect(lines[1]).toBe("2026-10-21,plan,09:00,10:00,Write,Thesis,,no");
  });

  it("excludes blocks outside the range and leaves goal blank when unresolved", () => {
    const csv = blocksToCsv([block({ day: "2026-01-01" }), block({ goalId: null })], {}, "2026-10-21", "2026-10-21");
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(2); // header + the one in-range block
    expect(lines[1]).toContain(",,"); // empty goal field
  });

  it("quotes fields containing commas or quotes", () => {
    const csv = blocksToCsv([block({ title: 'A, "B"' })], {}, "2026-10-21", "2026-10-21");
    expect(csv).toContain('"A, ""B"""');
  });
});

describe("goalStatsToCsv", () => {
  const stats = (over: Partial<GoalStats> = {}): GoalStats => ({
    goalId: "g1",
    goal: goal("g1", "Thesis"),
    kind: "min",
    target: 300,
    targetFromWeek: null,
    checklist: { done: 0, total: 0 },
    byDay: {},
    status: "met",
    planned: 300,
    actual: 320,
    unconfirmed: 0,
    upcoming: 0,
    projected: 320,
    unplanned: 20,
    skipped: 0,
    ...over,
  });

  it("emits a header and one row per goal, plus an unassigned row when given", () => {
    const csv = goalStatsToCsv([stats()], stats({ goalId: "__unassigned__", goal: null, target: null, status: "no_target" }));
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("goal,kind,target_minutes,planned_minutes,actual_minutes,unplanned_minutes,skipped_minutes,status");
    expect(lines[1]).toBe("Thesis,min,300,300,320,20,0,met");
    expect(lines[2]).toBe("(no goal),min,,300,320,20,0,no_target");
  });

  it("omits the unassigned row when null", () => {
    const csv = goalStatsToCsv([stats()], null);
    expect(csv.trim().split("\r\n")).toHaveLength(2);
  });
});
