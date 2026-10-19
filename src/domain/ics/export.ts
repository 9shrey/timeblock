/**
 * Formats plan/actual blocks as an RFC 5545 `.ics` calendar for a date range. Timeblock has
 * no timezone database, so every block is written as a floating (no `Z`, no `TZID`)
 * date-time: calendar apps read a floating time as the viewer's own local time, which
 * matches how Timeblock's wall-clock minutes work.
 */
import { addDays, parseLocalDate } from "../time/localDate";
import type { Block, LocalDate, Minute } from "../types";

const pad2 = (n: number) => String(n).padStart(2, "0");
const pad4 = (n: number) => String(n).padStart(4, "0");

/** Folds a line to RFC 5545's 75-octet limit (counted here in UTF-16 code units, close enough for our ASCII-heavy output). */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    parts.push(rest.slice(0, 74));
    rest = rest.slice(74);
  }
  if (rest) parts.push(rest);
  return parts.join("\r\n ");
}

const escapeText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

/** `day`/`minute` as a floating local date-time; `minute` may be exactly 1440 (midnight, next day). */
function stamp(day: LocalDate, minute: Minute): string {
  const overflowDays = Math.floor(minute / 1440);
  const atDay = overflowDays > 0 ? addDays(day, overflowDays) : day;
  const ofDay = minute - overflowDays * 1440;
  const { y, m, d } = parseLocalDate(atDay);
  return `${pad4(y)}${pad2(m)}${pad2(d)}T${pad2(Math.floor(ofDay / 60))}${pad2(ofDay % 60)}00`;
}

function utcStamp(unixMs: number): string {
  const dt = new Date(unixMs);
  return `${pad4(dt.getUTCFullYear())}${pad2(dt.getUTCMonth() + 1)}${pad2(dt.getUTCDate())}T${pad2(dt.getUTCHours())}${pad2(dt.getUTCMinutes())}${pad2(dt.getUTCSeconds())}Z`;
}

export interface IcsExportInput {
  blocks: readonly Block[];
  from: LocalDate;
  to: LocalDate;
  generatedAtMs: number;
}

/** The plan and actual blocks from `from` to `to` (inclusive) as one `.ics` calendar. */
export function toIcs({ blocks, from, to, generatedAtMs }: IcsExportInput): string {
  const inRange = blocks.filter((b) => b.day >= from && b.day <= to).sort((a, b) => a.day.localeCompare(b.day) || a.startMinute - b.startMinute);
  const dtstamp = utcStamp(generatedAtMs);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Timeblock//timeblock//EN", "CALSCALE:GREGORIAN"];
  for (const b of inRange) {
    const summary = b.layer === "actual" ? `[Actual] ${b.title || "Untitled"}` : b.title || "Untitled";
    lines.push("BEGIN:VEVENT", `UID:${b.id}@timeblock`, `DTSTAMP:${dtstamp}`, `DTSTART:${stamp(b.day, b.startMinute)}`, `DTEND:${stamp(b.day, b.endMinute)}`, foldLine(`SUMMARY:${escapeText(summary)}`));
    if (b.notes.trim()) lines.push(foldLine(`DESCRIPTION:${escapeText(b.notes)}`));
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
