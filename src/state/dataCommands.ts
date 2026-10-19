/** Export / import / backup. Import replaces everything in one transaction after a forced backup. */
import { toast } from "sonner";
import { put } from "@/domain/changes";
import { blocksToCsv, csvFileName, weeklyStatsToCsv, type WeeklyGoalRow } from "@/domain/export/csv";
import { exportFileName, serializeExport, toExportFile } from "@/domain/export/format";
import { parseImportFile, type ImportResult } from "@/domain/export/schema";
import { systemEnv } from "@/domain/env";
import { settingRow } from "@/domain/settings";
import { computeStats } from "@/domain/stats/stats";
import { addDays, weekDays, weekStartOf } from "@/domain/time/localDate";
import type { ExportData, Settings } from "@/domain/types";
import { getPlatform } from "@/platform";
import { goalList, targetList } from "./selectors";
import { commit, flushWrites, getRepo, useStore, reloadAll } from "./store";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function exportJson(): Promise<void> {
  try {
    await flushWrites();
    const platform = await getPlatform();
    const data = await getRepo().exportAll();
    const file = toExportFile(data, { appVersion: await platform.appVersion(), exportedAt: systemEnv.nowMs() });
    const path = await platform.saveTextFile(exportFileName(useStore.getState().now.day), serializeExport(file));
    if (path) toast.success("Exported", { description: path });
  } catch (e) {
    toast.error("Export failed", { description: errorText(e) });
  }
}

/**
 * Exports blocks for the last `weeks` weeks (through the current week) as CSV, plus the
 * same range's weekly per-goal stats, next to the JSON export. Two files (the platform's
 * save dialog runs twice); each is independent and deterministic.
 */
export async function exportCsv(weeks = 12): Promise<void> {
  try {
    await flushWrites();
    const platform = await getPlatform();
    const repo = getRepo();
    const s = useStore.getState();
    const currentWeekStart = weekStartOf(s.now.day, s.settings.weekStartDay);
    const toExclusive = addDays(currentWeekStart, 7);
    const fromWeek = addDays(toExclusive, -7 * weeks);
    const toInclusive = addDays(toExclusive, -1);

    const blocks = await repo.loadBlocksRange(fromWeek, toExclusive);
    const goalsById = new Map(goalList(s.data.goals).map((g) => [g.id, g] as const));
    const targets = targetList(s.data.weekTargets);
    const goals = goalList(s.data.goals);

    const rows: WeeklyGoalRow[] = [];
    for (let i = 0; i < weeks; i++) {
      const weekStart = addDays(fromWeek, i * 7);
      const days = weekDays(weekStart);
      const daySet = new Set(days);
      const weekBlocks = blocks.filter((b) => daySet.has(b.day));
      const stats = computeStats({ days, weekStart, blocks: weekBlocks, goals, targets, checklist: [], now: s.now });
      for (const g of stats.goals) {
        rows.push({
          weekStart,
          goalName: g.goal?.name ?? "Unassigned",
          plannedMinutes: g.planned,
          actualMinutes: g.actual,
          targetMinutes: g.target,
          status: g.status,
        });
      }
    }

    const blocksPath = await platform.saveTextFile(csvFileName("blocks", fromWeek, toInclusive), blocksToCsv(blocks, goalsById));
    const statsPath = await platform.saveTextFile(csvFileName("weekly-stats", fromWeek, toInclusive), weeklyStatsToCsv(rows));
    if (blocksPath || statsPath) {
      toast.success("Exported CSV", { description: [blocksPath, statsPath].filter(Boolean).join(", ") });
    }
  } catch (e) {
    toast.error("CSV export failed", { description: errorText(e) });
  }
}

/** Opens a file and validates it. Returns null if the user cancelled. */
export async function pickImportFile(): Promise<{ name: string; result: ImportResult } | null> {
  try {
    const file = await (await getPlatform()).openTextFile();
    if (!file) return null;
    return { name: file.path, result: parseImportFile(file.contents) };
  } catch (e) {
    return { name: "", result: { ok: false, errors: [errorText(e)] } };
  }
}

/** Replaces all data with `data` after a pre-import backup. */
export async function applyImport(data: ExportData): Promise<boolean> {
  try {
    await flushWrites();
    const platform = await getPlatform();
    const backup = await platform.backupNow("pre-import");
    await getRepo().replaceAll(data);
    await reloadAll();
    toast.success("Import complete", { description: backup ? `Previous data backed up to ${backup}` : undefined });
    return true;
  } catch (e) {
    toast.error("Import failed; nothing was changed", { description: errorText(e) });
    await reloadAll().catch(() => {});
    return false;
  }
}

export async function backupNow(): Promise<void> {
  try {
    const path = await (await getPlatform()).backupNow("manual");
    if (path) toast.success("Backup created", { description: path });
    else toast("Backups are only available in the desktop app.");
  } catch (e) {
    toast.error("Backup failed", { description: errorText(e) });
  }
}

/** Saves a preference. Not part of undo history. */
export function setSetting<K extends Exclude<keyof Settings, "weekStartDay">>(key: K, value: Settings[K]): void {
  commit([put("settings", settingRow(key, value))], { noHistory: true });
}
