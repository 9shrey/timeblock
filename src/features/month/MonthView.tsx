import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import { formatDuration, monthStartOf, parseLocalDate, weekdayShort, weekDays, weekStartOf, addDays } from "@/domain/time/localDate";
import type { Block, LocalDate, WeekStartDay } from "@/domain/types";
import { cn } from "@/lib/utils";
import { allBlocks, statsFor } from "@/state/selectors";
import { ensureWeek, useStore } from "@/state/store";
import { NO_GOAL_COLOR } from "../timeline/BlockView";

const MAX_CHIPS = 3;

/** Week rows covering the month of `cursor`, each a list of 7 days (leading/trailing days belong to neighbouring months). */
export function monthWeeks(cursor: LocalDate, weekStartDay: WeekStartDay): LocalDate[][] {
  const first = monthStartOf(cursor);
  const { y, m } = parseLocalDate(first);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = addDays(first, lastDay - 1);
  const weeks: LocalDate[][] = [];
  for (let ws = weekStartOf(first, weekStartDay); ws <= last; ws = addDays(ws, 7)) weeks.push(weekDays(ws));
  return weeks;
}

export function MonthView() {
  const cursor = useStore((s) => s.cursor);
  const settings = useStore((s) => s.settings);
  const data = useStore((s) => s.data);
  const now = useStore((s) => s.now);
  const weeks = useMemo(() => monthWeeks(cursor, settings.weekStartDay), [cursor, settings.weekStartDay]);
  const month = parseLocalDate(cursor).m;

  // The Shell only keeps the cursor's week and its neighbours loaded; a month needs all of its weeks.
  useEffect(() => {
    for (const w of weeks) {
      ensureWeek(w[0]!).catch((e: unknown) => toast.error("Couldn't load this month", { id: "month-load", description: e instanceof Error ? e.message : String(e) }));
    }
  }, [weeks]);

  const { byDay, blocksByDay } = useMemo(() => {
    const byDay: Record<string, { planned: number; actual: number }> = {};
    for (const w of weeks) Object.assign(byDay, statsFor(data, w, w[0]!, now).byDay);
    const set = new Set(weeks.flat());
    const blocksByDay = new Map<LocalDate, Block[]>();
    for (const b of allBlocks(data.blocks)) {
      if (b.layer !== "plan" || !set.has(b.day)) continue;
      const list = blocksByDay.get(b.day) ?? [];
      list.push(b);
      blocksByDay.set(b.day, list);
    }
    for (const list of blocksByDay.values()) list.sort((a, b) => a.startMinute - b.startMinute);
    return { byDay, blocksByDay };
  }, [weeks, data, now]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid shrink-0 grid-cols-7 border-b text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {weeks[0]!.map((d) => (
          <div key={d} className="px-2 py-1">
            {weekdayShort(d)}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1" style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))` }}>
        {weeks.map((w) => (
          <div key={w[0]} className="grid grid-cols-7 border-b last:border-b-0">
            {w.map((day) => {
              const inMonth = parseLocalDate(day).m === month;
              const isToday = day === now.day;
              const list = blocksByDay.get(day) ?? [];
              const amounts = byDay[day];
              return (
                <button
                  key={day}
                  type="button"
                  aria-label={`Open ${day} in Day view`}
                  onClick={() => useStore.setState({ view: "day", cursor: day, selection: null })}
                  className={cn(
                    "flex min-w-0 flex-col gap-0.5 overflow-hidden border-l px-1.5 py-1 text-left first:border-l-0 hover:bg-accent/50",
                    !inMonth && "bg-muted/30 text-muted-foreground",
                  )}
                >
                  <span className={cn("text-xs", isToday && "w-fit rounded-full bg-primary px-1.5 font-semibold text-primary-foreground")}>{parseLocalDate(day).d}</span>
                  {list.slice(0, MAX_CHIPS).map((b) => {
                    const goal = b.goalId ? data.goals[b.goalId] : undefined;
                    return (
                      <span key={b.id} className="flex min-w-0 items-center gap-1 text-[11px] leading-tight">
                        <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: goal?.color ?? NO_GOAL_COLOR }} />
                        <span className="truncate">{b.title.trim() || goal?.name || "Untitled"}</span>
                      </span>
                    );
                  })}
                  {list.length > MAX_CHIPS && <span className="text-[10px] text-muted-foreground">+{list.length - MAX_CHIPS} more</span>}
                  <span className="mt-auto truncate text-[10px] tabular-nums text-muted-foreground">
                    {amounts && amounts.planned > 0 ? `P ${formatDuration(amounts.planned)}` : ""}
                    {amounts && amounts.actual > 0 ? ` · A ${formatDuration(amounts.actual)}` : ""}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
