import type { Layer, LocalDate } from "@/domain/types";

export const DAY_PX_PER_HOUR = 96;
export const WEEK_PX_PER_HOUR = 56;
/** Movement before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 4;
/** Resize handle height at the top/bottom edge of a block. */
export const EDGE_PX = 6;
/** Fine snap while Shift is held. */
export const FINE_SNAP = 5;

/** One timeline column: a (day, layer) lane. */
export interface ColumnSpec {
  key: string;
  day: LocalDate;
  layer: Layer;
  /** Future Actual lanes: no edits at all. */
  readOnly: boolean;
  /** Past Plan lanes until unlocked: no edits. */
  locked: boolean;
  /** Actual lanes show ghosts of the same day's plan. */
  showGhosts: boolean;
  /** Relative width (flex-grow); defaults to 1. */
  span?: number;
}

export const isEditable = (c: ColumnSpec | undefined): boolean => !!c && !c.readOnly && !c.locked;

export interface ColumnRect {
  left: number;
  right: number;
}

/** Index of the column under clientX, or null. */
export function columnAt(x: number, rects: readonly ColumnRect[]): number | null {
  const i = rects.findIndex((r) => x >= r.left && x < r.right);
  return i === -1 ? null : i;
}

/** Unsnapped minute under clientY, clamped to the day. */
export function minuteAt(clientY: number, contentTop: number, pxPerHour: number): number {
  return Math.min(1440, Math.max(0, ((clientY - contentTop) / pxPerHour) * 60));
}

export const minutesToPx = (min: number, pxPerHour: number): number => (min / 60) * pxPerHour;
