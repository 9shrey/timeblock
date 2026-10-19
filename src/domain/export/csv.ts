/**
 * CSV export: blocks for a date range, and weekly per-goal stats, next to the JSON export.
 * Deterministic output (fixed column order, sorted rows), matching the discipline of
 * `format.ts`'s JSON export.
 */
import { formatMinute } from "../time/localDate";
import type { Block, Goal, LocalDate } from "../types";

function csvField(value: string | number | null): string {
  const s = value === null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(fields: readonly (string | number | null)[]): string {
  return fields.map(csvField).join(",");
}

const BLOCKS_HEADER = ["day", "layer", "start", "end", "title", "goal", "skipped", "linked_plan_id"] as const;

/** One row per block, sorted by day/layer/start/id so two exports of the same data match byte-for-byte. */
export function blocksToCsv(blocks: readonly Block[], goalsById: ReadonlyMap<string, Goal>): string {
  const sorted = [...blocks].sort(
    (a, b) => a.day.localeCompare(b.day) || a.layer.localeCompare(b.layer) || a.startMinute - b.startMinute || a.id.localeCompare(b.id),
  );
  const lines = sorted.map((b) =>
    csvRow([
      b.day,
      b.layer,
      formatMinute(b.startMinute),
      formatMinute(b.endMinute),
      b.title,
      b.goalId ? (goalsById.get(b.goalId)?.name ?? "") : "",
      b.skipped ? "1" : "0",
      b.planBlockId ?? "",
    ]),
  );
  return [csvRow(BLOCKS_HEADER), ...lines].join("\n") + "\n";
}

export interface WeeklyGoalRow {
  weekStart: LocalDate;
  goalName: string;
  plannedMinutes: number;
  actualMinutes: number;
  targetMinutes: number | null;
  status: string;
}

const WEEKLY_HEADER = ["week_start", "goal", "planned_minutes", "actual_minutes", "target_minutes", "status"] as const;

/** One row per (week, goal), sorted by week then goal name. */
export function weeklyStatsToCsv(rows: readonly WeeklyGoalRow[]): string {
  const sorted = [...rows].sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.goalName.localeCompare(b.goalName));
  const lines = sorted.map((r) => csvRow([r.weekStart, r.goalName, r.plannedMinutes, r.actualMinutes, r.targetMinutes, r.status]));
  return [csvRow(WEEKLY_HEADER), ...lines].join("\n") + "\n";
}

/** `timeblock-blocks-2026-10-01-to-2026-10-31.csv` / `timeblock-weekly-stats-….csv`. */
export function csvFileName(kind: "blocks" | "weekly-stats", fromDay: LocalDate, toDay: LocalDate): string {
  return `timeblock-${kind}-${fromDay}-to-${toDay}.csv`;
}
