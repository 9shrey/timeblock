/**
 * Minimal, pure RFC 5545 (iCalendar) support: just enough to import a `.ics` file as a
 * read-only overlay, and to export the plan/actual blocks for a date range.
 *
 * We hand-roll this instead of pulling in a library (the app already hand-rolls its own
 * date/time domain in `src/domain/time`): the subset we need — single VEVENTs with a
 * DTSTART/DTEND, no recurrence expansion, no time zone database — is small, and the
 * existing well-known parsers (e.g. `ical.js`) pull in a much bigger surface (VTIMEZONE,
 * RRULE expansion, alarms) than a read-only, non-recurring overlay needs.
 *
 * Only DATE-TIME events are imported; all-day (VALUE=DATE) events and recurring events
 * (RRULE) are reported as skipped rather than guessed at, since the app's block model
 * has no concept of either.
 */
import type { LocalDate, Minute } from "../types";
import { diffDays } from "../time/localDate";

export interface IcsEvent {
  uid: string;
  summary: string;
  day: LocalDate;
  startMinute: Minute;
  /** 1..1440; clipped to 1440 (midnight) if the source event crossed into the next day. */
  endMinute: Minute;
  /** True if DTEND fell on a later calendar day and was clipped to this day's midnight. */
  clipped: boolean;
}

export interface IcsParseResult {
  events: IcsEvent[];
  /** Human-readable reasons an entry was left out (all-day, recurring, unparseable). */
  skipped: string[];
}

function unfold(text: string): string[] {
  // RFC 5545 §3.1: a line that starts with a space or tab continues the previous line.
  const raw = text.split(/\r\n|\n|\r/);
  const lines: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

function parseLine(line: string): Prop | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = head.split(";");
  const name = parts[0]!.toUpperCase();
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=");
    if (eq < 0) continue;
    params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
  }
  return { name, params, value };
}

function unescapeText(s: string): string {
  return s.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

/** Parses a DATE-TIME or DATE value into a local day + minute-of-day (floating local time). */
function parseDateTime(prop: Prop): { day: LocalDate; minute: Minute } | { allDay: true } | null {
  const v = prop.value.trim();
  if (prop.params.VALUE === "DATE" || /^\d{8}$/.test(v)) return { allDay: true };
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!m) return null;
  const [, y, mo, d, hh, mm] = m;
  const day = `${y}-${mo}-${d}` as LocalDate;
  const minute = Number(hh) * 60 + Number(mm);
  // Z (UTC) and TZID both need a real IANA tz database to convert correctly; we treat every
  // DATE-TIME as the organiser's local wall-clock time (a "floating" time), which is the
  // closest approximation without one. This is called out in the import summary.
  return { day, minute };
}

/** Parses the VEVENTs in an .ics file's contents. Never throws; unparseable input yields 0 events. */
export function parseIcs(text: string): IcsParseResult {
  const events: IcsEvent[] = [];
  const skipped: string[] = [];
  const lines = unfold(text);
  let inEvent = false;
  let uid = "";
  let summary = "";
  let dtstart: ReturnType<typeof parseDateTime> = null;
  let dtend: ReturnType<typeof parseDateTime> = null;
  let rrule = false;

  const flush = () => {
    if (!inEvent) return;
    const label = summary || uid || "(untitled event)";
    if (rrule) {
      skipped.push(`${label}: recurring events aren't imported`);
    } else if (!dtstart || "allDay" in dtstart) {
      skipped.push(`${label}: all-day events aren't imported`);
    } else if (!dtend || "allDay" in dtend) {
      skipped.push(`${label}: all-day events aren't imported`);
    } else {
      const dayDiff = diffDays(dtstart.day, dtend.day);
      let endMinute = dtend.minute;
      let clipped = false;
      if (dayDiff > 0 || (dayDiff === 0 && dtend.minute <= dtstart.minute)) {
        endMinute = 1440;
        clipped = true;
      }
      if (endMinute <= dtstart.minute) {
        skipped.push(`${label}: couldn't determine a valid time range`);
      } else {
        events.push({
          uid: uid || `${dtstart.day}-${dtstart.minute}-${label}`,
          summary: summary || "Untitled",
          day: dtstart.day,
          startMinute: dtstart.minute,
          endMinute,
          clipped,
        });
      }
    }
  };

  for (const line of lines) {
    const prop = parseLine(line);
    if (!prop) continue;
    if (prop.name === "BEGIN" && prop.value.toUpperCase() === "VEVENT") {
      inEvent = true;
      uid = "";
      summary = "";
      dtstart = null;
      dtend = null;
      rrule = false;
      continue;
    }
    if (prop.name === "END" && prop.value.toUpperCase() === "VEVENT") {
      flush();
      inEvent = false;
      continue;
    }
    if (!inEvent) continue;
    switch (prop.name) {
      case "UID":
        uid = prop.value.trim();
        break;
      case "SUMMARY":
        summary = unescapeText(prop.value.trim());
        break;
      case "DTSTART":
        dtstart = parseDateTime(prop);
        break;
      case "DTEND":
        dtend = parseDateTime(prop);
        break;
      case "RRULE":
        rrule = true;
        break;
      default:
        break;
    }
  }
  return { events, skipped };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toIcsDateTime(day: LocalDate, minute: Minute): string {
  const [y, m, d] = day.split("-");
  const hh = Math.floor(minute / 60) % 24;
  const mm = minute % 60;
  return `${y}${m}${d}T${pad2(hh)}${pad2(mm)}00`;
}

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/** Folds a content line to the RFC 5545-recommended 75 octets, continuation lines indented by one space. */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 0) {
    parts.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  return parts.join("\r\n");
}

export interface IcsExportItem {
  uid: string;
  summary: string;
  description?: string;
  day: LocalDate;
  startMinute: Minute;
  endMinute: Minute;
  /** Written as DTSTAMP and used to fold into the generated UID when none is given. */
  stamp: number;
}

/** Builds a VCALENDAR with one VEVENT per item. Pure text in, text out. */
export function buildIcs(items: readonly IcsExportItem[]): string {
  const lines: string[] = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Timeblock//Timeblock Export//EN", "CALSCALE:GREGORIAN"];
  for (const item of items) {
    const stampDate = new Date(item.stamp);
    const stamp = `${stampDate.getUTCFullYear()}${pad2(stampDate.getUTCMonth() + 1)}${pad2(stampDate.getUTCDate())}T${pad2(
      stampDate.getUTCHours(),
    )}${pad2(stampDate.getUTCMinutes())}${pad2(stampDate.getUTCSeconds())}Z`;
    lines.push(
      "BEGIN:VEVENT",
      fold(`UID:${item.uid}`),
      fold(`DTSTAMP:${stamp}`),
      fold(`DTSTART:${toIcsDateTime(item.day, item.startMinute)}`),
      fold(`DTEND:${toIcsDateTime(item.day, item.endMinute)}`),
      fold(`SUMMARY:${escapeText(item.summary)}`),
    );
    if (item.description) lines.push(fold(`DESCRIPTION:${escapeText(item.description)}`));
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
