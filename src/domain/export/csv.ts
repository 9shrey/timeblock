/** Plain CSV formatters for blocks and weekly goal stats, next to the JSON/ICS export. */
import { formatMinute } from "../time/localDate";
import type { GoalStats } from "../stats/stats";
import type { Block, Goal, LocalDate } from "../types";

function csvField(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(fields: readonly (string | number)[]): string {
  return fields.map(csvField).join(",") + "\r\n";
}

/** The plan and actual blocks from `from` to `to` (inclusive) as a CSV, one row per block. */
export function blocksToCsv(blocks: readonly Block[], goals: Readonly<Record<string, Goal>>, from: LocalDate, to: LocalDate): string {
  const inRange = blocks.filter((b) => b.day >= from && b.day <= to).sort((a, b) => a.day.localeCompare(b.day) || a.startMinute - b.startMinute);
  let csv = csvRow(["day", "layer", "start", "end", "title", "goal", "notes", "skipped"]);
  for (const b of inRange) {
    csv += csvRow([b.day, b.layer, formatMinute(b.startMinute), formatMinute(b.endMinute), b.title, b.goalId ? goals[b.goalId]?.name ?? "" : "", b.notes, b.skipped ? "yes" : "no"]);
  }
  return csv;
}

/** One week's per-goal stats (as shown on the Review page) as a CSV, one row per goal. */
export function goalStatsToCsv(goals: readonly GoalStats[], unassigned: GoalStats | null): string {
  let csv = csvRow(["goal", "kind", "target_minutes", "planned_minutes", "actual_minutes", "unplanned_minutes", "skipped_minutes", "status"]);
  for (const g of goals) csv += csvRow([g.goal?.name ?? "", g.kind, g.target ?? "", g.planned, g.actual, g.unplanned, g.skipped, g.status]);
  if (unassigned) csv += csvRow(["(no goal)", unassigned.kind, "", unassigned.planned, unassigned.actual, unassigned.unplanned, unassigned.skipped, unassigned.status]);
  return csv;
}
