/**
 * The imported-calendar overlay: read-only events from an `.ics` file and from calendar
 * subscriptions (URLs re-fetched on launch, every 30 minutes, and on demand). Events are kept
 * in memory only (never written to the database) until explicitly copied into a plan block;
 * only the subscriptions themselves are stored.
 *
 * Recurring series are expanded for a window of weeks around the cursor, re-expanded when
 * the cursor moves out of it.
 */
import { create } from "zustand";
import { toast } from "sonner";
import { systemEnv } from "@/domain/env";
import { toIcs } from "@/domain/ics/export";
import { expandCalendar, parseCalendar, type IcsEvent, type IcsRange, type ParsedCalendar } from "@/domain/ics/parse";
import { addSubscriptionChanges, removeSubscriptionChanges, SUBSCRIPTION_REFRESH_MS } from "@/domain/ics/subscriptions";
import { addDays, weekStartOf } from "@/domain/time/localDate";
import type { CalendarSubscription, LocalDate } from "@/domain/types";
import { getPlatform, ICS_FILTER, type Platform } from "@/platform";
import { copyIcsEventToPlan } from "./commands";
import { allBlocks, subscriptionList } from "./selectors";
import { commit, ensureWeek, useStore } from "./store";

export interface SubscriptionStatus {
  loading: boolean;
  /** The last refresh's error; events from the last good fetch stay shown. */
  error: string | null;
  /** When the last successful fetch finished (ms). */
  fetchedAt: number | null;
}

interface IcsOverlayState {
  /** Every source's events within `range`. */
  events: IcsEvent[];
  fileName: string | null;
  range: IcsRange | null;
  /** By subscription id. */
  status: Record<string, SubscriptionStatus>;
}

export const useIcsOverlay = create<IcsOverlayState>(() => ({ events: [], fileName: null, range: null, status: {} }));

const FILE_SOURCE = "file";
/** Weeks expanded before and after the cursor's week. */
const WEEKS_BEFORE = 2;
const WEEKS_AFTER = 8;

/** Parsed calendars by source: `FILE_SOURCE` or a subscription id. Kept out of zustand (large, mutable ical.js objects). */
const calendars = new Map<string, ParsedCalendar>();
/** The URL each subscription's calendar was fetched from, to notice an edited link. */
const fetchedUrls = new Map<string, string>();

const EMPTY: readonly IcsEvent[] = [];

/** Groups events by day once per `events` array identity, so a day with no events keeps a stable (empty) reference. */
let lastEvents: IcsEvent[] | null = null;
let lastByDay = new Map<LocalDate, IcsEvent[]>();
function eventsByDay(events: IcsEvent[]): Map<LocalDate, IcsEvent[]> {
  if (events === lastEvents) return lastByDay;
  const byDay = new Map<LocalDate, IcsEvent[]>();
  for (const e of events) {
    const list = byDay.get(e.day);
    if (list) list.push(e);
    else byDay.set(e.day, [e]);
  }
  lastEvents = events;
  lastByDay = byDay;
  return byDay;
}

export const useIcsEventsOn = (day: LocalDate): readonly IcsEvent[] => useIcsOverlay((s) => eventsByDay(s.events).get(day) ?? EMPTY);

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

function rangeAround(day: LocalDate): IcsRange {
  const weekStart = weekStartOf(day, useStore.getState().settings.weekStartDay);
  return { from: addDays(weekStart, -7 * WEEKS_BEFORE), to: addDays(weekStart, 7 * (WEEKS_AFTER + 1)) };
}

/** Re-expands every source for the current range. */
function rebuild(): void {
  const range = useIcsOverlay.getState().range ?? rangeAround(useStore.getState().cursor);
  const events: IcsEvent[] = [];
  for (const [source, calendar] of calendars) {
    for (const e of expandCalendar(calendar, range)) events.push({ ...e, id: `${source}:${e.id}` });
  }
  events.sort((a, b) => a.day.localeCompare(b.day) || a.startMinute - b.startMinute);
  useIcsOverlay.setState({ events, range });
}

/** Moves the expansion window when `day`'s week (and the one either side) isn't inside it. */
function followCursor(day: LocalDate): void {
  const { range } = useIcsOverlay.getState();
  if (range && day >= addDays(range.from, 7) && day < addDays(range.to, -7)) return;
  useIcsOverlay.setState({ range: rangeAround(day) });
  if (calendars.size > 0) rebuild();
}

function setStatus(id: string, patch: Partial<SubscriptionStatus>): void {
  const prev = useIcsOverlay.getState().status[id] ?? { loading: false, error: null, fetchedAt: null };
  useIcsOverlay.setState((s) => ({ status: { ...s.status, [id]: { ...prev, ...patch } } }));
}

// ---------------------------------------------------------------------------
// File import
// ---------------------------------------------------------------------------

/** Opens a file picker and loads its events into the overlay, replacing any file already loaded. */
export async function importIcsFile(): Promise<void> {
  try {
    const file = await (await getPlatform()).openTextFile(ICS_FILTER);
    if (!file) return;
    const calendar = parseCalendar(file.contents);
    calendars.set(FILE_SOURCE, calendar);
    useIcsOverlay.setState({ fileName: file.path });
    rebuild();
    toast.success(`Imported ${plural(calendar.series.length, "event")}`, { description: file.path });
  } catch (e) {
    toast.error("Could not import the calendar file", { description: errorText(e) });
  }
}

/** Removes the imported file's events (subscriptions stay). */
export function clearIcsOverlay(): void {
  calendars.delete(FILE_SOURCE);
  useIcsOverlay.setState({ fileName: null });
  rebuild();
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

/** Fetches and parses one subscription. Never throws: failures land in its status. */
async function refreshOne(platform: Platform, sub: CalendarSubscription): Promise<boolean> {
  setStatus(sub.id, { loading: true });
  try {
    const calendar = parseCalendar(await platform.fetchText(sub.url));
    // Removed (or its link changed) while the fetch was in flight: drop this result.
    if (useStore.getState().data.calendarSubscriptions[sub.id]?.url !== sub.url) return false;
    calendars.set(sub.id, calendar);
    fetchedUrls.set(sub.id, sub.url);
    setStatus(sub.id, { loading: false, error: null, fetchedAt: systemEnv.nowMs() });
    rebuild();
    return true;
  } catch (e) {
    setStatus(sub.id, { loading: false, error: errorText(e) });
    return false;
  }
}

/** Re-fetches every subscription. `manual` reports the outcome in a toast. */
export async function refreshSubscriptions(opts: { manual?: boolean } = {}): Promise<void> {
  const subs = subscriptionList(useStore.getState().data.calendarSubscriptions);
  if (subs.length === 0) return;
  const platform = syncPlatform ?? (await getPlatform());
  const results = await Promise.all(subs.map((s) => refreshOne(platform, s)));
  if (!opts.manual) return;
  const failed = results.filter((ok) => !ok).length;
  if (failed === 0) toast.success(`Refreshed ${plural(subs.length, "calendar")}`);
  else toast.error(`Couldn't refresh ${plural(failed, "calendar")}`, { description: "See Settings → Calendar for details." });
}

/** Adds a subscription (undoable) and fetches it. Returns an error message, or null on success. */
export function addSubscription(name: string, url: string): string | null {
  const existing = subscriptionList(useStore.getState().data.calendarSubscriptions);
  const r = addSubscriptionChanges(name, url, existing, systemEnv);
  if (!r.ok) return r.error;
  commit(r.changes, { label: "Subscribe to calendar" });
  return null;
}

export function removeSubscription(sub: CalendarSubscription): void {
  commit(removeSubscriptionChanges(sub), { label: "Remove calendar subscription" });
}

/**
 * Brings the loaded calendars in line with the stored subscriptions: fetches new ones (an
 * add, an undone remove, a data import) and drops removed ones.
 */
function syncSubscriptions(platform: Platform): void {
  const subs = useStore.getState().data.calendarSubscriptions;
  let dropped = false;
  for (const id of [...calendars.keys()]) {
    if (id !== FILE_SOURCE && !subs[id]) {
      calendars.delete(id);
      fetchedUrls.delete(id);
      dropped = true;
    }
  }
  if (dropped) {
    const status = { ...useIcsOverlay.getState().status };
    for (const id of Object.keys(status)) if (!subs[id]) delete status[id];
    useIcsOverlay.setState({ status });
    rebuild();
  }
  for (const sub of Object.values(subs)) {
    const loading = useIcsOverlay.getState().status[sub.id]?.loading;
    const known = fetchedUrls.get(sub.id) === sub.url || useIcsOverlay.getState().status[sub.id]?.error != null;
    if (!loading && !known) void refreshOne(platform, sub);
  }
}

let stopSync: (() => void) | null = null;
let syncPlatform: Platform | null = null;

/** Fetches every subscription now, then every 30 minutes; follows the cursor and subscription edits. Call once at boot. */
export function startCalendarSync(platform: Platform): () => void {
  stopSync?.();
  syncPlatform = platform;
  followCursor(useStore.getState().cursor);
  void refreshSubscriptions();
  const timer = setInterval(() => void refreshSubscriptions(), SUBSCRIPTION_REFRESH_MS);
  const unsubscribe = useStore.subscribe((s, prev) => {
    if (s.cursor !== prev.cursor || s.settings.weekStartDay !== prev.settings.weekStartDay) followCursor(s.cursor);
    if (s.data.calendarSubscriptions !== prev.data.calendarSubscriptions) syncSubscriptions(platform);
  });
  stopSync = () => {
    clearInterval(timer);
    unsubscribe();
    stopSync = null;
    syncPlatform = null;
  };
  return stopSync;
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
