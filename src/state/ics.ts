/**
 * The imported-calendar overlay: read-only events from an `.ics` file, kept in memory only
 * (never written to the database) until explicitly copied into a plan block.
 */
import { create } from "zustand";
import { toast } from "sonner";
import { systemEnv } from "@/domain/env";
import { toIcs } from "@/domain/ics/export";
import { parseIcs, type IcsEvent } from "@/domain/ics/parse";
import { addDays, weekStartOf } from "@/domain/time/localDate";
import type { LocalDate } from "@/domain/types";
import { getPlatform, ICS_FILTER } from "@/platform";
import { copyIcsEventToPlan } from "./commands";
import { allBlocks } from "./selectors";
import { ensureWeek, useStore } from "./store";

interface IcsOverlayState {
  events: IcsEvent[];
  fileName: string | null;
}

export const useIcsOverlay = create<IcsOverlayState>(() => ({ events: [], fileName: null }));

export const useIcsEventsOn = (day: LocalDate): IcsEvent[] => useIcsOverlay((s) => s.events.filter((e) => e.day === day));

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Opens a file picker and loads its events into the overlay, replacing any already loaded. */
export async function importIcsFile(): Promise<void> {
  try {
    const file = await (await getPlatform()).openTextFile(ICS_FILTER);
    if (!file) return;
    const events = parseIcs(file.contents);
    useIcsOverlay.setState({ events, fileName: file.path });
    toast.success(`Imported ${events.length} event${events.length === 1 ? "" : "s"}`, { description: file.path });
  } catch (e) {
    toast.error("Could not import the calendar file", { description: errorText(e) });
  }
}

export function clearIcsOverlay(): void {
  useIcsOverlay.setState({ events: [], fileName: null });
}

/** Copies an overlay event into an ordinary, undoable plan block. */
export function copyToPlan(event: IcsEvent): void {
  copyIcsEventToPlan(event.day, event.startMinute, event.endMinute, event.title);
}

/** Exports the plan and actual blocks from `from` to `to` (inclusive) as an `.ics` file. */
export async function exportIcs(from: LocalDate, to: LocalDate): Promise<void> {
  try {
    const platform = await getPlatform();
    const weekStartDay = useStore.getState().settings.weekStartDay;
    const weekStarts = new Set<LocalDate>();
    for (let d = from; d <= to; d = addDays(d, 1)) weekStarts.add(weekStartOf(d, weekStartDay));
    await Promise.all([...weekStarts].map(ensureWeek));

    const text = toIcs({ blocks: allBlocks(useStore.getState().data.blocks), from, to, generatedAtMs: systemEnv.nowMs() });
    const path = await platform.saveTextFile(`timeblock-${from}-to-${to}.ics`, text, ICS_FILTER);
    if (path) toast.success("Exported", { description: path });
  } catch (e) {
    toast.error("Export failed", { description: errorText(e) });
  }
}
