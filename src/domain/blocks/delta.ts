/**
 * Delta badge for a linked actual block: how it differs from the plan block it realises.
 * Spec (docs/design/ux-interaction.md): `+15m late`, `−30m`, `goal: Admin` if the goal
 * was swapped. Shown only when linked and different; `null` otherwise.
 */
import { formatDuration } from "../time/localDate";
import type { Block, Goal } from "../types";

export interface BlockDelta {
  /** actual.startMinute − plan.startMinute. Positive = started later than planned. */
  startDriftMinutes: number;
  goalChanged: boolean;
}

/**
 * `actual` must be a linked actual block (`actual.planBlockId === plan.id`); returns null
 * when nothing differs (an exact, unchanged realisation of the plan).
 */
export function blockDelta(actual: Block, plan: Block): BlockDelta | null {
  const startDriftMinutes = actual.startMinute - plan.startMinute;
  const goalChanged = actual.goalId !== plan.goalId;
  if (startDriftMinutes === 0 && !goalChanged) return null;
  return { startDriftMinutes, goalChanged };
}

/** `+15m late`, `−30m`, `goal: Admin` (the actual's new goal) — joined with " · " when both apply. */
export function formatBlockDelta(delta: BlockDelta, actualGoal: Goal | null): string {
  const parts: string[] = [];
  if (delta.startDriftMinutes > 0) parts.push(`+${formatDuration(delta.startDriftMinutes)} late`);
  else if (delta.startDriftMinutes < 0) parts.push(formatDuration(delta.startDriftMinutes));
  if (delta.goalChanged) parts.push(actualGoal ? `goal: ${actualGoal.name}` : "goal changed");
  return parts.join(" · ");
}
