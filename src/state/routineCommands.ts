/** Routine actions: create, edit (syncing future unedited occurrences), delete, materialize. */
import { toast } from "sonner";
import {
  createRoutineChanges,
  deleteRoutineChanges,
  materializeRoutines as materializeRoutinesChanges,
  MAX_ROUTINE_TITLE_LENGTH,
  type RoutineInput,
  updateRoutineChanges,
} from "@/domain/routines";
import { systemEnv } from "@/domain/env";
import { addDays, weekStartOf } from "@/domain/time/localDate";
import type { LocalDate, Routine } from "@/domain/types";
import { allBlocks, routineList } from "./selectors";
import { commit, useStore } from "./store";

const env = systemEnv;
const state = () => useStore.getState();

function invalid(input: Pick<RoutineInput, "title" | "startMinute" | "endMinute" | "weekdays" | "goalId">): string | null {
  const title = input.title.trim();
  if (title.length < 1 || title.length > MAX_ROUTINE_TITLE_LENGTH) return `Titles need 1–${MAX_ROUTINE_TITLE_LENGTH} characters.`;
  if (input.endMinute <= input.startMinute) return "End must be after start.";
  if (input.weekdays === 0) return "Pick at least one day of the week.";
  if (input.goalId !== null) {
    const goal = state().data.goals[input.goalId];
    if (!goal) return "Unknown goal.";
    if (goal.archivedOn !== null) return `Goal "${goal.name}" is archived.`;
  }
  return null;
}

export function createRoutine(input: RoutineInput): Routine | null {
  const error = invalid(input);
  if (error) {
    toast.error(error);
    return null;
  }
  const { routine, changes } = createRoutineChanges(input, env);
  commit(changes, { label: "Create routine" });
  return routine;
}

/** Edits a routine; future occurrences still matching its old fields are updated to match, or removed if they no longer occur. */
export function editRoutine(routine: Routine, patch: Partial<RoutineInput>): boolean {
  const merged = { ...routine, ...patch };
  const error = invalid(merged);
  if (error) {
    toast.error(error);
    return false;
  }
  commit(updateRoutineChanges(routine, patch, allBlocks(state().data.blocks), state().now, env), { label: "Edit routine" });
  return true;
}

export function deleteRoutine(routine: Routine): void {
  commit(deleteRoutineChanges(routine, allBlocks(state().data.blocks), env), { label: "Delete routine" });
}

export function routines(): Routine[] {
  return routineList(state().data.routines);
}

/**
 * Materializes every routine up to the later of the end of next week (from `now`) and the
 * end of the viewed week (`weekStart`). A no-op write (noHistory, since these are rows the
 * app creates for itself, not a user edit).
 */
export function materializeRoutines(weekStart: LocalDate): void {
  const { now, data, settings } = state();
  const nextWeekEnd = addDays(weekStartOf(now.day, settings.weekStartDay), 13);
  const viewedWeekEnd = addDays(weekStart, 6);
  const horizon = nextWeekEnd > viewedWeekEnd ? nextWeekEnd : viewedWeekEnd;
  const raw = materializeRoutinesChanges(routineList(data.routines), allBlocks(data.blocks), horizon, now, env);
  // A routine's goal may have since been archived or deleted; a background materialization
  // should drop the link rather than create an invalid block.
  const changes = raw.map((c) => {
    if (c.op !== "put" || c.table !== "blocks" || c.row.goalId === null) return c;
    const goal = data.goals[c.row.goalId];
    if (goal && (goal.archivedOn === null || goal.archivedOn > c.row.day)) return c;
    return { ...c, row: { ...c.row, goalId: null } };
  });
  if (changes.length > 0) commit(changes, { label: "Materialize routines", noHistory: true });
}
