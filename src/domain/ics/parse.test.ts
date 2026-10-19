import { describe, expect, it } from "vitest";
import { parseIcs } from "./parse";

const ics = (...lines: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...lines, "END:VCALENDAR"].join("\r\n");

describe("parseIcs", () => {
  it("parses a floating-time event", () => {
    const [event] = parseIcs(
      ics("BEGIN:VEVENT", "UID:a@example.com", "SUMMARY:Standup", "DTSTART:20261021T090000", "DTEND:20261021T093000", "END:VEVENT"),
    );
    expect(event).toEqual({ id: "a@example.com", title: "Standup", day: "2026-10-21", startMinute: 540, endMinute: 570, allDay: false });
  });

  it("converts a UTC event to this machine's local wall clock", () => {
    // Just assert it round-trips through the same conversion the test uses, so this test
    // is stable in any timezone the suite runs in (the repo's test:tz script runs both ways).
    const dt = new Date(Date.UTC(2026, 9, 21, 14, 0));
    const [event] = parseIcs(ics("BEGIN:VEVENT", "UID:b", "SUMMARY:Call", "DTSTART:20261021T140000Z", "DTEND:20261021T150000Z", "END:VEVENT"));
    expect(event?.startMinute).toBe(dt.getHours() * 60 + dt.getMinutes());
  });

  it("treats a date-only DTSTART as an all-day event", () => {
    const [event] = parseIcs(ics("BEGIN:VEVENT", "UID:c", "SUMMARY:Conference", "DTSTART:20261022", "DTEND:20261023", "END:VEVENT"));
    expect(event).toEqual({ id: "c", title: "Conference", day: "2026-10-22", startMinute: 0, endMinute: 1440, allDay: true });
  });

  it("defaults to a 60-minute length when DTEND is missing", () => {
    const [event] = parseIcs(ics("BEGIN:VEVENT", "UID:d", "SUMMARY:Quick", "DTSTART:20261021T120000", "END:VEVENT"));
    expect(event?.endMinute).toBe(780);
  });

  it("clips an event that runs past midnight to the end of its start day", () => {
    const [event] = parseIcs(ics("BEGIN:VEVENT", "UID:e", "SUMMARY:Overnight", "DTSTART:20261021T230000", "DTEND:20261022T010000", "END:VEVENT"));
    expect(event?.endMinute).toBe(1440);
  });

  it("unescapes SUMMARY text and unfolds continuation lines", () => {
    const [event] = parseIcs(
      ics("BEGIN:VEVENT", "UID:f", "SUMMARY:Coffee\\, tea\\, and a long ", " summary line", "DTSTART:20261021T090000", "END:VEVENT"),
    );
    expect(event?.title).toBe("Coffee, tea, and a long summary line");
  });

  it("skips a VEVENT with no DTSTART, and assigns a fallback id when UID is missing", () => {
    const events = parseIcs(ics("BEGIN:VEVENT", "SUMMARY:No start", "END:VEVENT", "BEGIN:VEVENT", "SUMMARY:No uid", "DTSTART:20261021T090000", "END:VEVENT"));
    expect(events).toHaveLength(1);
    expect(events[0]!.id).toBe("ics-1");
  });

  it("returns nothing for text with no VEVENT blocks", () => {
    expect(parseIcs("BEGIN:VCALENDAR\r\nEND:VCALENDAR")).toEqual([]);
  });
});
