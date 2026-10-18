import { useMemo } from "react";
import { Lock } from "lucide-react";
import { formatDuration, parseLocalDate, weekdayShort } from "@/domain/time/localDate";
import type { Amounts } from "@/domain/stats/stats";
import type { LocalDate } from "@/domain/types";
import { cn } from "@/lib/utils";
import { statsFor, weekOf } from "@/state/selectors";
import { useStore } from "@/state/store";
import { unlockPlanDay, useUi } from "@/state/ui";
import { WEEK_PX_PER_HOUR, type ColumnSpec } from "../timeline/geometry";
import { Timeline } from "../timeline/Timeline";

/** Days up to today are split Plan | Actual; future days show the plan at full width. */
export function weekColumns(days: readonly LocalDate[], nowDay: LocalDate, unlocked: readonly LocalDate[]): ColumnSpec[] {
  return days.flatMap((day): ColumnSpec[] => {
    const plan: ColumnSpec = {
      key: `${day}:plan`,
      day,
      layer: "plan",
      readOnly: false,
      locked: day < nowDay && !unlocked.includes(day),
      showGhosts: false,
    };
    if (day > nowDay) return [{ ...plan, span: 2 }];
    return [plan, { key: `${day}:actual`, day, layer: "actual", readOnly: false, locked: false, showGhosts: true }];
  });
}

function DayHeader({ day, amounts, unconfirmed, isToday, isPast, locked }: { day: LocalDate; amounts: Amounts | undefined; unconfirmed: boolean; isToday: boolean; isPast: boolean; locked: boolean }) {
  const planned = amounts?.planned ?? 0;
  const actual = amounts?.actual ?? 0;
  const status = isPast || isToday ? (unconfirmed ? "unconfirmed" : planned > 0 || actual > 0 ? "done" : "empty") : "future";
  return (
    <div className="flex min-w-0 flex-col border-l" style={{ flexGrow: 2, flexBasis: 0 }}>
      <div className="flex items-center gap-1 px-2 pt-1.5">
        <button
          type="button"
          className={cn("flex min-w-0 items-center gap-1.5 rounded text-left text-sm hover:underline", isToday && "font-semibold text-primary")}
          onClick={() => useStore.setState({ view: "day", cursor: day, selection: null })}
          aria-label={`Open ${weekdayShort(day)} ${parseLocalDate(day).d} in Day view`}
        >
          <span
            aria-hidden
            className={cn(
              "size-2 shrink-0 rounded-full",
              status === "unconfirmed" && "bg-amber-500",
              status === "done" && "bg-emerald-500",
              status === "empty" && "bg-muted-foreground/40",
              status === "future" && "border border-muted-foreground/50",
            )}
            title={status === "unconfirmed" ? "Has unconfirmed blocks" : undefined}
          />
          {weekdayShort(day)} {parseLocalDate(day).d}
        </button>
        {locked && (
          <button type="button" className="ml-auto text-muted-foreground hover:text-foreground" aria-label="Unlock past plan" title="Past plan is locked. Click to unlock." onClick={() => unlockPlanDay(day)}>
            <Lock className="size-3" />
          </button>
        )}
      </div>
      <div className="truncate px-2 text-[11px] text-muted-foreground tabular-nums">
        P {formatDuration(planned)}
        {(isPast || isToday) && ` · A ${formatDuration(actual)}`}
      </div>
      <div className="flex text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {isPast || isToday ? (
          <>
            <span className="flex-1 px-2">Plan</span>
            <span className="flex-1 border-l px-2">Actual</span>
          </>
        ) : (
          <span className="flex-1 px-2">Plan</span>
        )}
      </div>
    </div>
  );
}

export function WeekView() {
  const cursor = useStore((s) => s.cursor);
  const settings = useStore((s) => s.settings);
  const data = useStore((s) => s.data);
  const now = useStore((s) => s.now);
  const unlocked = useUi((s) => s.unlockedPlanDays);
  const { weekStart } = weekOf(cursor, settings);

  const { days, columns, stats } = useMemo(() => {
    const { days } = weekOf(weekStart, settings);
    return { days, columns: weekColumns(days, now.day, unlocked), stats: statsFor(data, days, weekStart, now) };
  }, [weekStart, settings, now, unlocked, data]);

  const containsToday = days.includes(now.day);
  const initialMinute = containsToday ? Math.max(0, now.minute - 60) : settings.dayStartMinute;

  return (
    <div className="h-full">
      <Timeline
        columns={columns}
        pxPerHour={WEEK_PX_PER_HOUR}
        initialMinute={initialMinute}
        scrollKey={`week:${weekStart}`}
        header={days.map((d) => (
          <DayHeader
            key={d}
            day={d}
            amounts={stats.byDay[d]}
            unconfirmed={stats.uncorrectedDays.includes(d)}
            isToday={d === now.day}
            isPast={d < now.day}
            locked={columns.some((c) => c.day === d && c.locked)}
          />
        ))}
      />
    </div>
  );
}
