/**
 * Parses a one-line quick-add string like `9-10:30 Thesis #thesis` into a block's time
 * range, title and goal. Pure; reuses `parseTimeInput` for each side of the time range.
 */
import { parseTimeInput } from "../time/localDate";
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

/**
 * `null` means the input couldn't be parsed as `<start>-<end> <title>`, or the range is
 * empty/reversed. A `#tag` that matches no goal is left in the title as typed.
 */
export function parseQuickAdd(input: string, goals: readonly Goal[]): QuickAddResult | null {
  const trimmed = input.trim();
  const match = RANGE_RE.exec(trimmed);
  if (!match) return null;
  const [, startText, endText, restMatch] = match;
  const startMinute = parseTimeInput(startText!);
  const endMinute = parseTimeInput(endText!);
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
