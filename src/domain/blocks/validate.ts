/**
 * Block validation before a write. Returns human-readable messages; empty means valid.
 */
import { isLocalDate } from "../time/localDate";
import type { Block, Goal } from "../types";

export const MAX_TITLE_LENGTH = 200;
export const MAX_NOTES_LENGTH = 5000;

export interface ValidateBlockContext {
  goals: Readonly<Record<string, Goal>>;
  blocks: Readonly<Record<string, Block>>;
  /** The stored version when updating; absent or null on create. */
  previous?: Block | null;
}

/** Checks range/order, text lengths, goal references, plan links and layer-only fields. */
export function validateBlock(block: Block, ctx: ValidateBlockContext): string[] {
  const errors: string[] = [];
  const { startMinute: start, endMinute: end } = block;

  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    errors.push("Start and end must be whole minutes.");
  } else {
    if (start < 0 || start > 1439) errors.push("Start must be between 00:00 and 23:59.");
    if (end < 1 || end > 1440) errors.push("End must be between 00:01 and 24:00.");
    if (end <= start) errors.push("End must be after start.");
  }

  if (!isLocalDate(block.day)) errors.push(`Invalid day: ${block.day}.`);
  if (block.title.length > MAX_TITLE_LENGTH) errors.push(`Title must be at most ${MAX_TITLE_LENGTH} characters.`);
  if (block.notes.length > MAX_NOTES_LENGTH) errors.push(`Notes must be at most ${MAX_NOTES_LENGTH} characters.`);

  if (block.goalId !== null) {
    const goal = ctx.goals[block.goalId];
    if (!goal) {
      errors.push("Unknown goal.");
    } else if (goal.archivedOn !== null) {
      const prev = ctx.previous ?? null;
      if (!prev || prev.goalId !== block.goalId) errors.push(`Goal "${goal.name}" is archived.`);
    }
  }

  if (block.planBlockId !== null) {
    if (block.layer !== "actual") {
      errors.push("Only actual blocks can link to a plan block.");
    } else {
      const plan = ctx.blocks[block.planBlockId];
      if (!plan || plan.layer !== "plan") errors.push("Linked plan block does not exist.");
      else if (plan.day !== block.day) errors.push("Linked plan block must be on the same day.");
    }
  }

  if (block.skipped && block.layer !== "plan") errors.push("Only plan blocks can be skipped.");

  return errors;
}
