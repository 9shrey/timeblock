/**
 * Templates: a saved day or week of plan blocks that can be stamped onto another day or
 * week. Templates never link to the blocks they created (applying makes ordinary, freely
 * editable plan blocks); nor to goals in a way that survives a goal's deletion — the goal
 * link is just copied onto each created block (and dropped if that goal is archived or gone).
 */
import { del, put } from "./changes";
import { addDays, weekDays } from "./time/localDate";
import type { Block, ChangeSet, Env, LocalDate, Template, TemplateBlock } from "./types";

export const MAX_TEMPLATE_NAME_LENGTH = 80;

/** Builds a day template from `day`'s plan blocks. */
export function templateFromDay(name: string, day: LocalDate, blocks: readonly Block[], env: Env): { template: Template; changes: ChangeSet } {
  return buildTemplate(name, 1, blocksToTemplateBlocks(blocks.filter((b) => b.layer === "plan" && b.day === day), day), env);
}

/** Builds a week template from every plan block of the week starting at `weekStart`. */
export function templateFromWeek(name: string, weekStart: LocalDate, blocks: readonly Block[], env: Env): { template: Template; changes: ChangeSet } {
  const days = weekDays(weekStart);
  const inWeek = blocks.filter((b) => b.layer === "plan" && days.includes(b.day));
  return buildTemplate(name, 7, blocksToTemplateBlocks(inWeek, weekStart), env);
}

function blocksToTemplateBlocks(blocks: readonly Block[], referenceDay: LocalDate): TemplateBlock[] {
  return blocks
    .map((b): TemplateBlock => ({
      dayOffset: dayOffsetOf(referenceDay, b.day),
      startMinute: b.startMinute,
      endMinute: b.endMinute,
      title: b.title,
      goalId: b.goalId,
      notes: b.notes,
    }))
    .sort((a, b) => a.dayOffset - b.dayOffset || a.startMinute - b.startMinute || a.endMinute - b.endMinute);
}

function dayOffsetOf(weekStart: LocalDate, day: LocalDate): number {
  for (let i = 0; i < 7; i++) if (addDays(weekStart, i) === day) return i;
  return 0;
}

function buildTemplate(name: string, spanDays: 1 | 7, blocks: TemplateBlock[], env: Env): { template: Template; changes: ChangeSet } {
  const t = env.nowMs();
  const template: Template = { id: env.newId(), name: name.trim(), spanDays, blocks, createdAt: t, updatedAt: t };
  return { template, changes: [put("templates", template)] };
}

/** Renames a template (trimmed). No-op if the trimmed name is unchanged. */
export function renameTemplateChanges(template: Template, name: string, env: Env): ChangeSet {
  const trimmed = name.trim();
  return trimmed === template.name ? [] : [put("templates", { ...template, name: trimmed, updatedAt: env.nowMs() })];
}

export function deleteTemplateChanges(template: Template): ChangeSet {
  return [del("templates", template.id)];
}

/**
 * Applies a day template to `day`: one new plan block per template block (dayOffset is
 * ignored). A block whose goal isn't in `activeGoalIds` is created without a goal.
 */
export function applyDayTemplate(
  template: Template,
  day: LocalDate,
  activeGoalIds: ReadonlySet<string>,
  env: Env,
): ChangeSet {
  return template.blocks.map((tb) => newPlanBlock(tb, day, activeGoalIds, env));
}

/**
 * Applies a week template to the week starting at `weekStart`, writing only the days in
 * `days` (so locked/past days can be excluded by the caller).
 */
export function applyWeekTemplate(
  template: Template,
  weekStart: LocalDate,
  days: ReadonlySet<LocalDate>,
  activeGoalIds: ReadonlySet<string>,
  env: Env,
): ChangeSet {
  return template.blocks
    .filter((tb) => days.has(addDays(weekStart, tb.dayOffset)))
    .map((tb) => newPlanBlock(tb, addDays(weekStart, tb.dayOffset), activeGoalIds, env));
}

function newPlanBlock(tb: TemplateBlock, day: LocalDate, activeGoalIds: ReadonlySet<string>, env: Env): ChangeSet[number] {
  const t = env.nowMs();
  const block: Block = {
    id: env.newId(),
    day,
    layer: "plan",
    startMinute: tb.startMinute,
    endMinute: tb.endMinute,
    title: tb.title,
    goalId: tb.goalId !== null && activeGoalIds.has(tb.goalId) ? tb.goalId : null,
    notes: tb.notes,
    planBlockId: null,
    skipped: false,
    routineId: null,
    createdAt: t,
    updatedAt: t,
  };
  return put("blocks", block);
}
