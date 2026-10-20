import { useMemo, useState } from "react";
import { AlertCircle, ArrowRight, ArrowRightToLine, CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { carryableCount } from "@/domain/goals/checklist";
import { computeAccuracy } from "@/domain/stats/accuracy";
import { biggestGaps } from "@/domain/stats/gaps";
import { addDays, formatDateLong, formatDayLabel, formatDuration, formatMinuteRange, isoWeek, weekDays } from "@/domain/time/localDate";
import type { LocalDate } from "@/domain/types";
import { confirmRestOfDay, rescheduleSkippedTo } from "@/state/commands";
import { carryOverItems, setWeekNote } from "@/state/goalCommands";
import { allBlocks, checklistList, statsFor, useTimeFormat, weekOf } from "@/state/selectors";
import { sealHistory, useStore } from "@/state/store";
import { Checklist } from "../goals/Checklist";
import { GoalTable } from "./GoalTable";

function UnconfirmedBanner({ days }: { days: readonly LocalDate[] }) {
  if (days.length === 0) return null;
  return (
    <section className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3" aria-label="Unconfirmed days">
      <p className="mb-2 flex items-center gap-2 text-sm font-medium">
        <AlertCircle className="size-4 text-amber-600" />
        {days.length === 1 ? "1 day has" : `${days.length} days have`} planned blocks that aren't confirmed yet. Unconfirmed time doesn't count as actual.
      </p>
      <ul className="grid gap-1">
        {days.map((d) => (
          <li key={d} className="flex items-center gap-2 text-sm">
            <span className="w-28">{formatDayLabel(d)}</span>
            <Button size="xs" variant="outline" onClick={() => confirmRestOfDay(d)}>
              Confirm as planned
            </Button>
            <Button size="xs" variant="ghost" onClick={() => useStore.setState({ view: "day", cursor: d })}>
              Open
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Bound straight to the store (commits are synchronous), so undo and imports show up too. */
function Reflection({ weekStart }: { weekStart: LocalDate }) {
  const text = useStore((s) => s.data.weekNotes[weekStart]?.text ?? "");
  return (
    <Textarea
      aria-label="Reflection"
      placeholder="What worked this week? What will you change next week?"
      className="min-h-28"
      value={text}
      onChange={(e) => setWeekNote(weekStart, e.target.value, `note:${weekStart}`)}
      onBlur={sealHistory}
    />
  );
}

/** Blocks of `weekStart`'s 7 days, memoized so it doesn't re-filter (or re-trigger effects) every render. */
function useWeekBlocks(weekStart: LocalDate) {
  const blocksById = useStore((s) => s.data.blocks);
  return useMemo(() => {
    const days = new Set(weekDays(weekStart));
    return allBlocks(blocksById).filter((b) => days.has(b.day));
  }, [blocksById, weekStart]);
}

function AccuracySection({ weekStart }: { weekStart: LocalDate }) {
  const now = useStore((s) => s.now);
  const weekBlocks = useWeekBlocks(weekStart);
  const accuracy = useMemo(() => computeAccuracy(weekBlocks, now), [weekBlocks, now]);
  if (accuracy.countedPlans === 0) return null;
  const pct = (n: number) => `${Math.round(n)}%`;
  return (
    <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm" aria-label="Plan accuracy">
      <span>
        Confirmed as planned <b className="tabular-nums">{pct(accuracy.confirmedPct)}</b>
      </span>
      <span>
        Skipped <b className="tabular-nums">{pct(accuracy.skippedPct)}</b>
      </span>
      <span>
        Unplanned <b className="tabular-nums">{pct(accuracy.unplannedPct)}</b>
      </span>
      {accuracy.avgStartDriftMinutes !== null && (
        <span>
          Avg. start drift{" "}
          <b className="tabular-nums">
            {accuracy.avgStartDriftMinutes >= 0 ? "+" : ""}
            {formatDuration(accuracy.avgStartDriftMinutes)}
          </b>
        </span>
      )}
    </p>
  );
}

function BiggestGapsSection({ weekStart }: { weekStart: LocalDate }) {
  const tf = useTimeFormat();
  const now = useStore((s) => s.now);
  const weekBlocks = useWeekBlocks(weekStart);
  const gaps = useMemo(() => biggestGaps(weekBlocks, now), [weekBlocks, now]);
  if (gaps.length === 0) return null;
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">Biggest gaps</h3>
      <ul className="grid gap-1 rounded-lg border px-4 py-2 text-sm">
        {gaps.map((g, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-muted-foreground">{formatDayLabel(g.day)}</span>
            <span className="w-28 shrink-0 tabular-nums text-muted-foreground">
              {formatMinuteRange(g.startMinute, g.endMinute, tf)}
            </span>
            <span className="min-w-0 flex-1 truncate">{g.title || "Untitled"}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{g.kind === "unplanned" ? "unplanned" : "unconfirmed"}</span>
            <b className="shrink-0 tabular-nums">{formatDuration(g.minutes)}</b>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RescheduleSkippedSection({ weekStart, nextWeek }: { weekStart: LocalDate; nextWeek: LocalDate }) {
  const nextWeekDays = weekDays(nextWeek);
  const [toDay, setToDay] = useState<LocalDate>(nextWeekDays[0]!);
  const weekBlocks = useWeekBlocks(weekStart);
  const skippedCount = useMemo(() => weekBlocks.filter((b) => b.layer === "plan" && b.skipped).length, [weekBlocks]);
  if (skippedCount === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" onClick={() => rescheduleSkippedTo(weekStart, toDay)}>
        <CalendarClock /> Reschedule {skippedCount} skipped →
      </Button>
      <Select value={toDay} onValueChange={(v) => setToDay(v as LocalDate)}>
        <SelectTrigger className="h-9 w-40" aria-label="Day to reschedule into">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {nextWeekDays.map((d) => (
            <SelectItem key={d} value={d}>
              {formatDayLabel(d)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function ReviewView() {
  const cursor = useStore((s) => s.cursor);
  const settings = useStore((s) => s.settings);
  const data = useStore((s) => s.data);
  const now = useStore((s) => s.now);
  const { weekStart } = weekOf(cursor, settings);
  const nextWeek = addDays(weekStart, 7);
  const stats = statsFor(data, weekDays(weekStart), weekStart, now);
  const items = checklistList(data.checklistItems).filter((c) => c.weekStart === weekStart);
  const carryable = carryableCount(checklistList(data.checklistItems), weekStart, nextWeek);
  const t = stats.totals;
  const done = items.filter((i) => i.done).length;
  const phaseLabel = stats.phase === "past" ? "" : stats.phase === "current" ? " (in progress)" : " (upcoming)";

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-5 p-6">
        <header>
          <h2 className="text-lg font-semibold">
            Week {isoWeek(weekStart).week} review{phaseLabel}
          </h2>
          <p className="text-sm text-muted-foreground">
            {formatDateLong(weekStart)} – {formatDateLong(addDays(weekStart, 6))}
          </p>
        </header>

        <UnconfirmedBanner days={stats.uncorrectedDays} />

        <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm" aria-label="Week totals">
          <span>
            Planned <b className="tabular-nums">{formatDuration(t.planned)}</b>
          </span>
          <span>
            Actual <b className="tabular-nums">{formatDuration(t.actual)}</b>
            {t.planned > 0 && <span className="text-muted-foreground"> ({Math.round((t.actual / t.planned) * 100)}% of plan)</span>}
          </span>
          <span>
            Unplanned <b className="tabular-nums">{formatDuration(t.unplanned)}</b>
          </span>
          <span>
            Skipped <b className="tabular-nums">{formatDuration(t.skipped)}</b>
          </span>
          {t.unconfirmed > 0 && (
            <span>
              Unconfirmed <b className="tabular-nums">{formatDuration(t.unconfirmed)}</b>
            </span>
          )}
          <span>
            Outcomes <b className="tabular-nums">{done}/{items.length}</b>
          </span>
        </p>

        <AccuracySection weekStart={weekStart} />

        <section className="rounded-lg border px-4 py-2">
          {stats.goals.length === 0 && !stats.unassigned ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No goals or tracked time this week.</p>
          ) : (
            <GoalTable goals={stats.goals} unassigned={stats.unassigned} />
          )}
        </section>

        <div className="grid gap-5 md:grid-cols-2">
          <section>
            <h3 className="mb-2 text-sm font-semibold">Outcomes</h3>
            <div className="grid gap-3">
              {stats.goals.map((g) => (
                <div key={g.goalId}>
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                    <span className="size-2 rounded-full" style={{ background: g.goal?.color }} />
                    {g.goal?.name}
                  </div>
                  <Checklist goalId={g.goalId} weekStart={weekStart} items={items.filter((i) => i.goalId === g.goalId)} />
                </div>
              ))}
            </div>
          </section>
          <section>
            <h3 className="mb-2 text-sm font-semibold">Reflection</h3>
            <Reflection weekStart={weekStart} />
          </section>
        </div>

        <BiggestGapsSection weekStart={weekStart} />

        <footer className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={carryable === 0}
            onClick={() => {
              const n = carryOverItems(weekStart, nextWeek);
              toast(`Carried ${n} unfinished outcome${n === 1 ? "" : "s"} to next week.`);
            }}
          >
            <ArrowRightToLine /> Carry {carryable || ""} unfinished → next week
          </Button>
          <Button onClick={() => useStore.setState({ view: "goals", cursor: nextWeek })}>
            Set next week's targets <ArrowRight />
          </Button>
        </footer>

        <RescheduleSkippedSection weekStart={weekStart} nextWeek={nextWeek} />
      </div>
    </div>
  );
}
