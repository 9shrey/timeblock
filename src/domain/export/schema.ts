/**
 * Import validation. zod schemas mirror the DB constraints (STRICT tables, CHECKs) so a file
 * that parses here can be written by `replaceAll` without a constraint failure. Referential
 * problems that have an obvious fix are repaired with a warning instead of rejecting the file.
 */
import { z } from "zod";
import { keyOf, targetKey } from "../changes";
import { parseSettings } from "../settings";
import { isLocalDate, weekStartOf } from "../time/localDate";
import type { Block, ExportData, Routine, Table, Template } from "../types";
import { EXPORT_FORMAT, EXPORT_VERSION, normalizeExportData } from "./format";

export type ImportResult =
  | { ok: true; data: ExportData; warnings: string[]; counts: Record<keyof ExportData, number> }
  | { ok: false; errors: string[] };

const MAX_ERRORS = 20;

/** Length in code points, matching SQLite's `length()` on TEXT. */
const charLen = (s: string) => [...s].length;

const text = (min: number, max: number) =>
  z.string().refine((s) => charLen(s) >= min && charLen(s) <= max, {
    message: `Must be ${min}–${max} characters`,
  });

const localDate = z.string().refine(isLocalDate, { message: "Must be a valid date (YYYY-MM-DD)" });
const timestamp = z.number().int();
const id = z.string().min(1, "Must not be empty");

export const settingRowSchema = z.object({
  key: z.string().min(1, "Must not be empty"),
  value: z.string(),
});

const goalFieldsLegacy = {
  id,
  name: text(1, 80),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a #rrggbb colour"),
  kind: z.enum(["min", "max"]),
  sortOrder: z.number().int(),
  archivedOn: localDate.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
};

/** v1/v2 shape (no `trackBy`): imported goals default to `trackBy: "time"`. */
export const goalSchemaLegacy = z.object(goalFieldsLegacy);

export const goalSchema = z.object({ ...goalFieldsLegacy, trackBy: z.enum(["time", "tasks"]) });

const weekTargetFieldsLegacy = {
  goalId: id,
  weekStart: localDate,
  targetMinutes: z.number().int().min(0).max(10080).nullable(),
  updatedAt: timestamp,
};

/** v1/v2 shape (no `targetCount`): imported targets default to `targetCount: null`. */
export const weekTargetSchemaLegacy = z.object(weekTargetFieldsLegacy);

export const weekTargetSchema = z.object({
  ...weekTargetFieldsLegacy,
  targetCount: z.number().int().min(0).max(10000).nullable(),
});

export const checklistItemSchema = z.object({
  id,
  goalId: id,
  weekStart: localDate,
  text: text(1, 500),
  done: z.boolean(),
  sortOrder: z.number().int(),
  carriedFromId: z.string().nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

/**
 * Layer/field mismatches (planBlockId on a plan block, skipped on an actual block) are
 * accepted here and repaired by `parseImportFile`.
 */
const blockFieldsV1 = {
  id,
  day: localDate,
  layer: z.enum(["plan", "actual"]),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
  title: z.string(),
  goalId: z.string().nullable(),
  notes: z.string(),
  planBlockId: z.string().nullable(),
  skipped: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
};

export const blockSchemaV1 = z
  .object(blockFieldsV1)
  .refine((b) => b.endMinute > b.startMinute, { message: "Must be after startMinute", path: ["endMinute"] });

export const blockSchema = z
  .object({ ...blockFieldsV1, routineId: z.string().nullable() })
  .refine((b) => b.endMinute > b.startMinute, { message: "Must be after startMinute", path: ["endMinute"] });

export const weekNoteSchema = z.object({
  weekStart: localDate,
  text: z.string(),
  updatedAt: timestamp,
});

const templateBlockSchema = z.object({
  dayOffset: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
  title: z.string(),
  goalId: z.string().nullable(),
  notes: z.string(),
});

export const templateSchema = z.object({
  id,
  name: text(1, 80),
  spanDays: z.union([z.literal(1), z.literal(7)]),
  blocks: z.array(templateBlockSchema),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const routineSchema = z.object({
  id,
  title: z.string(),
  goalId: z.string().nullable(),
  notes: z.string(),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
  weekdays: z.number().int().min(1).max(127),
  startsOn: localDate,
  endsOn: localDate.nullable(),
  materializedThrough: localDate.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const calendarSubscriptionSchema = z.object({
  id,
  name: text(1, 80),
  url: z
    .string()
    .max(2048, "Must be at most 2048 characters")
    .regex(/^https:\/\/./, "Must be an https:// URL"),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const exportFileSchemaV1 = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(1),
  exportedAt: timestamp,
  appVersion: z.string(),
  settings: z.array(settingRowSchema),
  goals: z.array(goalSchemaLegacy),
  weekTargets: z.array(weekTargetSchemaLegacy),
  checklistItems: z.array(checklistItemSchema),
  blocks: z.array(blockSchemaV1),
  weekNotes: z.array(weekNoteSchema),
});

const exportFileSchemaV2 = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(2),
  exportedAt: timestamp,
  appVersion: z.string(),
  settings: z.array(settingRowSchema),
  goals: z.array(goalSchemaLegacy),
  weekTargets: z.array(weekTargetSchemaLegacy),
  checklistItems: z.array(checklistItemSchema),
  templates: z.array(templateSchema),
  routines: z.array(routineSchema),
  blocks: z.array(blockSchema),
  weekNotes: z.array(weekNoteSchema),
});

const exportFileSchemaV3 = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(3),
  exportedAt: timestamp,
  appVersion: z.string(),
  settings: z.array(settingRowSchema),
  goals: z.array(goalSchema),
  weekTargets: z.array(weekTargetSchema),
  checklistItems: z.array(checklistItemSchema),
  templates: z.array(templateSchema),
  routines: z.array(routineSchema),
  blocks: z.array(blockSchema),
  weekNotes: z.array(weekNoteSchema),
});

const exportFileSchemaV4 = exportFileSchemaV3.extend({
  version: z.literal(EXPORT_VERSION),
  calendarSubscriptions: z.array(calendarSubscriptionSchema),
});

function formatPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const p of path) {
    if (typeof p === "number") out += `[${p}]`;
    else out += out ? `.${String(p)}` : String(p);
  }
  return out || "(file)";
}

function capErrors(errors: string[]): string[] {
  if (errors.length <= MAX_ERRORS) return errors;
  return [...errors.slice(0, MAX_ERRORS), `…and ${errors.length - MAX_ERRORS} more problems`];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function duplicateKeys(data: ExportData): string[] {
  const errors: string[] = [];
  const check = <T extends Table>(table: T, rows: readonly ExportData[T][number][]) => {
    const seen = new Set<string>();
    for (const row of rows) {
      const key = keyOf(table, row as never);
      if (seen.has(key)) errors.push(`${table}: duplicate key "${key}"`);
      seen.add(key);
    }
  };
  check("settings", data.settings);
  check("goals", data.goals);
  check("weekTargets", data.weekTargets);
  check("checklistItems", data.checklistItems);
  check("templates", data.templates);
  check("routines", data.routines);
  check("blocks", data.blocks);
  check("weekNotes", data.weekNotes);
  check("calendarSubscriptions", data.calendarSubscriptions);
  return errors;
}

/** Keeps the row with the larger `updatedAt` per key (first one wins ties); returns the dropped count. */
function dedupeNewest<T extends { updatedAt: number }>(rows: T[], keyFn: (r: T) => string): [T[], number] {
  const byKey = new Map<string, T>();
  for (const r of rows) {
    const k = keyFn(r);
    const prev = byKey.get(k);
    if (!prev || r.updatedAt > prev.updatedAt) byKey.set(k, r);
  }
  return [[...byKey.values()], rows.length - byKey.size];
}

/** Applies the documented repairs. Assumes rows are schema-valid and keys unique. */
function repair(input: ExportData): { data: ExportData; warnings: string[] } {
  const warnings: string[] = [];
  const goalIds = new Set(input.goals.map((g) => g.id));
  const { weekStartDay } = parseSettings(input.settings);
  const norm = (d: string) => weekStartOf(d, weekStartDay);

  // Templates.
  let danglingTemplateGoal = 0;
  const templates = input.templates.map((t): Template => {
    let changed = false;
    const blocks = t.blocks.map((b) => {
      if (b.goalId !== null && !goalIds.has(b.goalId)) {
        danglingTemplateGoal++;
        changed = true;
        return { ...b, goalId: null };
      }
      return b;
    });
    return changed ? { ...t, blocks } : t;
  });
  if (danglingTemplateGoal)
    warnings.push(`${plural(danglingTemplateGoal, "template block")} referenced a missing goal; the goal was cleared.`);

  // Routines.
  const routineIds = new Set(input.routines.map((r) => r.id));
  let danglingRoutineGoal = 0;
  const routines = input.routines.map((r): Routine => {
    if (r.goalId !== null && !goalIds.has(r.goalId)) {
      danglingRoutineGoal++;
      return { ...r, goalId: null };
    }
    return r;
  });
  if (danglingRoutineGoal)
    warnings.push(`${plural(danglingRoutineGoal, "routine")} referenced a missing goal; the goal was cleared.`);

  // Blocks.
  const byId = new Map(input.blocks.map((b) => [b.id, b]));
  let danglingGoal = 0;
  let planLinked = 0;
  let badLink = 0;
  let actualSkipped = 0;
  let danglingRoutine = 0;
  const blocks = input.blocks.map((b): Block => {
    let goalId = b.goalId;
    let planBlockId = b.planBlockId;
    let skipped = b.skipped;
    let routineId = b.routineId;
    if (goalId !== null && !goalIds.has(goalId)) {
      goalId = null;
      danglingGoal++;
    }
    if (planBlockId !== null) {
      if (b.layer === "plan") {
        planBlockId = null;
        planLinked++;
      } else {
        const target = byId.get(planBlockId);
        if (!target || target.layer !== "plan" || target.day !== b.day) {
          planBlockId = null;
          badLink++;
        }
      }
    }
    if (b.layer === "actual" && skipped) {
      skipped = false;
      actualSkipped++;
    }
    if (routineId !== null && (b.layer !== "plan" || !routineIds.has(routineId))) {
      routineId = null;
      danglingRoutine++;
    }
    return goalId === b.goalId &&
      planBlockId === b.planBlockId &&
      skipped === b.skipped &&
      routineId === b.routineId
      ? b
      : { ...b, goalId, planBlockId, skipped, routineId };
  });
  if (danglingGoal)
    warnings.push(`${plural(danglingGoal, "block")} referenced a missing goal; the goal was cleared.`);
  if (badLink)
    warnings.push(
      `${plural(badLink, "actual block")} linked to a missing, non-plan or other-day plan block; the link was cleared.`,
    );
  if (planLinked) warnings.push(`${plural(planLinked, "plan block")} had a plan link; the link was cleared.`);
  if (actualSkipped)
    warnings.push(`${plural(actualSkipped, "actual block")} had the skipped flag set; it was cleared.`);
  if (danglingRoutine)
    warnings.push(`${plural(danglingRoutine, "block")} referenced a missing routine or was not a plan block; the routine link was cleared.`);

  // Week targets.
  const keptTargets = input.weekTargets.filter((t) => goalIds.has(t.goalId));
  const orphanTargets = input.weekTargets.length - keptTargets.length;
  if (orphanTargets)
    warnings.push(`${plural(orphanTargets, "week target")} referenced a missing goal and ${orphanTargets === 1 ? "was" : "were"} dropped.`);
  let movedTargets = 0;
  const shiftedTargets = keptTargets.map((t) => {
    const weekStart = norm(t.weekStart);
    if (weekStart === t.weekStart) return t;
    movedTargets++;
    return { ...t, weekStart };
  });
  const [weekTargets, targetCollisions] = dedupeNewest(shiftedTargets, (t) => targetKey(t.goalId, t.weekStart));
  if (targetCollisions)
    warnings.push(
      `${plural(targetCollisions, "week target")} collided with another for the same goal and week after aligning to the week start; the most recently updated was kept.`,
    );

  // Checklist items.
  const keptItems = input.checklistItems.filter((c) => goalIds.has(c.goalId));
  const orphanItems = input.checklistItems.length - keptItems.length;
  if (orphanItems)
    warnings.push(`${plural(orphanItems, "checklist item")} referenced a missing goal and ${orphanItems === 1 ? "was" : "were"} dropped.`);
  let movedItems = 0;
  const checklistItems = keptItems.map((c) => {
    const weekStart = norm(c.weekStart);
    if (weekStart === c.weekStart) return c;
    movedItems++;
    return { ...c, weekStart };
  });

  // Week notes.
  let movedNotes = 0;
  const shiftedNotes = input.weekNotes.map((n) => {
    const weekStart = norm(n.weekStart);
    if (weekStart === n.weekStart) return n;
    movedNotes++;
    return { ...n, weekStart };
  });
  const [weekNotes, noteCollisions] = dedupeNewest(shiftedNotes, (n) => n.weekStart);
  if (noteCollisions)
    warnings.push(
      `${plural(noteCollisions, "week note")} collided with another for the same week after aligning to the week start; the most recently updated was kept.`,
    );

  const moved = movedTargets + movedItems + movedNotes;
  if (moved)
    warnings.push(`${plural(moved, "week entry", "week entries")} did not start on the configured week start day and ${moved === 1 ? "was" : "were"} realigned.`);

  return {
    data: {
      settings: input.settings,
      goals: input.goals,
      weekTargets,
      checklistItems,
      templates,
      routines,
      blocks,
      weekNotes,
      calendarSubscriptions: input.calendarSubscriptions,
    },
    warnings,
  };
}

/**
 * Parses and validates an export file. Returns sorted, repaired data plus human-readable
 * warnings, or the reasons the file cannot be imported.
 */
export function parseImportFile(text: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["The file is not valid JSON."] };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return { ok: false, errors: ["The file is not a Timeblock export."] };
  const envelope = raw as Record<string, unknown>;
  if (envelope.format !== EXPORT_FORMAT) return { ok: false, errors: ["The file is not a Timeblock export."] };
  const version = envelope.version;
  if (typeof version === "number" && version > EXPORT_VERSION)
    return {
      ok: false,
      errors: [`This file was made by a newer version of Timeblock (export version ${version}). Update the app to import it.`],
    };
  if (version !== 1 && version !== 2 && version !== 3 && version !== EXPORT_VERSION)
    return { ok: false, errors: [`Unsupported export version: ${JSON.stringify(version) ?? "missing"}.`] };

  /** v1/v2 goals/targets lack `trackBy`/`targetCount`; default them. */
  const withTaskDefaults = (
    goals: readonly z.infer<typeof goalSchemaLegacy>[],
    weekTargets: readonly z.infer<typeof weekTargetSchemaLegacy>[],
  ): { goals: ExportData["goals"]; weekTargets: ExportData["weekTargets"] } => ({
    goals: goals.map((g) => ({ ...g, trackBy: "time" as const })),
    weekTargets: weekTargets.map((t) => ({ ...t, targetCount: null })),
  });

  let valid: ExportData;
  if (version === 1) {
    const parsed = exportFileSchemaV1.safeParse(raw);
    if (!parsed.success)
      return {
        ok: false,
        errors: capErrors(parsed.error.issues.map((i) => `${formatPath(i.path)}: ${i.message}`)),
      };
    const { settings, goals, weekTargets, checklistItems, blocks, weekNotes } = parsed.data;
    valid = {
      settings,
      ...withTaskDefaults(goals, weekTargets),
      checklistItems,
      templates: [],
      routines: [],
      blocks: blocks.map((b) => ({ ...b, routineId: null })),
      weekNotes,
      calendarSubscriptions: [],
    };
  } else if (version === 2) {
    const parsed = exportFileSchemaV2.safeParse(raw);
    if (!parsed.success)
      return {
        ok: false,
        errors: capErrors(parsed.error.issues.map((i) => `${formatPath(i.path)}: ${i.message}`)),
      };
    const { settings, goals, weekTargets, checklistItems, templates, routines, blocks, weekNotes } = parsed.data;
    valid = { settings, ...withTaskDefaults(goals, weekTargets), checklistItems, templates, routines, blocks, weekNotes, calendarSubscriptions: [] };
  } else if (version === 3) {
    const parsed = exportFileSchemaV3.safeParse(raw);
    if (!parsed.success)
      return {
        ok: false,
        errors: capErrors(parsed.error.issues.map((i) => `${formatPath(i.path)}: ${i.message}`)),
      };
    const { settings, goals, weekTargets, checklistItems, templates, routines, blocks, weekNotes } = parsed.data;
    valid = { settings, goals, weekTargets, checklistItems, templates, routines, blocks, weekNotes, calendarSubscriptions: [] };
  } else {
    const parsed = exportFileSchemaV4.safeParse(raw);
    if (!parsed.success)
      return {
        ok: false,
        errors: capErrors(parsed.error.issues.map((i) => `${formatPath(i.path)}: ${i.message}`)),
      };
    const { settings, goals, weekTargets, checklistItems, templates, routines, blocks, weekNotes, calendarSubscriptions } = parsed.data;
    valid = { settings, goals, weekTargets, checklistItems, templates, routines, blocks, weekNotes, calendarSubscriptions };
  }
  const dupes = duplicateKeys(valid);
  if (dupes.length) return { ok: false, errors: capErrors(dupes) };

  const { data: repaired, warnings } = repair(valid);
  const data = normalizeExportData(repaired);
  return {
    ok: true,
    data,
    warnings,
    counts: {
      settings: data.settings.length,
      goals: data.goals.length,
      weekTargets: data.weekTargets.length,
      checklistItems: data.checklistItems.length,
      templates: data.templates.length,
      routines: data.routines.length,
      blocks: data.blocks.length,
      weekNotes: data.weekNotes.length,
      calendarSubscriptions: data.calendarSubscriptions.length,
    },
  };
}
