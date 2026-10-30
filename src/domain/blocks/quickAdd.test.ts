import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "./quickAdd";
import type { Goal } from "../types";

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

const goals = [goal("g1", "Thesis"), goal("g2", "Exercise")];

describe("parseQuickAdd", () => {
  it("parses a time range, title and matching tag", () => {
    expect(parseQuickAdd("9-10:30 Thesis #thesis", goals)).toEqual({
      startMinute: 540,
      endMinute: 630,
      title: "Thesis",
      goalId: "g1",
    });
  });

  it("matches a tag case-insensitively and by prefix", () => {
    expect(parseQuickAdd("9-10 Work #THESIS", goals)?.goalId).toBe("g1");
    expect(parseQuickAdd("9-10 Work #exer", goals)?.goalId).toBe("g2");
  });

  it("leaves an unmatched tag in the title, with no goal", () => {
    const r = parseQuickAdd("9-10 Standup #nope", goals);
    expect(r).toMatchObject({ goalId: null, title: "Standup #nope" });
  });

  it("works with no tag at all", () => {
    expect(parseQuickAdd("9-10 Lunch", goals)).toEqual({ startMinute: 540, endMinute: 600, title: "Lunch", goalId: null });
  });

  it("accepts compact and dotted time formats", () => {
    expect(parseQuickAdd("900-1030 Thesis", goals)).toMatchObject({ startMinute: 540, endMinute: 630 });
    expect(parseQuickAdd("9.00-10.30 Thesis", goals)).toMatchObject({ startMinute: 540, endMinute: 630 });
  });

  it("rejects malformed or reversed input", () => {
    expect(parseQuickAdd("Thesis writing", goals)).toBeNull();
    expect(parseQuickAdd("10-9 Thesis", goals)).toBeNull();
    expect(parseQuickAdd("9-9 Thesis", goals)).toBeNull();
    expect(parseQuickAdd("", goals)).toBeNull();
    expect(parseQuickAdd("9-", goals)).toBeNull();
  });

  it("allows an empty title, with or without trailing space", () => {
    expect(parseQuickAdd("9-10 ", goals)).toEqual({ startMinute: 540, endMinute: 600, title: "", goalId: null });
    expect(parseQuickAdd("9-10", goals)).toEqual({ startMinute: 540, endMinute: 600, title: "", goalId: null });
  });

  it("accepts 12-hour times on either side of the range", () => {
    expect(parseQuickAdd("9am-10:30am Thesis", goals)).toMatchObject({ startMinute: 540, endMinute: 630, title: "Thesis" });
    expect(parseQuickAdd("9:30pm-11pm Read", goals)).toMatchObject({ startMinute: 1290, endMinute: 1380 });
    expect(parseQuickAdd("11:30am-1pm Lunch #exer", goals)).toMatchObject({ startMinute: 690, endMinute: 780, goalId: "g2" });
    expect(parseQuickAdd("9AM-5PM Work", goals)).toMatchObject({ startMinute: 540, endMinute: 1020 });
  });

  it("gives a bare start the end's am/pm, unless that would reverse the range", () => {
    expect(parseQuickAdd("9-10:30pm Thesis", goals)).toMatchObject({ startMinute: 1260, endMinute: 1350 });
    expect(parseQuickAdd("9:15-10am Thesis", goals)).toMatchObject({ startMinute: 555, endMinute: 600 });
    expect(parseQuickAdd("11-1pm Lunch", goals)).toMatchObject({ startMinute: 660, endMinute: 780 });
    expect(parseQuickAdd("12-1pm Lunch", goals)).toMatchObject({ startMinute: 720, endMinute: 780 });
  });

  it("mixes 24-hour and 12-hour sides", () => {
    expect(parseQuickAdd("9am-13:00 Thesis", goals)).toMatchObject({ startMinute: 540, endMinute: 780 });
    expect(parseQuickAdd("13:00-2pm Thesis", goals)).toMatchObject({ startMinute: 780, endMinute: 840 });
  });

  it("reads a range ending at midnight as the end of the day", () => {
    expect(parseQuickAdd("11pm-12am Wind down", goals)).toMatchObject({ startMinute: 1380, endMinute: 1440 });
    expect(parseQuickAdd("23-24 Wind down", goals)).toMatchObject({ startMinute: 1380, endMinute: 1440 });
  });

  it("rejects invalid or reversed 12-hour input", () => {
    expect(parseQuickAdd("10pm-9pm Thesis", goals)).toBeNull();
    expect(parseQuickAdd("13pm-14pm Thesis", goals)).toBeNull();
    expect(parseQuickAdd("9-10xm Thesis", goals)).toBeNull();
  });
});
