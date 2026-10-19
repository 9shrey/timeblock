/**
 * Recurring plan blocks. Occurrences are ordinary plan blocks (with `routineId` set) that
 * are materialized ahead of time, up to a horizon recorded as `materializedThrough` so a
 * deleted occurrence is never re-created. Past days are never (re)materialized.
 */
import { del, put } from "./changes";
import { addDays, compareDates, dayOfWeek } from "./time/localDate";
import type { Block, ChangeSet, Env, LocalDate, Now, Routine } from "./types";

export const MAX_ROUTINE_TITLE_LENGTH = 200;

/** True if `routine` runs on `day` (on/after `startsOn`, at/before `endsOn`, matching weekday). */
export function occursOn(routine: Routine, day: LocalDate): boolean {
  if (day < routine.startsOn) return false;
  if (routine.endsOn !== null && day > routine.endsOn) return false;
  return (routine.weekdays & (1 << dayOfWeek(day))) !== 0;
}

/** True if `block` is still exactly what `routine` would generate (never customized). */
function matchesRoutine(block: Block, routine: Routine): boolean {
  return (
    block.startMinute === routine.startMinute &&
    block.endMinute === routine.endMinute &&
    block.title === routine.title &&
    block.goalId === routine.goalId &&
    block.notes === routine.notes
  );
}

function occurrenceBlock(routine: Routine, day: LocalDate, env: Env): Block {
  const t = env.nowMs();
  return {
    id: env.newId(),
    day,
    layer: "plan",
    startMinute: routine.startMinute,
    endMinute: routine.endMinute,
    title: routine.title,
    goalId: routine.goalId,
    notes: routine.notes,
    planBlockId: null,
    skipped: false,
    routineId: routine.id,
    createdAt: t,
    updatedAt: t,
  };
}

/**
 * Materializes occurrences for every routine from the day after its `materializedThrough`
 * (or `startsOn`, whichever is later) up to `horizon`, never before `now.day`. Advances
 * each touched routine's `materializedThrough` to the furthest day it considered (even
 * when that day had no occurrence), so the next call starts from there.
 */
export function materializeRoutines(
  routines: readonly Routine[],
  blocks: readonly Block[],
  horizon: LocalDate,
  now: Now,
  env: Env,
): ChangeSet {
  const changes: ChangeSet = [];
  for (const routine of routines) {
    const existing = new Set(blocks.filter((b) => b.routineId === routine.id).map((b) => b.day));
    const from = laterOf(
      routine.materializedThrough !== null ? addDays(routine.materializedThrough, 1) : routine.startsOn,
      now.day,
    );
    const to = routine.endsOn !== null && routine.endsOn < horizon ? routine.endsOn : horizon;
    if (compareDates(from, to) > 0) continue;
    for (let day = from; compareDates(day, to) <= 0; day = addDays(day, 1)) {
      if (occursOn(routine, day) && !existing.has(day)) changes.push(put("blocks", occurrenceBlock(routine, day, env)));
    }
    changes.push(put("routines", { ...routine, materializedThrough: to, updatedAt: env.nowMs() }));
  }
  return changes;
}

function laterOf(a: LocalDate, b: LocalDate): LocalDate {
  return compareDates(a, b) >= 0 ? a : b;
}

export interface RoutineInput {
  title: string;
  goalId: string | null;
  notes: string;
  startMinute: number;
  endMinute: number;
  weekdays: number;
  startsOn: LocalDate;
  endsOn: LocalDate | null;
}

export function createRoutineChanges(input: RoutineInput, env: Env): { routine: Routine; changes: ChangeSet } {
  const t = env.nowMs();
  const routine: Routine = {
    id: env.newId(),
    title: input.title.trim(),
    goalId: input.goalId,
    notes: input.notes,
    startMinute: input.startMinute,
    endMinute: input.endMinute,
    weekdays: input.weekdays,
    startsOn: input.startsOn,
    endsOn: input.endsOn,
    materializedThrough: null,
    createdAt: t,
    updatedAt: t,
  };
  return { routine, changes: [put("routines", routine)] };
}

/**
 * Patches a routine and its future, unedited occurrences: a plan block linked to this
 * routine, on or after `now.day`, whose fields still exactly match the routine, is updated
 * to match the patched fields (or removed if it no longer occurs under the new schedule).
 * Occurrences the user has customized are left alone.
 */
export function updateRoutineChanges(
  routine: Routine,
  patch: Partial<RoutineInput>,
  blocks: readonly Block[],
  now: Now,
  env: Env,
): ChangeSet {
  const t = env.nowMs();
  const next: Routine = {
    ...routine,
    ...patch,
    title: patch.title !== undefined ? patch.title.trim() : routine.title,
    updatedAt: t,
  };
  const changes: ChangeSet = [put("routines", next)];
  for (const b of blocks) {
    if (b.routineId !== routine.id || b.layer !== "plan" || b.day < now.day || !matchesRoutine(b, routine)) continue;
    if (occursOn(next, b.day)) {
      changes.push(
        put("blocks", {
          ...b,
          startMinute: next.startMinute,
          endMinute: next.endMinute,
          title: next.title,
          goalId: next.goalId,
          notes: next.notes,
          updatedAt: t,
        }),
      );
    } else {
      changes.push(del("blocks", b.id));
    }
  }
  return changes;
}

/** Deletes a routine; its occurrence blocks are kept as ordinary plan blocks (routineId cleared). */
export function deleteRoutineChanges(routine: Routine, blocks: readonly Block[], env: Env): ChangeSet {
  const changes: ChangeSet = blocks
    .filter((b) => b.routineId === routine.id)
    .map((b) => put("blocks", { ...b, routineId: null, updatedAt: env.nowMs() }));
  changes.push(del("routines", routine.id));
  return changes;
}
