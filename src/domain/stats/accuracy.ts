/**
 * Plan-accuracy measures over a set of blocks (any date range): how much of the plan was
 * confirmed as planned, how much was skipped, how much actual time was unplanned, and how
 * late (or early) confirmed actuals tend to start relative to their plan.
 */
import { linksByPlan, planState } from "../blocks/reconcile";
import type { Block, Now } from "../types";

export interface AccuracyStats {
  /** Plan blocks whose outcome is known (not still pending). */
  countedPlans: number;
  /** % of counted plans that were confirmed as planned or adjusted (i.e. not skipped). */
  confirmedPct: number;
  /** % of counted plans marked skipped. */
  skippedPct: number;
  /** % of total actual minutes that have no linked plan block. */
  unplannedPct: number;
  /** Average (actual start − plan start) in minutes over every linked actual block; null with no links. */
  avgStartDriftMinutes: number | null;
}

export const zeroAccuracy = (): AccuracyStats => ({
  countedPlans: 0,
  confirmedPct: 0,
  skippedPct: 0,
  unplannedPct: 0,
  avgStartDriftMinutes: null,
});

/** Pure; `blocks` can span any range (a week, a trend window, all time). */
export function computeAccuracy(blocks: readonly Block[], now: Now): AccuracyStats {
  const links = linksByPlan(blocks);
  let countedPlans = 0;
  let confirmed = 0;
  let skipped = 0;
  const drifts: number[] = [];

  for (const b of blocks) {
    if (b.layer !== "plan") continue;
    const linked = links.get(b.id) ?? [];
    const state = planState(b, linked, now);
    if (state === "pending") continue;
    countedPlans++;
    if (state === "skipped") skipped++;
    else if (state === "done" || state === "adjusted") {
      confirmed++;
      for (const a of linked) drifts.push(a.startMinute - b.startMinute);
    }
  }

  let totalActualMinutes = 0;
  let unplannedMinutes = 0;
  for (const b of blocks) {
    if (b.layer !== "actual") continue;
    const len = b.endMinute - b.startMinute;
    totalActualMinutes += len;
    if (b.planBlockId === null) unplannedMinutes += len;
  }

  return {
    countedPlans,
    confirmedPct: countedPlans > 0 ? (confirmed / countedPlans) * 100 : 0,
    skippedPct: countedPlans > 0 ? (skipped / countedPlans) * 100 : 0,
    unplannedPct: totalActualMinutes > 0 ? (unplannedMinutes / totalActualMinutes) * 100 : 0,
    avgStartDriftMinutes: drifts.length > 0 ? drifts.reduce((s, d) => s + d, 0) / drifts.length : null,
  };
}
