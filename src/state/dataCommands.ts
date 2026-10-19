/** Export / import / backup. Import replaces everything in one transaction after a forced backup. */
import { toast } from "sonner";
import { put } from "@/domain/changes";
import { systemEnv } from "@/domain/env";
import { exportFileName, serializeExport, toExportFile } from "@/domain/export/format";
import { parseImportFile, type ImportResult } from "@/domain/export/schema";
import { buildIcs, parseIcs } from "@/domain/ics/ics";
import { settingRow } from "@/domain/settings";
import { compareDates } from "@/domain/time/localDate";
import type { ExportData, LocalDate, Settings } from "@/domain/types";
import { getPlatform } from "@/platform";
import { allBlocks } from "./selectors";
import { setImportedIcs } from "./ics";
import { commit, flushWrites, getRepo, reloadAll, useStore } from "./store";

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

/**
 * Opens a `.ics` file and parses it into the read-only import overlay (`state/ics.ts`).
 * Nothing is written to the plan until the user copies individual events over.
 */
export async function importIcsFile(): Promise<void> {
  try {
    const file = await (await getPlatform()).openIcsFile();
    if (!file) return;
    const { events, skipped } = parseIcs(file.contents);
    setImportedIcs(file.path, events, skipped);
    if (events.length === 0 && skipped.length === 0) toast("That file has no events to import.");
  } catch (e) {
    toast.error("Couldn't import that file", { description: errorText(e) });
  }
}

/** Exports the plan and actual blocks in `[from, to]` (inclusive) as a `.ics` file. */
export async function exportIcs(from: LocalDate, to: LocalDate): Promise<void> {
  try {
    const blocks = allBlocks(useStore.getState().data.blocks).filter((b) => compareDates(b.day, from) >= 0 && compareDates(b.day, to) <= 0);
    if (blocks.length === 0) {
      toast("No blocks in that range.");
      return;
    }
    const text = buildIcs(
      blocks.map((b) => ({
        uid: `${b.id}@timeblock`,
        summary: b.layer === "actual" ? `${b.title || "Untitled"} (actual)` : b.title || "Untitled",
        description: b.notes || undefined,
        day: b.day,
        startMinute: b.startMinute,
        endMinute: b.endMinute,
        stamp: b.updatedAt,
      })),
    );
    const platform = await getPlatform();
    const path = await platform.saveIcsFile(`timeblock-${from}-to-${to}.ics`, text);
    if (path) toast.success("Exported", { description: path });
  } catch (e) {
    toast.error("Export failed", { description: errorText(e) });
  }
}
