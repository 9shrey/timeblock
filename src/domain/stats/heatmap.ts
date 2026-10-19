/** Actual time per day for the Trends page's year heatmap. */
import { unionLength, type Interval } from "../blocks/intervals";
import type { Block, LocalDate } from "../types";

/**
 * Actual minutes per day in `[from, to]`, optionally filtered to one goal. Overlapping
 * actual blocks (shown side by side in the timeline) union rather than double-count,
 * same as the weekly stats.
 */
export function dailyActualMinutes(blocks: readonly Block[], from: LocalDate, to: LocalDate, goalId: string | null): Record<LocalDate, number> {
  const byDay = new Map<LocalDate, Interval[]>();
  for (const b of blocks) {
    if (b.layer !== "actual" || b.day < from || b.day > to) continue;
    if (goalId !== null && b.goalId !== goalId) continue;
    const i = { start: b.startMinute, end: b.endMinute };
    const list = byDay.get(b.day);
    if (list) list.push(i);
    else byDay.set(b.day, [i]);
  }
  const out: Record<LocalDate, number> = {};
  for (const [day, intervals] of byDay) out[day] = unionLength(intervals);
  return out;
}
