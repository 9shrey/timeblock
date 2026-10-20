/**
 * Turns iCalendar (RFC 5545) text into read-only overlay events, using `ical.js` for the
 * parsing, recurrence rules and time zones.
 *
 * - Recurring series (`RRULE`/`RDATE`, minus `EXDATE`) are expanded only within a date range,
 *   since an open-ended series has no last occurrence. Overrides (`RECURRENCE-ID`) replace
 *   the occurrence they name; cancelled events and occurrences are dropped.
 * - A UTC time, or a `TZID` time whose zone is defined by the file's `VTIMEZONE` (Google and
 *   Outlook both include one) or known to the platform's `Intl` (IANA names), is converted to
 *   this machine's wall clock. A floating time, or one with an unknown `TZID`, is taken at
 *   face value.
 * - A timed event that runs past midnight is clipped to the end of its start day; an all-day
 *   event spanning several days shows up on each of them.
 */
import ICAL from "ical.js";
import { instantOf, nowFrom } from "../time/clock";
import { addDays, formatYMD } from "../time/localDate";
import type { LocalDate, Minute } from "../types";

export interface IcsEvent {
  id: string;
  title: string;
  day: LocalDate;
  startMinute: Minute;
  /** Always greater than `startMinute`; an event that runs past midnight is clipped to 1440. */
  endMinute: Minute;
  allDay: boolean;
}

/** Expansion window, `from` inclusive and `to` exclusive. */
export interface IcsRange {
  from: LocalDate;
  to: LocalDate;
}

/** One `UID`: its main `VEVENT` (if any) and the overrides of single occurrences. */
interface Series {
  key: string;
  master: ICAL.Component | null;
  overrides: ICAL.Component[];
}

/** A parsed calendar, ready to be expanded for any range by `expandCalendar`. */
export interface ParsedCalendar {
  series: Series[];
}

/** Stops a pathological rule (say, `FREQ=MINUTELY` from 1990) from hanging the app. */
const MAX_STEPS_PER_SERIES = 20_000;
/** An all-day event longer than this only shows on its first this-many days. */
const MAX_ALL_DAY_SPAN = 62;
/** Slack around the range when comparing instants, so time-zone shifts never drop an edge day. */
const SLACK_MS = 2 * 86_400_000;
const DEFAULT_LENGTH_MIN = 60;

const UNBOUNDED: IcsRange = { from: "1900-01-01", to: "9999-12-31" };

/** Parses `.ics` text. Throws when the text isn't an iCalendar file at all. */
export function parseCalendar(text: string): ParsedCalendar {
  const trimmed = text.trim();
  if (!/^BEGIN:VCALENDAR/i.test(trimmed)) throw new Error("This doesn't look like a calendar (.ics) file.");
  const parsed: unknown = ICAL.parse(markBareDates(trimmed));
  // Several concatenated VCALENDARs parse to an array of jCal arrays.
  const roots = Array.isArray(parsed) && Array.isArray(parsed[0]) ? (parsed as unknown[]) : [parsed];
  const byKey = new Map<string, Series>();
  let index = 0;
  for (const jcal of roots) {
    const root = new ICAL.Component(jcal as unknown as string);
    for (const vevent of root.getAllSubcomponents("vevent")) {
      const fallback = `ics-${index++}`;
      if (!vevent.hasProperty("dtstart")) continue;
      const uid = String(vevent.getFirstPropertyValue("uid") ?? "").trim();
      const isOverride = vevent.hasProperty("recurrence-id");
      // Without a UID, an event can't be matched with anything, so it stands alone.
      const key = uid || fallback;
      let series = byKey.get(key);
      if (!series) {
        series = { key, master: null, overrides: [] };
        byKey.set(key, series);
      }
      if (isOverride && uid) series.overrides.push(vevent);
      else if (!series.master) series.master = vevent;
    }
  }
  return { series: [...byKey.values()] };
}

/** Every occurrence that starts on a day in `range`, sorted by day and start time. */
export function expandCalendar(calendar: ParsedCalendar, range: IcsRange): IcsEvent[] {
  const out: IcsEvent[] = [];
  const bounds = { fromMs: instantOf(range.from) - SLACK_MS, toMs: instantOf(range.to) + SLACK_MS };
  for (const series of calendar.series) {
    try {
      expandSeries(series, range, bounds, out);
    } catch {
      // One malformed event (a bad RRULE, say) shouldn't hide the rest of the calendar.
    }
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.startMinute - b.startMinute || a.id.localeCompare(b.id));
}

/** Parses `.ics` text and expands it for `range` (default: every day, with recurring series capped). */
export function parseIcs(text: string, range: IcsRange = UNBOUNDED): IcsEvent[] {
  return expandCalendar(parseCalendar(text), range);
}

/**
 * Adds `VALUE=DATE` to date properties whose value is a bare date (`DTSTART:20261022`). RFC
 * 5545 requires the parameter, but some exporters leave it out, and `ical.js` would then
 * reject the value as a malformed date-time.
 */
function markBareDates(text: string): string {
  return text.replace(/^(DTSTART|DTEND|RECURRENCE-ID|EXDATE|RDATE)((?:;[^:\r\n]*)?):(\d{8}(?:,\d{8})*)(\r?)$/gim, (line, name: string, params: string, value: string, cr: string) =>
    /;VALUE=/i.test(params) ? line : `${name}${params};VALUE=DATE:${value}${cr}`,
  );
}

function expandSeries(series: Series, range: IcsRange, bounds: { fromMs: number; toMs: number }, out: IcsEvent[]): void {
  const { master } = series;
  if (!master) {
    // Overrides of a series this file doesn't contain (an invite to a single occurrence).
    for (const o of series.overrides) {
      const ev = new ICAL.Event(o);
      push(out, `${series.key}#${ev.recurrenceId.toString()}`, o, ev.startDate, ev.endDate, range);
    }
    return;
  }

  const event = new ICAL.Event(master, { strictExceptions: false });
  if (!event.isRecurring()) {
    push(out, series.key, master, event.startDate, event.endDate, range);
    return;
  }
  for (const o of series.overrides) event.relateException(o);

  const seen = new Set<string>();
  const it = event.iterator();
  for (let step = 0, next = it.next(); next && step < MAX_STEPS_PER_SERIES; step++, next = it.next()) {
    const ridMs = instantMs(next, master, "dtstart");
    if (ridMs > bounds.toMs) break;
    const rid = next.toString();
    seen.add(rid);
    const details = event.getOccurrenceDetails(next);
    if (instantMs(details.endDate, details.item.component, "dtend") < bounds.fromMs) continue;
    push(out, `${series.key}#${rid}`, details.item.component, details.startDate, details.endDate, range);
  }
  // An override can move an occurrence from beyond the range (where iteration stopped) into it.
  for (const o of series.overrides) {
    const ev = new ICAL.Event(o);
    const rid = ev.recurrenceId.toString();
    if (seen.has(rid) || instantMs(ev.recurrenceId, o, "recurrence-id") <= bounds.toMs) continue;
    push(out, `${series.key}#${rid}`, o, ev.startDate, ev.endDate, range);
  }
}

function push(out: IcsEvent[], id: string, component: ICAL.Component, start: ICAL.Time, end: ICAL.Time | null, range: IcsRange): void {
  const status = String(component.getFirstPropertyValue("status") ?? "").toUpperCase();
  if (status === "CANCELLED") return;
  const title = titleOf(component);
  const inRange = (day: LocalDate) => day >= range.from && day < range.to;

  if (start.isDate) {
    const first = formatYMD({ y: start.year, m: start.month, d: start.day });
    let days = 1;
    if (end?.isDate) {
      const last = formatYMD({ y: end.year, m: end.month, d: end.day }); // exclusive
      while (days < MAX_ALL_DAY_SPAN && addDays(first, days) < last) days++;
    }
    for (let i = 0; i < days; i++) {
      const day = addDays(first, i);
      if (inRange(day)) out.push({ id: days > 1 ? `${id}@${day}` : id, title, day, startMinute: 0, endMinute: 1440, allDay: true });
    }
    return;
  }

  const s = wallClock(start, component, "dtstart");
  if (!inRange(s.day)) return;
  let endMinute = s.minute + DEFAULT_LENGTH_MIN;
  if (end && !end.isDate) {
    // An override's own DTEND may carry a different TZID than the master's.
    const e = wallClock(end, component, component.hasProperty("dtend") ? "dtend" : "dtstart");
    if (e.day === s.day && e.minute > s.minute) endMinute = e.minute;
    else if (e.day > s.day) endMinute = 1440;
  }
  out.push({ id, title, day: s.day, startMinute: s.minute, endMinute: Math.min(endMinute, 1440), allDay: false });
}

function titleOf(component: ICAL.Component): string {
  const summary = component.getFirstPropertyValue("summary");
  const text = typeof summary === "string" ? summary.replace(/\s*[\r\n]+\s*/g, " ").trim() : "";
  return text || "Untitled";
}

// ---------------------------------------------------------------------------
// Time zones
// ---------------------------------------------------------------------------

/**
 * The UTC instant of `t`, or null when it's floating (no zone, or a TZID neither the file nor
 * `Intl` knows). `prop` names the property `t` came from, for its `TZID` parameter.
 */
function zonedMs(t: ICAL.Time, component: ICAL.Component, prop: string): number | null {
  const tzid = t.zone?.tzid;
  if (t.zone && tzid !== "floating") return t.toUnixTime() * 1000;
  const named = tzidParam(component, prop);
  return named ? intlZonedMs(named, t) : null;
}

/** Like `zonedMs`, with floating times read as this machine's local time. For range checks only. */
function instantMs(t: ICAL.Time, component: ICAL.Component, prop: string): number {
  return zonedMs(t, component, prop) ?? instantOf(formatYMD({ y: t.year, m: t.month, d: t.day }), t.hour * 60 + t.minute);
}

function wallClock(t: ICAL.Time, component: ICAL.Component, prop: string): { day: LocalDate; minute: Minute } {
  const ms = zonedMs(t, component, prop);
  if (ms === null) return { day: formatYMD({ y: t.year, m: t.month, d: t.day }), minute: t.hour * 60 + t.minute };
  return nowFrom(new Date(ms));
}

function tzidParam(component: ICAL.Component, prop: string): string | null {
  const value = component.getFirstProperty(prop)?.getParameter("tzid");
  const tzid = Array.isArray(value) ? value[0] : value;
  return typeof tzid === "string" && tzid ? tzid.replace(/^\//, "") : null;
}

const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatterFor(tzid: string): Intl.DateTimeFormat | null {
  if (!formatters.has(tzid)) {
    try {
      formatters.set(
        tzid,
        new Intl.DateTimeFormat("en-US", {
          timeZone: tzid,
          hourCycle: "h23",
          year: "numeric",
          month: "numeric",
          day: "numeric",
          hour: "numeric",
          minute: "numeric",
          second: "numeric",
        }),
      );
    } catch {
      formatters.set(tzid, null); // not an IANA name (e.g. a Windows zone name)
    }
  }
  return formatters.get(tzid) ?? null;
}

/** `zone`'s offset from UTC at instant `ms`, in milliseconds. */
function offsetMs(fmt: Intl.DateTimeFormat, ms: number): number {
  const parts: Record<string, number> = {};
  for (const p of fmt.formatToParts(new Date(ms))) if (p.type !== "literal") parts[p.type] = Number(p.value);
  const asUtc = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** The instant at which the wall clock in IANA zone `tzid` reads `t`, or null for an unknown zone. */
function intlZonedMs(tzid: string, t: ICAL.Time): number | null {
  const fmt = formatterFor(tzid);
  if (!fmt) return null;
  const wall = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  // Two passes settle on the right offset everywhere except inside a DST gap, where any nearby instant will do.
  let ms = wall - offsetMs(fmt, wall);
  ms = wall - offsetMs(fmt, ms);
  return ms;
}
