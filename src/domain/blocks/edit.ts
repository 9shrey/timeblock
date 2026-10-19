/**
 * Pure geometry for dragging, resizing and keyboard-editing blocks. Every result is
 * clamped to the day, [0, 1440].
 */
import type { Interval } from "./intervals";

const DAY = 1440;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Rounds to the nearest multiple of `step`, clamped to [0, 1440]. */
export function snap(minute: number, step: number): number {
  const s = step > 0 ? step : 1;
  return clamp(Math.round(minute / s) * s, 0, DAY);
}

/** Vertical pixel offset to (unsnapped) minutes, clamped to [0, 1440]. */
export function pxToMinute(px: number, pxPerHour: number): number {
  return clamp((px / pxPerHour) * 60, 0, DAY);
}

/** Minutes (clamped to [0, 1440]) to a vertical pixel offset. */
export function minuteToPx(minute: number, pxPerHour: number): number {
  return (clamp(minute, 0, DAY) / 60) * pxPerHour;
}

/** Shifts `iv` keeping its length, snapping the start, so the whole block stays in the day. */
export function moveInterval(iv: Interval, deltaMinutes: number, step: number): Interval {
  const len = clamp(iv.end - iv.start, 0, DAY);
  const start = clamp(snap(iv.start + deltaMinutes, step), 0, DAY - len);
  return { start, end: start + len };
}

/**
 * Moves one edge to `toMinute` (snapped), keeping at least `minLength`. If the far edge
 * of the day leaves too little room, the other edge gives way.
 */
export function resizeInterval(
  iv: Interval,
  edge: "start" | "end",
  toMinute: number,
  step: number,
  minLength = step,
): Interval {
  const min = clamp(minLength, 0, DAY);
  const target = snap(toMinute, step);
  if (edge === "end") {
    const end = clamp(Math.max(target, iv.start + min), 0, DAY);
    return { start: Math.max(0, Math.min(iv.start, end - min)), end };
  }
  const start = clamp(Math.min(target, iv.end - min), 0, DAY);
  return { start, end: Math.min(DAY, Math.max(iv.end, start + min)) };
}

/**
 * Drag-create from `anchorMinute` to `currentMinute`, in either direction. Both ends are
 * snapped; a too-short drag grows away from the anchor to `minLength`.
 */
export function createInterval(
  anchorMinute: number,
  currentMinute: number,
  step: number,
  minLength = step,
): Interval {
  const min = clamp(minLength, 0, DAY);
  const a = snap(anchorMinute, step);
  const c = snap(currentMinute, step);
  let start = Math.min(a, c);
  let end = Math.max(a, c);
  if (end - start < min) {
    if (currentMinute >= anchorMinute) end = start + min;
    else start = end - min;
  }
  if (end > DAY) {
    end = DAY;
    start = Math.min(start, DAY - min);
  }
  if (start < 0) {
    start = 0;
    end = Math.max(end, min);
  }
  return { start, end };
}

/** Keyboard ↑/↓: shifts by `delta` minutes keeping length, clamped to the day. */
export function nudgeInterval(iv: Interval, delta: number): Interval {
  const len = clamp(iv.end - iv.start, 0, DAY);
  const start = clamp(iv.start + delta, 0, DAY - len);
  return { start, end: start + len };
}

/** Keyboard Shift+↑/↓: moves the end edge by `delta`, keeping at least `minLength`. */
export function resizeBy(iv: Interval, delta: number, minLength: number): Interval {
  return { start: iv.start, end: clamp(Math.max(iv.end + delta, iv.start + minLength), 0, DAY) };
}
