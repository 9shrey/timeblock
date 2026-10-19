/**
 * Export file construction. Output is deterministic (rows sorted by primary key, keys in a
 * fixed order) so two exports of the same data are byte-identical and diff cleanly.
 */
import { keyOf } from "../changes";
import type {
  Block,
  ChecklistItem,
  EntityMap,
  ExportData,
  ExportFileV1,
  Goal,
  LocalDate,
  SettingRow,
  Table,
  WeekNote,
  WeekTarget,
} from "../types";

export const EXPORT_FORMAT = "timeblock.export";
export const EXPORT_VERSION = 1;

/** Code-unit order, independent of locale. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortRows<T extends Table>(table: T, rows: readonly EntityMap[T][]): EntityMap[T][] {
  return rows
    .map((row) => ({ row, key: keyOf(table, row) }))
    .sort((a, b) => cmp(a.key, b.key))
    .map((x) => x.row);
}

// Copies each row with its keys in a fixed order (and drops any stray extra fields).

const settingOut = (r: SettingRow): SettingRow => ({ key: r.key, value: r.value });

const goalOut = (g: Goal): Goal => ({
  id: g.id,
  name: g.name,
  color: g.color,
  kind: g.kind,
  sortOrder: g.sortOrder,
  archivedOn: g.archivedOn,
  createdAt: g.createdAt,
  updatedAt: g.updatedAt,
});

const targetOut = (t: WeekTarget): WeekTarget => ({
  goalId: t.goalId,
  weekStart: t.weekStart,
  targetMinutes: t.targetMinutes,
  updatedAt: t.updatedAt,
});

const itemOut = (c: ChecklistItem): ChecklistItem => ({
  id: c.id,
  goalId: c.goalId,
  weekStart: c.weekStart,
  text: c.text,
  done: c.done,
  sortOrder: c.sortOrder,
  carriedFromId: c.carriedFromId,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

const blockOut = (b: Block): Block => ({
  id: b.id,
  day: b.day,
  layer: b.layer,
  startMinute: b.startMinute,
  endMinute: b.endMinute,
  title: b.title,
  goalId: b.goalId,
  notes: b.notes,
  planBlockId: b.planBlockId,
  skipped: b.skipped,
  createdAt: b.createdAt,
  updatedAt: b.updatedAt,
});

const noteOut = (n: WeekNote): WeekNote => ({ weekStart: n.weekStart, text: n.text, updatedAt: n.updatedAt });

/** Sorts every table by primary key and copies rows with a stable key order. */
export function normalizeExportData(data: ExportData): ExportData {
  return {
    settings: sortRows("settings", data.settings).map(settingOut),
    goals: sortRows("goals", data.goals).map(goalOut),
    weekTargets: sortRows("weekTargets", data.weekTargets).map(targetOut),
    checklistItems: sortRows("checklistItems", data.checklistItems).map(itemOut),
    blocks: sortRows("blocks", data.blocks).map(blockOut),
    weekNotes: sortRows("weekNotes", data.weekNotes).map(noteOut),
  };
}

/** Wraps all data in a v1 export envelope with deterministic ordering. */
export function toExportFile(data: ExportData, meta: { appVersion: string; exportedAt: number }): ExportFileV1 {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: meta.exportedAt,
    appVersion: meta.appVersion,
    ...normalizeExportData(data),
  };
}

/** Pretty-printed JSON with a trailing newline. */
export function serializeExport(file: ExportFileV1): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** `timeblock-export-YYYY-MM-DD.json`. */
export function exportFileName(day: LocalDate): string {
  return `timeblock-export-${day}.json`;
}
