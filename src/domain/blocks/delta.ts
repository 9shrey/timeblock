/** How a linked actual block differs from the plan block it confirms. */
import type { Block } from "../types";

export interface BlockDelta {
  /** actual start minus plan start, in minutes; positive means it started late. */
  startDriftMinutes: number;
  goalChanged: boolean;
}

/** Null when the actual matches its plan exactly (nothing worth flagging). */
export function blockDelta(actual: Block, plan: Block): BlockDelta | null {
  const startDriftMinutes = actual.startMinute - plan.startMinute;
  const goalChanged = actual.goalId !== plan.goalId;
  if (startDriftMinutes === 0 && !goalChanged) return null;
  return { startDriftMinutes, goalChanged };
}
