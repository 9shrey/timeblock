import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { applyChanges, invertChanges, stateFrom } from "../changes";
import { testEnv } from "../env";
import { addDays } from "../time/localDate";
import type { Block, ChecklistItem, Goal, WeekTarget } from "../types";
import { createGoal, deleteGoalChanges, effectiveTarget, reorderGoalsChanges, clearTargetChanges, setTargetChanges, updateGoal } from "./targets";

const W0 = "2026-10-05";
const W1 = addDays(W0, 7);
const W2 = addDays(W0, 14);
const W3 = addDays(W0, 21);
const W5 = addDays(W0, 35);

const row = (goalId: string, weekStart: string, targetMinutes: number | null): WeekTarget => ({
  goalId,
  weekStart,
  targetMinutes,
  targetCount: null,
  updatedAt: 0,
});

const goal = (id: string, sortOrder = 0): Goal => ({
  id,
  name: id,
  color: "#123456",
  kind: "min",
  trackBy: "time", activeDays: 127,
  sortOrder,
  archivedOn: null,
  createdAt: 0,
  updatedAt: 0,
});

describe("effectiveTarget", () => {
  const rows = [row("g", W1, 600), row("g", W3, 900), row("other", W0, 60)];

  it("carries the latest row at or before the week forward", () => {
    expect(effectiveTarget(rows, "g", W0)).toEqual({ minutes: null, count: null, fromWeek: null });
    expect(effectiveTarget(rows, "g", W1)).toEqual({ minutes: 600, count: null, fromWeek: W1 });
    expect(effectiveTarget(rows, "g", W2)).toEqual({ minutes: 600, count: null, fromWeek: W1 });
    expect(effectiveTarget(rows, "g", W3)).toEqual({ minutes: 900, count: null, fromWeek: W3 });
    expect(effectiveTarget(rows, "g", W5)).toEqual({ minutes: 900, count: null, fromWeek: W3 });
  });

  it("a null row means tracked only from that week on", () => {
    const r = [...rows, row("g", W5, null)];
    expect(effectiveTarget(r, "g", W5)).toEqual({ minutes: null, count: null, fromWeek: W5 });
    expect(effectiveTarget(r, "g", addDays(W5, 7))).toEqual({ minutes: null, count: null, fromWeek: W5 });
  });

  it("is order independent", () => {
    fc.assert(
      fc.property(fc.shuffledSubarray(rows, { minLength: rows.length }), (shuffled) => {
        expect(effectiveTarget(shuffled, "g", W2)).toEqual({ minutes: 600, count: null, fromWeek: W1 });
      }),
    );
  });
});

describe("setTargetChanges", () => {
  it("editing W+1 leaves W unchanged", () => {
    const env = testEnv();
    let state = stateFrom({ weekTargets: [row("g", W1, 600)] });
    state = applyChanges(state, setTargetChanges("g", W2, 300, env));
    const rows = Object.values(state.weekTargets);
    expect(effectiveTarget(rows, "g", W1).minutes).toBe(600);
    expect(effectiveTarget(rows, "g", W2).minutes).toBe(300);
    expect(effectiveTarget(rows, "g", W3).minutes).toBe(300);
  });

  it("upserts only the given week", () => {
    const env = testEnv(5);
    expect(setTargetChanges("g", W1, null, env)).toEqual([
      { op: "put", table: "weekTargets", row: { goalId: "g", weekStart: W1, targetMinutes: null, targetCount: null, updatedAt: 5 } },
    ]);
  });
});

describe("clearTargetChanges", () => {
  it("deletes only that week's row, so the week inherits again", () => {
    const env = testEnv();
    let state = stateFrom({ weekTargets: [] });
    state = applyChanges(state, setTargetChanges("g", W0, 300, env));
    state = applyChanges(state, setTargetChanges("g", W1, 600, env));
    const before = Object.values(state.weekTargets);
    state = applyChanges(state, clearTargetChanges(before, "g", W1));
    const rows = Object.values(state.weekTargets);
    expect(effectiveTarget(rows, "g", W1)).toMatchObject({ minutes: 300, fromWeek: W0 });
    expect(clearTargetChanges(rows, "g", W2)).toEqual([]);
  });
});

describe("createGoal / updateGoal", () => {
  it("creates a trimmed goal at the end plus a target row for the viewed week", () => {
    const env = testEnv(1000);
    const { goal: g, changes } = createGoal(
      { name: "  Thesis ", color: "#ff0000", kind: "min", activeDays: 127, targetMinutes: 600 },
      W2,
      [goal("a", 3), goal("b", 7)],
      env,
    );
    expect(g).toMatchObject({ id: "id1", name: "Thesis", sortOrder: 8, archivedOn: null, createdAt: 1000, updatedAt: 1000 });
    expect(changes).toEqual([
      { op: "put", table: "goals", row: g },
      { op: "put", table: "weekTargets", row: { goalId: "id1", weekStart: W2, targetMinutes: 600, targetCount: null, updatedAt: 1000 } },
    ]);
  });

  it("stores its active days", () => {
    const { goal: g } = createGoal({ name: "Gym", color: "#7c3aed", kind: "min", activeDays: 0b0111110, targetMinutes: 300 }, W0, [], testEnv(1000));
    expect(g).toMatchObject({ activeDays: 0b0111110, trackBy: "time" });
  });

  it("first goal gets sortOrder 0", () => {
    const { goal: g } = createGoal(
      { name: "x", color: "#000000", kind: "max", activeDays: 127, targetMinutes: null },
      W0,
      [],
      testEnv(),
    );
    expect(g.sortOrder).toBe(0);
  });

  it("patches and bumps updatedAt without mutating the input", () => {
    const g = goal("a");
    const [c] = updateGoal(g, { name: " New ", archivedOn: W1 }, testEnv(42));
    expect(c).toEqual({ op: "put", table: "goals", row: { ...g, name: "New", archivedOn: W1, updatedAt: 42 } });
    expect(g.name).toBe("a");
  });
});

describe("deleteGoalChanges", () => {
  it("deletes dependents explicitly and is invertible", () => {
    const g = goal("g");
    const block = (id: string, goalId: string | null): Block => ({
      id,
      day: W1,
      layer: "plan",
      startMinute: 0,
      endMinute: 60,
      title: "",
      goalId,
      notes: "",
      planBlockId: null,
      skipped: false,
      routineId: null,
      createdAt: 0,
      updatedAt: 0,
    });
    const item = (id: string, goalId: string): ChecklistItem => ({
      id,
      goalId,
      weekStart: W1,
      text: id,
      done: false,
      sortOrder: 0,
      carriedFromId: null,
      createdAt: 0,
      updatedAt: 0,
    });
    const rows = {
      targets: [row("g", W1, 60), row("h", W1, 60)],
      checklist: [item("c1", "g"), item("c2", "h")],
      blocks: [block("b1", "g"), block("b2", "h")],
    };
    const before = stateFrom({
      goals: [g, goal("h")],
      weekTargets: rows.targets,
      checklistItems: rows.checklist,
      blocks: rows.blocks,
    });
    const changes = deleteGoalChanges(g, rows, testEnv(9));
    const after = applyChanges(before, changes);
    expect(Object.keys(after.goals)).toEqual(["h"]);
    expect(Object.keys(after.weekTargets)).toEqual([`h|${W1}`]);
    expect(Object.keys(after.checklistItems)).toEqual(["c2"]);
    expect(after.blocks.b1).toMatchObject({ goalId: null, updatedAt: 9 });
    expect(after.blocks.b2).toEqual(rows.blocks[1]);
    expect(applyChanges(after, invertChanges(before, changes))).toEqual(before);
  });
});

describe("reorderGoalsChanges", () => {
  it("writes sortOrder for the new order, skipping goals already at that index", () => {
    const goals = [goal("a", 0), goal("b", 1), goal("c", 2)];
    const changes = reorderGoalsChanges(goals, ["c", "a", "b"], testEnv(5));
    // "a" moves from 0 to 1, "b" from 1 to 2, "c" from 2 to 0 - none stay put.
    expect(changes).toHaveLength(3);
    expect(changes).toContainEqual({ op: "put", table: "goals", row: { ...goal("a"), sortOrder: 1, updatedAt: 5 } });
    expect(changes).toContainEqual({ op: "put", table: "goals", row: { ...goal("b"), sortOrder: 2, updatedAt: 5 } });
    expect(changes).toContainEqual({ op: "put", table: "goals", row: { ...goal("c"), sortOrder: 0, updatedAt: 5 } });
  });

  it("is a no-op when the order is unchanged", () => {
    const goals = [goal("a", 0), goal("b", 1)];
    expect(reorderGoalsChanges(goals, ["a", "b"], testEnv())).toEqual([]);
  });
});
