import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  addDays,
  addMonths,
  dayOfWeek,
  diffDays,
  formatDuration,
  formatHourLabel,
  formatMinute,
  formatMinuteRange,
  isoWeek,
  parseLocalDate,
  parseTimeInput,
  weekDays,
  weekShiftDays,
  weekStartOf,
} from "./localDate";
import { nowFrom, parseNowOverride } from "./clock";

describe("addMonths", () => {
  it("clamps the day of month and crosses years", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
  });
});

describe("addDays", () => {
  it.each([
    ["2026-03-28", 1, "2026-03-29"], // EU DST start
    ["2026-03-29", 1, "2026-03-30"],
    ["2026-10-24", 1, "2026-10-25"], // EU DST end
    ["2026-10-25", 1, "2026-10-26"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2028-02-28", 1, "2028-02-29"], // leap year
    ["2028-02-29", 1, "2028-03-01"],
    ["2027-02-28", 1, "2027-03-01"],
    ["2026-01-01", -1, "2025-12-31"],
    ["2026-10-19", 0, "2026-10-19"],
  ])("%s + %i = %s", (d, n, want) => {
    expect(addDays(d, n)).toBe(want);
  });

  it("round-trips with diffDays", () => {
    fc.assert(
      fc.property(fc.integer({ min: -2000, max: 2000 }), (n) => {
        expect(diffDays("2026-10-19", addDays("2026-10-19", n))).toBe(n);
      }),
    );
  });
});

describe("parseLocalDate", () => {
  it("rejects impossible dates", () => {
    expect(() => parseLocalDate("2026-02-30")).toThrow();
    expect(() => parseLocalDate("2026-13-01")).toThrow();
    expect(() => parseLocalDate("2026-1-01")).toThrow();
    expect(parseLocalDate("2028-02-29")).toEqual({ y: 2028, m: 2, d: 29 });
  });
});

describe("weeks", () => {
  it("weekStartOf", () => {
    expect(dayOfWeek("2026-10-18")).toBe(0); // Sunday
    expect(weekStartOf("2026-10-18", 1)).toBe("2026-10-12");
    expect(weekStartOf("2026-10-19", 1)).toBe("2026-10-19");
    expect(weekStartOf("2026-10-18", 0)).toBe("2026-10-18");
    expect(weekStartOf("2026-10-18", 6)).toBe("2026-10-17");
    expect(weekStartOf("2026-10-16", 6)).toBe("2026-10-10");
  });

  it("weekDays has 7 consecutive days", () => {
    expect(weekDays("2026-10-19")).toEqual([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
    ]);
  });

  it("weekShiftDays", () => {
    expect(weekShiftDays(1, 0)).toBe(-1);
    expect(weekShiftDays(1, 6)).toBe(-2);
    expect(weekShiftDays(0, 1)).toBe(1);
    expect(weekShiftDays(6, 1)).toBe(2);
    expect(weekShiftDays(1, 1)).toBe(0);
  });

  it("weekShiftDays maps each week start onto the new week start", () => {
    const starts = [1, 0, 6] as const;
    for (const from of starts)
      for (const to of starts) {
        const shift = weekShiftDays(from, to);
        expect(Math.abs(shift)).toBeLessThanOrEqual(3);
        const ws = weekStartOf("2026-10-19", from);
        expect(dayOfWeek(addDays(ws, shift))).toBe(to);
      }
  });

  it("isoWeek", () => {
    expect(isoWeek("2026-10-19")).toEqual({ year: 2026, week: 43 });
    expect(isoWeek("2026-01-01")).toEqual({ year: 2026, week: 1 });
    expect(isoWeek("2027-01-01")).toEqual({ year: 2026, week: 53 });
    expect(isoWeek("2024-12-30")).toEqual({ year: 2025, week: 1 });
  });
});

describe("formatting and parsing", () => {
  it("formatMinute", () => {
    expect(formatMinute(0)).toBe("00:00");
    expect(formatMinute(555)).toBe("09:15");
    expect(formatMinute(1440)).toBe("24:00");
  });

  it.each([
    [0, "12:00 AM"],
    [5, "12:05 AM"],
    [555, "9:15 AM"],
    [720, "12:00 PM"],
    [779, "12:59 PM"],
    [780, "1:00 PM"],
    [1439, "11:59 PM"],
    [1440, "12:00 AM"],
  ])("formatMinute(%i, 12h) = %s", (min, want) => {
    expect(formatMinute(min, "12h")).toBe(want);
  });

  it("formatMinuteRange", () => {
    expect(formatMinuteRange(540, 630)).toBe("09:00–10:30");
    expect(formatMinuteRange(540, 630, "12h")).toBe("9:00–10:30 AM");
    expect(formatMinuteRange(660, 780, "12h")).toBe("11:00 AM–1:00 PM");
    expect(formatMinuteRange(1380, 1440, "12h")).toBe("11:00 PM–12:00 AM");
  });

  it("formatHourLabel", () => {
    expect(formatHourLabel(9)).toBe("09:00");
    expect(formatHourLabel(9, "24h")).toBe("09:00");
    expect(formatHourLabel(0, "12h")).toBe("12 AM");
    expect(formatHourLabel(9, "12h")).toBe("9 AM");
    expect(formatHourLabel(12, "12h")).toBe("12 PM");
    expect(formatHourLabel(23, "12h")).toBe("11 PM");
  });

  it("every minute round-trips through both formats", () => {
    for (let min = 0; min < 1440; min++) {
      expect(parseTimeInput(formatMinute(min, "24h"))).toBe(min);
      expect(parseTimeInput(formatMinute(min, "12h"))).toBe(min);
    }
  });

  it("formatDuration", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(120)).toBe("2h");
    expect(formatDuration(150)).toBe("2h 30m");
    expect(formatDuration(-90)).toBe("−1h 30m");
  });

  it.each([
    ["915", 555],
    ["0915", 555],
    ["9:15", 555],
    ["9.15", 555],
    ["9", 540],
    ["24:00", 1440],
    [" 13:05 ", 785],
    ["0", 0],
    ["9am", 540],
    ["9 AM", 540],
    ["9:30pm", 1290],
    ["9:30 PM", 1290],
    ["930p", 1290],
    ["9.30 p.m.", 1290],
    ["12am", 0],
    ["12:15 AM", 15],
    ["12pm", 720],
    ["12:45pm", 765],
    ["11:59 pm", 1439],
    ["1 PM", 780],
  ])("parseTimeInput(%s) = %i", (s, want) => {
    expect(parseTimeInput(s)).toBe(want);
  });

  it.each(["", "abc", "9:60", "25:00", "24:01", "12345", "9:5", "0am", "13pm", "24am", "9:60pm", "pm", "9 xm", "9amm"])("parseTimeInput(%s) = null", (s) => {
    expect(parseTimeInput(s)).toBeNull();
  });
});

describe("clock", () => {
  it("nowFrom uses local wall clock", () => {
    // Constructed from local components, so the result is TZ-independent.
    expect(nowFrom(new Date(2026, 9, 25, 1, 30))).toEqual({ day: "2026-10-25", minute: 90 });
  });

  it("parseNowOverride", () => {
    expect(parseNowOverride("?seed=demo&now=2026-10-21T14:00")).toEqual({ day: "2026-10-21", minute: 840 });
    expect(parseNowOverride("?now=2026-02-30T14:00")).toBeNull();
    expect(parseNowOverride("?now=2026-10-21T24:00")).toBeNull();
    expect(parseNowOverride("")).toBeNull();
  });
});
