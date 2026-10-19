/** The largest unplanned or unconfirmed stretches in a date range, for the Review page. */
import { ghostsOf, isPast } from "../blocks/reconcile";
import type { Block, Goal, LocalDate, Minute, Now } from "../types";

export interface Gap {
  day: LocalDate;
  startMinute: Minute;
  endMinute: Minute;
  minutes: number;
  /** An actual block with no linked plan, or a plan block whose ghost is past and still unconfirmed. */
  kind: "unplanned" | "unconfirmed";
  title: string;
}

const displayTitle = (title: string, goal: Goal | null) => title.trim() || goal?.name || "Untitled";

/** The `limit` largest gaps in `days`, largest first. */
export function biggestGaps(blocks: readonly Block[], days: readonly LocalDate[], goals: Readonly<Record<string, Goal>>, now: Now, limit = 5): Gap[] {
  const daySet = new Set(days);
  const inRange = blocks.filter((b) => daySet.has(b.day));
  const goalOf = (id: string | null) => (id ? goals[id] ?? null : null);

  const gaps: Gap[] = [];
  for (const b of inRange) {
    if (b.layer === "actual" && b.planBlockId === null) {
      gaps.push({ day: b.day, startMinute: b.startMinute, endMinute: b.endMinute, minutes: b.endMinute - b.startMinute, kind: "unplanned", title: displayTitle(b.title, goalOf(b.goalId)) });
    }
  }
  for (const g of ghostsOf(inRange)) {
    if (!daySet.has(g.day) || !isPast(g.day, g.endMinute, now)) continue;
    gaps.push({ day: g.day, startMinute: g.startMinute, endMinute: g.endMinute, minutes: g.endMinute - g.startMinute, kind: "unconfirmed", title: displayTitle(g.title, goalOf(g.goalId)) });
  }

  return gaps.sort((a, b) => b.minutes - a.minutes || a.day.localeCompare(b.day) || a.startMinute - b.startMinute).slice(0, limit);
}
