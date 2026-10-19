import { describe, expect, it } from "vitest";
import {
  applyDayTemplate,
  applyWeekTemplate,
  deleteTemplateChanges,
  renameTemplateChanges,
  templateFromDay,
  templateFromWeek,
} from "./templates";
import { testEnv } from "./env";
import type { Block } from "./types";

const block = (over: Partial<Block> = {}): Block => ({
  id: "b",
  day: "2026-10-19",
  layer: "plan",
  startMinute: 540,
  endMinute: 600,
  title: "Write",
  goalId: null,
  notes: "",
  planBlockId: null,
  skipped: false,
  routineId: null,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe("templateFromDay", () => {
  it("captures only that day's plan blocks, with dayOffset 0", () => {
    const blocks = [
      block({ id: "p1", day: "2026-10-19", startMinute: 540, endMinute: 600, title: "Thesis", goalId: "g1" }),
      block({ id: "p2", day: "2026-10-19", layer: "actual" }), // not plan
      block({ id: "p3", day: "2026-10-20" }), // other day
    ];
    const { template } = templateFromDay("Focus day", "2026-10-19", blocks, testEnv());
    expect(template.name).toBe("Focus day");
    expect(template.spanDays).toBe(1);
    expect(template.blocks).toEqual([
      { dayOffset: 0, startMinute: 540, endMinute: 600, title: "Thesis", goalId: "g1", notes: "" },
    ]);
  });

  it("trims the name and sorts blocks by start time", () => {
    const blocks = [
      block({ id: "p1", startMinute: 600, endMinute: 660, title: "Second" }),
      block({ id: "p2", startMinute: 540, endMinute: 600, title: "First" }),
    ];
    const { template } = templateFromDay("  Day  ", "2026-10-19", blocks, testEnv());
    expect(template.name).toBe("Day");
    expect(template.blocks.map((b) => b.title)).toEqual(["First", "Second"]);
  });
});

describe("templateFromWeek", () => {
  it("captures every day's plan blocks with dayOffset relative to the week start", () => {
    const blocks = [
      block({ id: "mon", day: "2026-10-19", title: "Mon block" }),
      block({ id: "wed", day: "2026-10-21", title: "Wed block" }),
      block({ id: "sun", day: "2026-10-25", title: "Sun block" }),
      block({ id: "other-week", day: "2026-10-26", title: "Next week" }),
    ];
    const { template } = templateFromWeek("Week", "2026-10-19", blocks, testEnv());
    expect(template.spanDays).toBe(7);
    expect(template.blocks.map((b) => [b.dayOffset, b.title])).toEqual([
      [0, "Mon block"],
      [2, "Wed block"],
      [6, "Sun block"],
    ]);
  });
});

describe("applyDayTemplate", () => {
  it("creates one new, unlinked plan block per template block on the given day", () => {
    const { template } = templateFromDay("T", "2026-10-19", [block({ id: "p1", goalId: "g1" })], testEnv());
    const env = testEnv(5000);
    const changes = applyDayTemplate(template, "2026-11-02", new Set(["g1"]), env);
    expect(changes).toHaveLength(1);
    const [c] = changes;
    expect(c).toMatchObject({ op: "put", table: "blocks" });
    const row = (c as { row: Block }).row;
    expect(row).toMatchObject({ day: "2026-11-02", layer: "plan", startMinute: 540, endMinute: 600, goalId: "g1", planBlockId: null, routineId: null });
  });

  it("drops a goal that isn't active for the target week", () => {
    const { template } = templateFromDay("T", "2026-10-19", [block({ goalId: "g1" })], testEnv());
    const changes = applyDayTemplate(template, "2026-11-02", new Set(), testEnv(5000));
    expect((changes[0] as { row: Block }).row.goalId).toBeNull();
  });
});

describe("applyWeekTemplate", () => {
  it("only writes the days passed in `days`", () => {
    const blocks = [block({ id: "mon", day: "2026-10-19" }), block({ id: "wed", day: "2026-10-21", title: "Wed" })];
    const { template } = templateFromWeek("T", "2026-10-19", blocks, testEnv());
    const changes = applyWeekTemplate(template, "2026-11-02", new Set(["2026-11-04"]), new Set(), testEnv(5000));
    expect(changes).toHaveLength(1);
    expect((changes[0] as { row: Block }).row.day).toBe("2026-11-04");
    expect((changes[0] as { row: Block }).row.title).toBe("Wed");
  });
});

describe("renameTemplateChanges / deleteTemplateChanges", () => {
  it("renames (trimmed) or no-ops if unchanged", () => {
    const { template } = templateFromDay("Original", "2026-10-19", [block()], testEnv());
    const env = testEnv(9000);
    const changes = renameTemplateChanges(template, "  New name  ", env);
    expect((changes[0] as { row: { name: string } }).row.name).toBe("New name");
    expect(renameTemplateChanges(template, "Original", env)).toEqual([]);
  });

  it("deletes by id", () => {
    const { template } = templateFromDay("T", "2026-10-19", [block()], testEnv());
    expect(deleteTemplateChanges(template)).toEqual([{ op: "del", table: "templates", key: template.id }]);
  });
});
