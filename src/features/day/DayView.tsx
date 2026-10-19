import { useMemo } from "react";
import { CheckCheck, Lock, LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isActualReadOnly } from "@/domain/blocks/reconcile";
import { addDays, weekdayLong, weekStartOf } from "@/domain/time/localDate";
import type { LocalDate } from "@/domain/types";
import { confirmRestOfDay, copyPlanFrom, copyWeekPlan } from "@/state/commands";
import { useDayBlocks } from "@/state/selectors";
import { useStore } from "@/state/store";
import { openTemplateDialog, unlockPlanDay, useUi } from "@/state/ui";
import { DAY_PX_PER_HOUR, type ColumnSpec } from "../timeline/geometry";
import { Timeline } from "../timeline/Timeline";
import { SummaryBar } from "./SummaryBar";

function PlanHeader({ col }: { col: ColumnSpec }) {
  const blocks = useDayBlocks(col.day);
  const isPast = useStore((s) => col.day < s.now.day);
  const weekStartDay = useStore((s) => s.settings.weekStartDay);
  const hasPlan = blocks.some((b) => b.layer === "plan");
  const lastWeek = addDays(col.day, -7);
  const weekStart = weekStartOf(col.day, weekStartDay);
  return (
    <div className="flex h-9 items-center gap-1 px-2 text-xs">
      <span className="font-semibold tracking-wide text-muted-foreground uppercase">Plan</span>
      {isPast && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={col.locked ? "Unlock past plan to edit" : "Past plan unlocked"}
              disabled={!col.locked}
              onClick={() => unlockPlanDay(col.day)}
            >
              {col.locked ? <Lock /> : <LockOpen />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{col.locked ? "Past plans are locked to keep reviews honest. Click to edit." : "Unlocked for this session"}</TooltipContent>
        </Tooltip>
      )}
      <div className="flex-1" />
      {!hasPlan && !col.locked && (
        <>
          <Button variant="outline" size="xs" onClick={() => copyPlanFrom(addDays(col.day, -1), col.day)}>
            Copy yesterday's plan
          </Button>
          <Button variant="outline" size="xs" onClick={() => copyPlanFrom(lastWeek, col.day)}>
            Copy last {weekdayLong(lastWeek)}'s
          </Button>
          <Button variant="outline" size="xs" onClick={() => copyWeekPlan(addDays(weekStart, -7), weekStart)}>
            Copy last week's plan
          </Button>
          <Button variant="outline" size="xs" onClick={() => openTemplateDialog({ kind: "apply", scope: "day", day: col.day })}>
            Apply template…
          </Button>
        </>
      )}
    </div>
  );
}

function ActualHeader({ col }: { col: ColumnSpec }) {
  return (
    <div className="flex h-9 items-center gap-1 px-2 text-xs">
      <span className="font-semibold tracking-wide text-muted-foreground uppercase">Actual</span>
      {col.readOnly && <span className="text-muted-foreground">· future</span>}
      <div className="flex-1" />
      {!col.readOnly && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="xs" onClick={() => confirmRestOfDay(col.day)}>
              <CheckCheck /> Confirm rest
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Log every past planned block as it was planned <kbd className="ml-1 opacity-70">⇧A</kbd>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

export function dayColumns(day: LocalDate, nowDay: LocalDate, unlocked: readonly LocalDate[]): ColumnSpec[] {
  const now = { day: nowDay, minute: 0 };
  return [
    { key: `${day}:plan`, day, layer: "plan", readOnly: false, locked: day < nowDay && !unlocked.includes(day), showGhosts: false },
    { key: `${day}:actual`, day, layer: "actual", readOnly: isActualReadOnly(day, now), locked: false, showGhosts: true },
  ];
}

export function DayView() {
  const day = useStore((s) => s.cursor);
  const now = useStore((s) => s.now);
  const dayStart = useStore((s) => s.settings.dayStartMinute);
  const unlocked = useUi((s) => s.unlockedPlanDays);
  const columns = useMemo(() => dayColumns(day, now.day, unlocked), [day, now.day, unlocked]);
  // Today: scroll to an hour before now; other days: the configured day start.
  const initialMinute = day === now.day ? Math.max(0, now.minute - 60) : dayStart;

  return (
    <div className="flex h-full flex-col">
      <SummaryBar day={day} />
      <div className="min-h-0 flex-1">
        <div className="mx-auto h-full max-w-6xl">
          <Timeline
            columns={columns}
            pxPerHour={DAY_PX_PER_HOUR}
            initialMinute={initialMinute}
            scrollKey={`day:${day}`}
            renderHeader={(c) => (c.layer === "plan" ? <PlanHeader col={c} /> : <ActualHeader col={c} />)}
          />
        </div>
      </div>
    </div>
  );
}
