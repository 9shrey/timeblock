/**
 * Calendar arithmetic on `YYYY-MM-DD` wall-clock dates. All maths goes through
 * `Date.UTC`, so it is independent of the machine's time zone and DST.
 */
import type { LocalDate, Minute, WeekStartDay } from "../types";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export interface YMD {
  y: number;
  m: number; // 1..12
  d: number; // 1..31
}

/** Parses and validates a local date. Throws on malformed or impossible dates. */
export function parseLocalDate(s: LocalDate): YMD {
  const m = DATE_RE.exec(s);
  if (!m) throw new Error(`Invalid date: ${s}`);
  const ymd = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  if (formatYMD(fromUtcMs(toUtcMs(ymd))) !== s) throw new Error(`Invalid date: ${s}`);
  return ymd;
}

export function isLocalDate(s: unknown): s is LocalDate {
  if (typeof s !== "string") return false;
  try {
    parseLocalDate(s);
    return true;
  } catch {
    return false;
  }
}

function toUtcMs({ y, m, d }: YMD): number {
  return Date.UTC(y, m - 1, d);
}

function fromUtcMs(ms: number): YMD {
  const dt = new Date(ms);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export function formatYMD({ y, m, d }: YMD): LocalDate {
  return `${String(y).padStart(4, "0")}-${pad2(m)}-${pad2(d)}`;
}

export function addDays(day: LocalDate, n: number): LocalDate {
  const { y, m, d } = parseLocalDate(day);
  return formatYMD(fromUtcMs(Date.UTC(y, m - 1, d + n)));
}

/** Whole days from `a` to `b` (positive when b is later). */
export function diffDays(a: LocalDate, b: LocalDate): number {
  return Math.round((toUtcMs(parseLocalDate(b)) - toUtcMs(parseLocalDate(a))) / DAY_MS);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(day: LocalDate): number {
  return new Date(toUtcMs(parseLocalDate(day))).getUTCDay();
}

export function weekStartOf(day: LocalDate, ws: WeekStartDay): LocalDate {
  return addDays(day, -((dayOfWeek(day) - ws + 7) % 7));
}

/** The 7 days of the week that starts on `weekStart`. */
export function weekDays(weekStart: LocalDate): LocalDate[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** ISO-8601 week number (for labels only; storage uses week-start dates). */
export function isoWeek(day: LocalDate): { year: number; week: number } {
  // The ISO week belongs to the year of its Thursday.
  const thursday = addDays(day, 3 - ((dayOfWeek(day) + 6) % 7));
  const year = parseLocalDate(thursday).y;
  const jan1 = formatYMD({ y: year, m: 1, d: 1 });
  return { year, week: Math.floor(diffDays(jan1, thursday) / 7) + 1 };
}

/**
 * How far to move an existing week key when the start day changes, chosen in [-3, 3]
 * so each old week maps to the new week it overlaps most. Distinct keys stay distinct.
 */
export function weekShiftDays(from: WeekStartDay, to: WeekStartDay): number {
  const s = (to - from + 7) % 7;
  return s > 3 ? s - 7 : s;
}

export function compareDates(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** "09:05"; 1440 renders as "24:00". */
export function formatMinute(min: Minute): string {
  return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
}

/** "2h 30m", "45m", "3h", "0m". Negative values get a leading "−". */
export function formatDuration(min: number): string {
  const sign = min < 0 ? "−" : "";
  const abs = Math.round(Math.abs(min));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${sign}${m}m`;
  return m === 0 ? `${sign}${h}h` : `${sign}${h}h ${m}m`;
}

/** Hours with at most 2 decimals, trailing zeros trimmed: 90 → "1.5". */
export function formatHours(min: number): string {
  return String(Math.round((min / 60) * 100) / 100);
}

/**
 * Parses user time input: "9", "915", "0915", "9:15", "9.15", "24:00".
 * Returns minutes or null when invalid.
 */
export function parseTimeInput(input: string): Minute | null {
  const s = input.trim();
  let h: number;
  let m: number;
  let match: RegExpExecArray | null;
  if ((match = /^(\d{1,2})[:.](\d{2})$/.exec(s))) {
    h = Number(match[1]);
    m = Number(match[2]);
  } else if ((match = /^(\d{1,2})$/.exec(s))) {
    h = Number(match[1]);
    m = 0;
  } else if ((match = /^(\d{1,2})(\d{2})$/.exec(s))) {
    h = Number(match[1]);
    m = Number(match[2]);
  } else {
    return null;
  }
  if (m > 59) return null;
  const total = h * 60 + m;
  return total >= 0 && total <= 1440 ? total : null;
}

/** "Mon", "Tue", … for a date (English short names; i18n is post-MVP). */
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export function weekdayShort(day: LocalDate): string {
  return WEEKDAY_SHORT[dayOfWeek(day)]!;
}

export function weekdayLong(day: LocalDate): string {
  return WEEKDAY_LONG[dayOfWeek(day)]!;
}

/** "Mon 19 Oct" */
export function formatDayLabel(day: LocalDate): string {
  const { m, d } = parseLocalDate(day);
  return `${weekdayShort(day)} ${d} ${MONTH_SHORT[m - 1]}`;
}

/** "19 Oct 2026" */
export function formatDateLong(day: LocalDate): string {
  const { y, m, d } = parseLocalDate(day);
  return `${d} ${MONTH_SHORT[m - 1]} ${y}`;
}
