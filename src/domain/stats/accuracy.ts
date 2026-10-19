/**
 * How closely a day/week's actual time tracked its plan. Unlike `stats.ts` (minutes per
 * goal), these are block-level percentages: each plan block counts once, decided by its
 * `planState`.
 */
import { isPast, linksByPlan, planStates } from "../blocks/reconcile";
import type { Block, LocalDate, Now } from "../types";

export interface AccuracyStats {
  /** Decided plan blocks (skipped, or past-due) in range. Everything below is null when 0. */
  decidedPlanCount: number;
  /** Share of decided plan blocks confirmed exactly as planned. */
  confirmedAsPlannedPct: number | null;
  /** Share of decided plan blocks marked skipped. */
  skippedPct: number | null;
  /** Share of past actual blocks with no linked plan block. */
  unplannedPct: number | null;
  /** Mean (actual start − plan start) in minutes for linked actuals; positive means late. */
  avgStartDriftMinutes: number | null;
}

/** Plan blocks are "decided" once skipped (whenever that happens) or past-due. */
const isDecided = (b: Block, now: Now) => b.skipped || isPast(b.day, b.endMinute, now);

export function computeAccuracy(blocks: readonly Block[], days: readonly LocalDate[], now: Now): AccuracyStats {
  const daySet = new Set(days);
  const inRange = blocks.filter((b) => daySet.has(b.day));

  const decidedPlans = inRange.filter((b) => b.layer === "plan" && isDecided(b, now));
  const states = planStates(inRange, now);
  const done = decidedPlans.filter((p) => states.get(p.id) === "done").length;
  const skipped = decidedPlans.filter((p) => states.get(p.id) === "skipped").length;

  const pastActuals = inRange.filter((b) => b.layer === "actual" && isPast(b.day, b.endMinute, now));
  const unplanned = pastActuals.filter((a) => a.planBlockId === null).length;

  const links = linksByPlan(inRange);
  const drifts: number[] = [];
  for (const p of decidedPlans) for (const a of links.get(p.id) ?? []) drifts.push(a.startMinute - p.startMinute);

  const pct = (n: number, total: number) => (total > 0 ? (n / total) * 100 : null);
  return {
    decidedPlanCount: decidedPlans.length,
    confirmedAsPlannedPct: pct(done, decidedPlans.length),
    skippedPct: pct(skipped, decidedPlans.length),
    unplannedPct: pct(unplanned, pastActuals.length),
    avgStartDriftMinutes: drifts.length > 0 ? drifts.reduce((a, b) => a + b, 0) / drifts.length : null,
  };
}
