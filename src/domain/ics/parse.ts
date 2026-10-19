/**
 * A pure, minimal parser for the subset of RFC 5545 (iCalendar) that real-world exports
 * actually need for a read-only overlay: unfolded `VEVENT` blocks with `DTSTART`/`DTEND`
 * and `SUMMARY`. Recurring events (`RRULE`) are not expanded — each `VEVENT` becomes at
 * most one overlay event, which covers the common case of single meetings and appointments.
 *
 * Timeblock has no timezone database: a UTC (`Z`-suffixed) timestamp is converted to this
 * machine's wall-clock local time (correct, since that's exactly what the overlay should
 * show); a floating or `TZID`-qualified timestamp is taken at face value, on the assumption
 * that its wall-clock time already matches the viewer's.
 */
import { nowFrom } from "../time/clock";
import { formatYMD } from "../time/localDate";
import type { LocalDate, Minute } from "../types";

export interface IcsEvent {
  id: string;
  title: string;
  day: LocalDate;
  startMinute: Minute;
  /** May be less than `startMinute` is never true; an event that runs past midnight is clipped to 1440. */
  endMinute: Minute;
  allDay: boolean;
}

interface Prop {
  params: Record<string, string>;
  value: string;
}

function unfold(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r\n|\n|\r/)) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && out.length > 0) out[out.length - 1] += raw.slice(1);
    else out.push(raw);
  }
  return out;
}

function unescapeText(s: string): string {
  return s.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

function parseLine(line: string): { name: string; prop: Prop } | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const [name, ...paramParts] = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const part of paramParts) {
    const eq = part.indexOf("=");
    if (eq >= 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  return { name: (name ?? "").toUpperCase(), prop: { params, value: line.slice(colon + 1) } };
}

const STAMP_RE = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/;

function parseStamp(prop: Prop): { day: LocalDate; minute: Minute; allDay: boolean } {
  const m = STAMP_RE.exec(prop.value.trim());
  if (!m) throw new Error(`Unrecognized date-time: ${prop.value}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!m[4]) return { day: formatYMD({ y, m: mo, d }), minute: 0, allDay: true };
  const h = Number(m[4]);
  const mi = Number(m[5]);
  if (m[7]) {
    // UTC: converted to this machine's local wall clock.
    const now = nowFrom(new Date(Date.UTC(y, mo - 1, d, h, mi)));
    return { day: now.day, minute: now.minute, allDay: false };
  }
  return { day: formatYMD({ y, m: mo, d }), minute: h * 60 + mi, allDay: false };
}

function eventFrom(props: Map<string, Prop>, index: number): IcsEvent | null {
  const dtstart = props.get("DTSTART");
  if (!dtstart) return null;
  let start;
  try {
    start = parseStamp(dtstart);
  } catch {
    return null;
  }
  const summary = props.get("SUMMARY");
  const title = summary ? unescapeText(summary.value.trim()) || "Untitled" : "Untitled";
  const id = props.get("UID")?.value.trim() || `ics-${index}`;

  if (start.allDay) return { id, title, day: start.day, startMinute: 0, endMinute: 1440, allDay: true };

  const dtend = props.get("DTEND");
  let endMinute = start.minute + 60; // default length when DTEND is missing or malformed
  if (dtend) {
    try {
      const end = parseStamp(dtend);
      if (!end.allDay && end.day === start.day && end.minute > start.minute) endMinute = end.minute;
      else if (end.day > start.day) endMinute = 1440; // runs past midnight: clip to end of day
    } catch {
      // keep the default length
    }
  }
  return { id, title, day: start.day, startMinute: start.minute, endMinute, allDay: false };
}

/** Parses every `VEVENT` in an `.ics` file into overlay events, skipping ones without a usable `DTSTART`. */
export function parseIcs(text: string): IcsEvent[] {
  const events: IcsEvent[] = [];
  let current: Map<string, Prop> | null = null;
  let index = 0;
  for (const raw of unfold(text)) {
    const line = raw.trim();
    if (line === "BEGIN:VEVENT") {
      current = new Map();
      continue;
    }
    if (line === "END:VEVENT") {
      if (current) {
        const event = eventFrom(current, index++);
        if (event) events.push(event);
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const parsed = parseLine(line);
    if (parsed) current.set(parsed.name, parsed.prop);
  }
  return events;
}
