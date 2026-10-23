import { describe, expect, it } from "vitest";
import { nowFrom } from "../time/clock";
import { expandCalendar, parseCalendar, parseIcs, type IcsEvent, type IcsRange } from "./parse";
import googleRecurring from "./fixtures/google-recurring.ics?raw";
import outlookWindowsTz from "./fixtures/outlook-windows-tz.ics?raw";

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

// Expected values are UTC instants converted with the same Date-based conversion the app uses,
// so these tests hold in any zone (`npm run test:tz` runs them in UTC and Pacific/Chatham).
const at = (iso: string, minutes = 30) => {
  const start = nowFrom(new Date(iso));
  return { day: start.day, startMinute: start.minute, endMinute: Math.min(start.minute + minutes, 1440) };
};
const timed = (events: IcsEvent[]) => events.filter((e) => !e.allDay);
const brief = (events: IcsEvent[]) => events.map(({ title, day, startMinute, endMinute }) => ({ title, day, startMinute, endMinute }));
/** Wide enough that every fixture occurrence lands inside it, whatever the local zone. */
const WIDE: IcsRange = { from: "2026-10-01", to: "2026-12-01" };

const STANDUPS = [
  { title: "Standup", ...at("2026-10-19T13:00:00Z") },
  { title: "Standup (moved)", ...at("2026-10-21T15:00:00Z") },
  { title: "Standup", ...at("2026-10-26T13:00:00Z") },
  { title: "Standup", ...at("2026-10-30T13:00:00Z") },
  { title: "Standup (pulled forward)", ...at("2026-10-31T14:00:00Z") },
  // New York leaves daylight saving time on 2026-11-01: 09:00 local is now 14:00 UTC.
  { title: "Standup", ...at("2026-11-02T14:00:00Z") },
  { title: "Standup", ...at("2026-11-04T14:00:00Z") },
  { title: "Standup", ...at("2026-11-06T14:00:00Z") },
  { title: "Standup", ...at("2026-11-09T14:00:00Z") },
  { title: "Standup", ...at("2026-11-11T14:00:00Z") },
];
const DAILY = [0, 1, 2].map((i) => ({ title: "Daily sync", ...at(`2026-10-${20 + i}T16:00:00Z`, 60) }));
const byStart = (a: { day: string; startMinute: number }, b: { day: string; startMinute: number }) =>
  a.day.localeCompare(b.day) || a.startMinute - b.startMinute;

describe("parseIcs: recurrence and time zones", () => {
  const calendar = parseCalendar(googleRecurring);

  it("expands RRULE, skips EXDATE and cancelled occurrences, applies RECURRENCE-ID overrides, across a DST change", () => {
    const standups = timed(expandCalendar(calendar, WIDE)).filter((e) => e.title.startsWith("Standup"));
    expect(brief(standups)).toEqual([...STANDUPS].sort(byStart));
  });

  it("gives every occurrence of a series its own id", () => {
    const ids = expandCalendar(calendar, WIDE).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("standup@google.com#2026-10-19T09:00:00");
  });

  it("expands a COUNT-limited UTC series", () => {
    expect(brief(timed(expandCalendar(calendar, WIDE)).filter((e) => e.title === "Daily sync"))).toEqual(DAILY);
  });

  it("only returns occurrences that start on a day inside the range", () => {
    const range: IcsRange = { from: "2026-10-27", to: "2026-11-05" };
    const inRange = [...STANDUPS, ...DAILY].filter((e) => e.day >= range.from && e.day < range.to).sort(byStart);
    expect(brief(timed(expandCalendar(calendar, range)))).toEqual(inRange);
  });

  it("includes an override that moves an occurrence from beyond the range into it", () => {
    const range: IcsRange = { from: "2026-10-01", to: "2026-11-03" };
    const titles = expandCalendar(calendar, range).map((e) => e.title);
    expect(titles).toContain("Standup (pulled forward)");
  });

  it("shows a multi-day all-day event on each of its days", () => {
    const offsite = expandCalendar(calendar, WIDE).filter((e) => e.title === "Offsite");
    expect(offsite.map((e) => [e.day, e.allDay, e.startMinute, e.endMinute])).toEqual([
      ["2026-10-22", true, 0, 1440],
      ["2026-10-23", true, 0, 1440],
      ["2026-10-24", true, 0, 1440],
    ]);
  });

  it("uses a VTIMEZONE defined in the file, even under a Windows zone name", () => {
    const [event] = parseIcs(outlookWindowsTz);
    expect(brief([event!])).toEqual([{ title: "Planning", ...at("2026-10-21T07:00:00Z", 60) }]);
  });

  it("falls back to the platform's time zone data for an IANA TZID with no VTIMEZONE", () => {
    const [event] = parseIcs(
      ics("BEGIN:VEVENT", "UID:berlin", "SUMMARY:Berlin", "DTSTART;TZID=Europe/Berlin:20261021T090000", "DTEND;TZID=Europe/Berlin:20261021T100000", "END:VEVENT"),
    );
    expect(brief([event!])).toEqual([{ title: "Berlin", ...at("2026-10-21T07:00:00Z", 60) }]);
  });

  it("takes an unknown TZID with no VTIMEZONE at face value", () => {
    const [event] = parseIcs(
      ics("BEGIN:VEVENT", "UID:x", "SUMMARY:Mystery", "DTSTART;TZID=Somewhere Standard Time:20261021T090000", "DTEND;TZID=Somewhere Standard Time:20261021T100000", "END:VEVENT"),
    );
    expect(event).toMatchObject({ day: "2026-10-21", startMinute: 540, endMinute: 600 });
  });

  it("expands an endless series only within the range", () => {
    const events = parseIcs(
      ics("BEGIN:VEVENT", "UID:w", "SUMMARY:Weekly", "DTSTART:20200106T090000", "DTEND:20200106T100000", "RRULE:FREQ=WEEKLY", "END:VEVENT"),
      { from: "2026-10-19", to: "2026-11-02" },
    );
    expect(events.map((e) => e.day)).toEqual(["2026-10-19", "2026-10-26"]);
  });

  it("shows overrides whose series isn't in the file", () => {
    const events = parseIcs(
      ics("BEGIN:VEVENT", "UID:only-one", "RECURRENCE-ID:20261021T090000", "SUMMARY:One instance", "DTSTART:20261021T090000", "DTEND:20261021T100000", "END:VEVENT"),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ title: "One instance", day: "2026-10-21", startMinute: 540 });
  });

  it("rejects text that isn't a calendar", () => {
    expect(() => parseIcs("<!doctype html><html></html>")).toThrow(/calendar/);
  });
});
