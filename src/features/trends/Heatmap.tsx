/** A year of actual time, one cell per day, GitHub-contributions style. */
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NO_GOAL_COLOR } from "@/features/timeline/BlockView";
import { dailyActualMinutes } from "@/domain/stats/heatmap";
import { addDays, dayOfWeek, diffDays, formatDateLong, formatDuration, parseLocalDate, weekStartOf } from "@/domain/time/localDate";
import type { Block, Goal, LocalDate, WeekStartDay } from "@/domain/types";
import { getRepo, useStore } from "@/state/store";

const LEVELS = [0, 0.15, 0.35, 0.6, 0.85, 1] as const;

function yearBounds(year: number): { from: LocalDate; to: LocalDate } {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

function cellPosition(day: LocalDate, from: LocalDate, weekStartDay: WeekStartDay): { col: number; row: number } {
  const col = Math.floor(diffDays(weekStartOf(from, weekStartDay), weekStartOf(day, weekStartDay)) / 7);
  const row = (dayOfWeek(day) - weekStartDay + 7) % 7;
  return { col, row };
}

function Cell({ day, minutes, max, color }: { day: LocalDate; minutes: number; max: number; color: string }) {
  const level = minutes === 0 ? 0 : LEVELS.findIndex((l) => minutes <= l * max || l === 1);
  const opacity = LEVELS[Math.max(level, 1)] ?? 1;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="size-[11px] rounded-[2px]"
          style={{ background: minutes === 0 ? "var(--muted)" : color, opacity: minutes === 0 ? 1 : opacity }}
          aria-label={`${formatDateLong(day)}: ${minutes > 0 ? formatDuration(minutes) : "no actual time"}`}
        />
      </TooltipTrigger>
      <TooltipContent>
        {formatDateLong(day)}: {minutes > 0 ? formatDuration(minutes) : "no actual time"}
      </TooltipContent>
    </Tooltip>
  );
}

export function Heatmap({ goals }: { goals: readonly Goal[] }) {
  const weekStartDay = useStore((s) => s.settings.weekStartDay);
  const nowDay = useStore((s) => s.now.day);
  const [year, setYear] = useState(() => parseLocalDate(nowDay).y);
  const [goalId, setGoalId] = useState<string>("all");

  const { from, to } = yearBounds(year);
  const [loaded, setLoaded] = useState<{ year: number; blocks: Block[] } | null>(null);
  const requestId = useRef(0);
  useEffect(() => {
    const id = ++requestId.current;
    void getRepo()
      .loadRange(from, to)
      .then((blocks) => {
        if (requestId.current === id) setLoaded({ year, blocks });
      });
  }, [year, from, to]);

  const minutesByDay = loaded?.year === year ? dailyActualMinutes(loaded.blocks, from, to, goalId === "all" ? null : goalId) : null;
  const max = Math.max(60, ...(minutesByDay ? Object.values(minutesByDay) : []));
  const color = goalId === "all" ? NO_GOAL_COLOR : (goals.find((g) => g.id === goalId)?.color ?? NO_GOAL_COLOR);

  const days: LocalDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);

  return (
    <section className="rounded-lg border p-3" aria-label="Heatmap">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Heatmap</h3>
        <div className="flex items-center gap-2">
          <Select value={goalId} onValueChange={setGoalId}>
            <SelectTrigger className="h-8 w-36" aria-label="Goal">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All goals</SelectItem>
              {goals.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="icon-xs" aria-label="Previous year" onClick={() => setYear((y) => y - 1)}>
            <ChevronLeft />
          </Button>
          <span className="w-10 text-center text-sm tabular-nums">{year}</span>
          <Button variant="ghost" size="icon-xs" aria-label="Next year" onClick={() => setYear((y) => y + 1)}>
            <ChevronRight />
          </Button>
        </div>
      </div>
      {!minutesByDay ? (
        <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="grid w-fit gap-[3px]" style={{ gridTemplateRows: "repeat(7, 11px)", gridAutoFlow: "column", gridAutoColumns: "11px" }}>
            {days.map((day) => {
              const { col, row } = cellPosition(day, from, weekStartDay);
              return (
                <div key={day} style={{ gridColumn: col + 1, gridRow: row + 1 }}>
                  <Cell day={day} minutes={minutesByDay[day] ?? 0} max={max} color={color} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
