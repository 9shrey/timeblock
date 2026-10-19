/** Template actions: save a day/week as a template, apply one, rename, delete. */
import { toast } from "sonner";
import {
  applyDayTemplate,
  applyWeekTemplate,
  deleteTemplateChanges,
  MAX_TEMPLATE_NAME_LENGTH,
  renameTemplateChanges,
  templateFromDay,
  templateFromWeek,
} from "@/domain/templates";
import { systemEnv } from "@/domain/env";
import { weekDays, weekStartOf } from "@/domain/time/localDate";
import type { LocalDate, Template } from "@/domain/types";
import { canEditLane, isPlanLocked } from "./commands";
import { activeGoals, allBlocks, templateList } from "./selectors";
import { commit, useStore } from "./store";

const env = systemEnv;
const state = () => useStore.getState();

function validName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_TEMPLATE_NAME_LENGTH) {
    toast.error(`Template names need 1–${MAX_TEMPLATE_NAME_LENGTH} characters.`);
    return null;
  }
  return trimmed;
}

export function saveDayAsTemplate(day: LocalDate, name: string): Template | null {
  const trimmed = validName(name);
  if (!trimmed) return null;
  const { template, changes } = templateFromDay(trimmed, day, allBlocks(state().data.blocks), env);
  if (template.blocks.length === 0) {
    toast("That day has no plan to save.");
    return null;
  }
  commit(changes, { label: "Save day template" });
  return template;
}

export function saveWeekAsTemplate(weekStart: LocalDate, name: string): Template | null {
  const trimmed = validName(name);
  if (!trimmed) return null;
  const { template, changes } = templateFromWeek(trimmed, weekStart, allBlocks(state().data.blocks), env);
  if (template.blocks.length === 0) {
    toast("That week has no plan to save.");
    return null;
  }
  commit(changes, { label: "Save week template" });
  return template;
}

/** Applies a day template to `day`. No-op (with a toast) if the day's plan lane is locked. */
export function applyTemplateToDay(template: Template, day: LocalDate): boolean {
  if (!canEditLane(day, "plan")) {
    toast("This day's plan is locked. Click the lock icon to edit it.");
    return false;
  }
  const activeGoalIds = new Set(activeGoals(state().data, weekStartOf(day, state().settings.weekStartDay)).map((g) => g.id));
  const changes = applyDayTemplate(template, day, activeGoalIds, env);
  if (changes.length === 0) {
    toast("This template has no blocks.");
    return false;
  }
  commit(changes, { label: `Apply template "${template.name}"` });
  return true;
}

/**
 * Applies a week template to the week starting at `weekStart`. Locked and past days are
 * skipped, as with `copyWeekPlan`.
 */
export function applyTemplateToWeek(template: Template, weekStart: LocalDate): boolean {
  const now = state().now;
  const days = new Set(weekDays(weekStart).filter((d) => d >= now.day && !isPlanLocked(d)));
  if (days.size === 0) {
    toast("No unlocked, upcoming days to apply the template to.");
    return false;
  }
  const activeGoalIds = new Set(activeGoals(state().data, weekStart).map((g) => g.id));
  const changes = applyWeekTemplate(template, weekStart, days, activeGoalIds, env);
  if (changes.length === 0) {
    toast("This template has no blocks for those days.");
    return false;
  }
  commit(changes, { label: `Apply template "${template.name}"` });
  return true;
}

export function renameTemplate(template: Template, name: string): void {
  const trimmed = validName(name);
  if (!trimmed) return;
  commit(renameTemplateChanges(template, trimmed, env), { label: "Rename template" });
}

export function deleteTemplate(template: Template): void {
  commit(deleteTemplateChanges(template), { label: "Delete template" });
}

export function templates(): Template[] {
  return templateList(state().data.templates);
}
