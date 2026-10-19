/**
 * Half-open minute intervals [start, end). Empty intervals (end <= start) are dropped.
 */

export interface Interval {
  start: number;
  end: number;
}

const nonEmpty = (i: Interval) => i.end > i.start;

/** Sorted, disjoint union. Touching intervals are merged. */
export function merge(list: readonly Interval[]): Interval[] {
  const sorted = list.filter(nonEmpty).sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ start: i.start, end: i.end });
  }
  return out;
}

export function unionLength(list: readonly Interval[]): number {
  return merge(list).reduce((sum, i) => sum + (i.end - i.start), 0);
}

/** `a` minus every interval in `bs`, as sorted disjoint pieces. */
export function subtract(a: Interval, bs: readonly Interval[]): Interval[] {
  if (!nonEmpty(a)) return [];
  const out: Interval[] = [];
  let cursor = a.start;
  for (const b of merge(bs)) {
    if (b.end <= cursor) continue;
    if (b.start >= a.end) break;
    if (b.start > cursor) out.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
    if (cursor >= a.end) break;
  }
  if (cursor < a.end) out.push({ start: cursor, end: a.end });
  return out;
}

/** Intersection of `a` with `range`, or null if empty. */
export function clip(a: Interval, range: Interval): Interval | null {
  const start = Math.max(a.start, range.start);
  const end = Math.min(a.end, range.end);
  return end > start ? { start, end } : null;
}

/** Intersection of two interval sets, as sorted disjoint pieces. */
export function intersect(as: readonly Interval[], bs: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const a of merge(as)) for (const b of merge(bs)) {
    const c = clip(a, b);
    if (c) out.push(c);
  }
  return merge(out);
}

/** True when the intervals share time (touching does not count). */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}
