import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "./quickAdd";
import type { Goal } from "../types";

const goal = (id: string, name: string): Goal => ({
  id,
  name,
  color: "#336699",
  kind: "min",
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
});
