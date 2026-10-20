/**
 * The only place in the app that reads local wall-clock time.
 */
import type { LocalDate, Minute, Now } from "../types";
import { formatYMD, isLocalDate, parseLocalDate } from "./localDate";

/** Converts an instant to the user's local day and minute. */
export function nowFrom(date: Date): Now {
  return {
    day: formatYMD({ y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() }),
    minute: date.getHours() * 60 + date.getMinutes(),
  };
}

/** The inverse of `nowFrom`: the instant (ms) at which the user's wall clock reads `day` `minute`. */
export function instantOf(day: LocalDate, minute: Minute = 0): number {
  const { y, m, d } = parseLocalDate(day);
  const date = new Date(2000, 0, 1, 0, minute);
  date.setFullYear(y, m - 1, d); // unlike `new Date(y, …)`, keeps years below 100 as given
  return date.getTime();
}

/** Parses a dev-only `?now=YYYY-MM-DDTHH:mm` override. Returns null when absent or invalid. */
export function parseNowOverride(search: string): Now | null {
  const raw = new URLSearchParams(search).get("now");
  if (!raw) return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(raw);
  if (!m || !isLocalDate(m[1])) return null;
  const minute = Number(m[2]) * 60 + Number(m[3]);
  if (Number(m[3]) > 59 || minute > 1439) return null;
  return { day: m[1]!, minute };
}

export const CLOCK_TICK_MS = 60_000;

/**
 * Returns a function that reports the current `Now`. With an override, time is frozen
 * at the override (deterministic dev/browser checks).
 */
export function makeClock(override: Now | null): () => Now {
  return override ? () => override : () => nowFrom(new Date());
}
