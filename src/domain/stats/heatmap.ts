/**
 * Per-day actual-time totals for the year heatmap: minutes of actual time per day (the
 * per-day UNION of intervals, so overlapping blocks never double count), for one goal or
 * every goal.
 */
import { unionLength, type Interval } from "../blocks/intervals";
import type { Block, LocalDate } from "../types";

export interface HeatmapInput {
  blocks: readonly Block[];
  /** Restrict to this goal's actual time; null = every goal (including unassigned). */
  goalId: string | null;
}

/** Pure. Days with no matching actual time are simply absent from the map. */
export function heatmapMinutesByDay(input: HeatmapInput): Map<LocalDate, number> {
  const byDay = new Map<LocalDate, Interval[]>();
  for (const b of input.blocks) {
    if (b.layer !== "actual") continue;
    if (input.goalId !== null && b.goalId !== input.goalId) continue;
    const list = byDay.get(b.day);
    const i: Interval = { start: b.startMinute, end: b.endMinute };
    if (list) list.push(i);
    else byDay.set(b.day, [i]);
  }
  const out = new Map<LocalDate, number>();
  for (const [day, intervals] of byDay) out.set(day, unionLength(intervals));
  return out;
}

/** 0..4 bucket for a color scale, based on hours (0, <1h, <3h, <6h, >=6h). */
export function heatmapLevel(minutes: number): 0 | 1 | 2 | 3 | 4 {
  if (minutes <= 0) return 0;
  if (minutes < 60) return 1;
  if (minutes < 180) return 2;
  if (minutes < 360) return 3;
  return 4;
}
