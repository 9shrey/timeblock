/**
 * Parses a one-line quick-add string like `9-10:30 Thesis #thesis` (or `9am-10:30am …`,
 * `9-10:30pm …`) into a block's time range, title and goal. Pure; reuses `parseTimeInput`
 * for each side of the time range.
 */
import { meridiemOf, parseTimeInput } from "../time/localDate";
import type { Goal } from "../types";

export interface QuickAddResult {
  startMinute: number;
  endMinute: number;
  title: string;
  goalId: string | null;
}

const RANGE_RE = /^(\S+?)-(\S+)(?:\s+(.*))?$/s;
const TAG_RE = /#(\S+)/;

/** Matches a `#tag` to a goal by name: an exact (case-insensitive) match, else a prefix match. */
function matchGoal(tag: string, goals: readonly Goal[]): Goal | null {
  const lower = tag.toLowerCase();
  return (
    goals.find((g) => g.name.toLowerCase() === lower) ?? goals.find((g) => g.name.toLowerCase().startsWith(lower)) ?? null
  );
}

/** A range ending at midnight ("11pm-12am", "23-0") means the end of the day. */
function parseEnd(text: string): number | null {
  const m = parseTimeInput(text);
  return m === 0 ? 1440 : m;
}

/**
 * The start side. A bare start before a suffixed end ("9-10:30pm") takes the end's am/pm,
 * unless that would put it after the end ("11-1pm" is 11am–1pm, not 11pm).
 */
function parseStart(text: string, endText: string, endMinute: number | null): number | null {
  const endMeridiem = meridiemOf(endText);
  if (endMeridiem && !meridiemOf(text) && endMinute !== null && /^\d{1,2}([:.]?\d{2})?$/.test(text)) {
    const same = parseTimeInput(text + endMeridiem);
    if (same !== null && same < endMinute) return same;
    const other = parseTimeInput(text + (endMeridiem === "pm" ? "am" : "pm"));
    if (other !== null && other < endMinute) return other;
  }
  return parseTimeInput(text);
}

/**
 * `null` means the input couldn't be parsed as `<start>-<end> <title>`, or the range is
 * empty/reversed. A `#tag` that matches no goal is left in the title as typed.
 */
export function parseQuickAdd(input: string, goals: readonly Goal[]): QuickAddResult | null {
  const trimmed = input.trim();
  const match = RANGE_RE.exec(trimmed);
  if (!match) return null;
  const [, startText, endText, restMatch] = match;
  const endMinute = parseEnd(endText!);
  const startMinute = parseStart(startText!, endText!, endMinute);
  if (startMinute === null || endMinute === null || endMinute <= startMinute) return null;

  const rest = restMatch ?? "";
  const tagMatch = TAG_RE.exec(rest);
  let title = rest.trim();
  let goalId: string | null = null;
  if (tagMatch) {
    const goal = matchGoal(tagMatch[1]!, goals);
    if (goal) {
      goalId = goal.id;
      title = (rest.slice(0, tagMatch.index) + rest.slice(tagMatch.index + tagMatch[0].length)).trim();
    }
  }
  return { startMinute, endMinute, title, goalId };
}
