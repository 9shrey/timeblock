/**
 * "Biggest gaps": the largest unplanned-actual or unconfirmed-ghost stretches in a set of
 * blocks, for the Review page's "Biggest gaps" list.
 */
import { ghostsOf, isPast } from "../blocks/reconcile";
import type { Block, LocalDate, Now } from "../types";

export type GapKind = "unplanned" | "unconfirmed";

export interface Gap {
  day: LocalDate;
  startMinute: number;
  endMinute: number;
  minutes: number;
  kind: GapKind;
  title: string;
  goalId: string | null;
}

/** Longest stretches first, ties broken by day then start time. Pure. */
export function biggestGaps(blocks: readonly Block[], now: Now, limit = 5): Gap[] {
  const gaps: Gap[] = [];

  for (const b of blocks) {
    if (b.layer === "actual" && b.planBlockId === null) {
      gaps.push({
        day: b.day,
        startMinute: b.startMinute,
        endMinute: b.endMinute,
        minutes: b.endMinute - b.startMinute,
        kind: "unplanned",
        title: b.title,
        goalId: b.goalId,
      });
    }
  }

  for (const g of ghostsOf(blocks)) {
    if (!isPast(g.day, g.endMinute, now)) continue;
    gaps.push({
      day: g.day,
      startMinute: g.startMinute,
      endMinute: g.endMinute,
      minutes: g.endMinute - g.startMinute,
      kind: "unconfirmed",
      title: g.title,
      goalId: g.goalId,
    });
  }

  return gaps
    .sort((a, b) => b.minutes - a.minutes || a.day.localeCompare(b.day) || a.startMinute - b.startMinute)
    .slice(0, limit);
}
