import { describe, expect, it } from "vitest";
import { toIcs } from "./export";
import type { Block } from "../types";

const block = (over: Partial<Block> = {}): Block => ({
  id: "b1",
  day: "2026-10-21",
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

describe("toIcs", () => {
  it("emits one VEVENT per block in range, with floating local times", () => {
    const text = toIcs({ blocks: [block()], from: "2026-10-21", to: "2026-10-21", generatedAtMs: Date.UTC(2026, 9, 21, 12) });
    expect(text).toContain("BEGIN:VEVENT");
    expect(text).toContain("DTSTART:20261021T090000");
    expect(text).toContain("DTEND:20261021T100000");
    expect(text).toContain("SUMMARY:Write");
    expect(text).toContain("END:VEVENT");
  });

  it("excludes blocks outside the date range", () => {
    const text = toIcs({ blocks: [block({ day: "2026-10-01" })], from: "2026-10-21", to: "2026-10-21", generatedAtMs: 0 });
    expect(text).not.toContain("BEGIN:VEVENT");
  });

  it("prefixes actual blocks and rolls a midnight end minute into the next day", () => {
    const text = toIcs({
      blocks: [block({ layer: "actual", title: "Sleep", endMinute: 1440 })],
      from: "2026-10-21",
      to: "2026-10-21",
      generatedAtMs: 0,
    });
    expect(text).toContain("SUMMARY:[Actual] Sleep");
    expect(text).toContain("DTEND:20261022T000000");
  });

  it("escapes commas, semicolons and newlines in titles and notes", () => {
    const text = toIcs({ blocks: [block({ title: "A, B; C", notes: "line one\nline two" })], from: "2026-10-21", to: "2026-10-21", generatedAtMs: 0 });
    expect(text).toContain("SUMMARY:A\\, B\\; C");
    expect(text).toContain("DESCRIPTION:line one\\nline two");
  });

  it("omits DESCRIPTION when there are no notes", () => {
    const text = toIcs({ blocks: [block()], from: "2026-10-21", to: "2026-10-21", generatedAtMs: 0 });
    expect(text).not.toContain("DESCRIPTION");
  });
});
