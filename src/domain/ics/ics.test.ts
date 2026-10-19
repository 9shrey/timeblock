import { describe, expect, it } from "vitest";
import { buildIcs, parseIcs } from "./ics";

const VCAL = (body: string) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//EN", body, "END:VCALENDAR"].join("\r\n");

describe("parseIcs", () => {
  it("parses a simple timed VEVENT", () => {
    const text = VCAL(
      [
        "BEGIN:VEVENT",
        "UID:abc-123",
        "SUMMARY:Standup",
        "DTSTART:20260419T090000",
        "DTEND:20260419T093000",
        "END:VEVENT",
      ].join("\r\n"),
    );
    const { events, skipped } = parseIcs(text);
    expect(skipped).toEqual([]);
    expect(events).toEqual([
      { uid: "abc-123", summary: "Standup", day: "2026-04-19", startMinute: 540, endMinute: 570, clipped: false },
    ]);
  });

  it("unfolds continuation lines", () => {
    const text = VCAL(
      ["BEGIN:VEVENT", "UID:folded", "SUMMARY:Very long ti", " tle that wraps", "DTSTART:20260419T090000", "DTEND:20260419T100000", "END:VEVENT"].join(
        "\r\n",
      ),
    );
    const { events } = parseIcs(text);
    expect(events[0]?.summary).toBe("Very long title that wraps");
  });

  it("skips all-day events", () => {
    const text = VCAL(["BEGIN:VEVENT", "UID:allday", "SUMMARY:Holiday", "DTSTART;VALUE=DATE:20260419", "DTEND;VALUE=DATE:20260420", "END:VEVENT"].join("\r\n"));
    const { events, skipped } = parseIcs(text);
    expect(events).toEqual([]);
    expect(skipped[0]).toMatch(/all-day/);
  });

  it("skips recurring events (RRULE)", () => {
    const text = VCAL(
      [
        "BEGIN:VEVENT",
        "UID:recur",
        "SUMMARY:Weekly sync",
        "DTSTART:20260419T090000",
        "DTEND:20260419T093000",
        "RRULE:FREQ=WEEKLY",
        "END:VEVENT",
      ].join("\r\n"),
    );
    const { events, skipped } = parseIcs(text);
    expect(events).toEqual([]);
    expect(skipped[0]).toMatch(/recurring/);
  });

  it("clips an event that crosses midnight to end-of-day", () => {
    const text = VCAL(
      ["BEGIN:VEVENT", "UID:cross", "SUMMARY:Overnight", "DTSTART:20260419T230000", "DTEND:20260420T010000", "END:VEVENT"].join("\r\n"),
    );
    const { events } = parseIcs(text);
    expect(events).toEqual([{ uid: "cross", summary: "Overnight", day: "2026-04-19", startMinute: 1380, endMinute: 1440, clipped: true }]);
  });

  it("treats a trailing Z as a floating local time (no tz database)", () => {
    const text = VCAL(["BEGIN:VEVENT", "UID:z", "SUMMARY:UTC", "DTSTART:20260419T090000Z", "DTEND:20260419T100000Z", "END:VEVENT"].join("\r\n"));
    const { events } = parseIcs(text);
    expect(events[0]).toMatchObject({ day: "2026-04-19", startMinute: 540, endMinute: 600 });
  });

  it("returns no events for garbage input", () => {
    expect(parseIcs("not an ics file at all").events).toEqual([]);
  });
});

describe("buildIcs", () => {
  it("round-trips through parseIcs", () => {
    const text = buildIcs([
      { uid: "u1", summary: "Thesis", day: "2026-04-19", startMinute: 540, endMinute: 630, stamp: Date.UTC(2026, 3, 19, 8) },
    ]);
    expect(text).toContain("BEGIN:VEVENT");
    expect(text).toContain("SUMMARY:Thesis");
    const { events } = parseIcs(text);
    expect(events).toEqual([{ uid: "u1", summary: "Thesis", day: "2026-04-19", startMinute: 540, endMinute: 630, clipped: false }]);
  });

  it("escapes special characters in SUMMARY", () => {
    const text = buildIcs([
      { uid: "u2", summary: "Goal; review, notes\nmore", day: "2026-04-19", startMinute: 540, endMinute: 600, stamp: 0 },
    ]);
    expect(text).toContain("SUMMARY:Goal\\; review\\, notes\\nmore");
  });

  it("folds long lines at 75 octets", () => {
    const longSummary = "x".repeat(200);
    const text = buildIcs([{ uid: "u3", summary: longSummary, day: "2026-04-19", startMinute: 0, endMinute: 60, stamp: 0 }]);
    const summaryLineStart = text.indexOf("SUMMARY:");
    const nextCrlf = text.indexOf("\r\n", summaryLineStart);
    expect(nextCrlf - summaryLineStart).toBeLessThanOrEqual(75);
  });
});
