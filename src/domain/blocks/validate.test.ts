import { describe, expect, it } from "vitest";
import type { Block, Goal } from "../types";
import { validateBlock } from "./validate";

const goal = (id: string, archivedOn: string | null = null): Goal => ({
  id,
  name: id,
  color: "#2563eb",
  kind: "min",
  sortOrder: 0,
  archivedOn,
  createdAt: 0,
  updatedAt: 0,
});

const block = (over: Partial<Block> = {}): Block => ({
  id: "b1",
  day: "2026-10-19",
  layer: "plan",
  startMinute: 540,
  endMinute: 600,
  title: "Work",
  goalId: null,
  notes: "",
  planBlockId: null,
  skipped: false,
  routineId: null,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

const plan = block({ id: "p1" });
const goals = { g: goal("g"), old: goal("old", "2026-10-01") };
const blocks = { p1: plan, a0: block({ id: "a0", layer: "actual" }), p2: block({ id: "p2", day: "2026-10-18" }) };
const ctx = { goals, blocks };
const v = (over: Partial<Block>, extra: Partial<Parameters<typeof validateBlock>[1]> = {}) =>
  validateBlock(block(over), { ...ctx, ...extra });

describe("validateBlock", () => {
  it("accepts a valid block", () => {
    expect(v({})).toEqual([]);
    expect(v({ startMinute: 0, endMinute: 1440, goalId: "g" })).toEqual([]);
    expect(v({ startMinute: 1439, endMinute: 1440 })).toEqual([]);
  });

  it("requires integer minutes", () => {
    expect(v({ startMinute: 540.5 })).toHaveLength(1);
    expect(v({ endMinute: Number.NaN })).toHaveLength(1);
  });

  it("checks start and end ranges and order", () => {
    expect(v({ startMinute: -1 })).toHaveLength(1);
    expect(v({ startMinute: 1440, endMinute: 1440 }).length).toBeGreaterThanOrEqual(1);
    expect(v({ startMinute: 0, endMinute: 1441 })).toHaveLength(1);
    expect(v({ startMinute: 0, endMinute: 0 }).length).toBeGreaterThanOrEqual(1);
    expect(v({ startMinute: 600, endMinute: 600 })).toEqual(["End must be after start."]);
    expect(v({ startMinute: 600, endMinute: 540 })).toEqual(["End must be after start."]);
  });

  it("requires a valid day", () => {
    expect(v({ day: "2026-02-30" })).toHaveLength(1);
    expect(v({ day: "19/10/2026" })).toHaveLength(1);
  });

  it("limits title and notes length", () => {
    expect(v({ title: "x".repeat(200), notes: "y".repeat(5000) })).toEqual([]);
    expect(v({ title: "x".repeat(201) })).toHaveLength(1);
    expect(v({ notes: "y".repeat(5001) })).toHaveLength(1);
  });

  it("rejects an unknown goal", () => {
    expect(v({ goalId: "nope" })).toEqual(["Unknown goal."]);
  });

  it("rejects an archived goal only on create or goal change", () => {
    expect(v({ goalId: "old" })).toHaveLength(1);
    expect(v({ goalId: "old" }, { previous: null })).toHaveLength(1);
    expect(v({ goalId: "old", title: "Edited" }, { previous: block({ goalId: "old" }) })).toEqual([]);
    expect(v({ goalId: "old" }, { previous: block({ goalId: "g" }) })).toHaveLength(1);
  });

  it("allows planBlockId only on actual blocks", () => {
    expect(v({ layer: "plan", planBlockId: "p1" })).toEqual(["Only actual blocks can link to a plan block."]);
    expect(v({ layer: "actual", planBlockId: "p1" })).toEqual([]);
  });

  it("requires the link to be an existing same-day plan block", () => {
    expect(v({ layer: "actual", planBlockId: "missing" })).toHaveLength(1);
    expect(v({ layer: "actual", planBlockId: "a0" })).toHaveLength(1);
    expect(v({ layer: "actual", planBlockId: "p2" })).toEqual(["Linked plan block must be on the same day."]);
  });

  it("allows skipped only on plan blocks", () => {
    expect(v({ layer: "plan", skipped: true })).toEqual([]);
    expect(v({ layer: "actual", skipped: true })).toEqual(["Only plan blocks can be skipped."]);
  });
});
