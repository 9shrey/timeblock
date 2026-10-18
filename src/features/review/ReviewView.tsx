import { AlertCircle, ArrowRight, ArrowRightToLine } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { carryableCount } from "@/domain/goals/checklist";
import { addDays, formatDateLong, formatDayLabel, formatDuration, isoWeek, weekDays } from "@/domain/time/localDate";
import type { LocalDate } from "@/domain/types";
import { confirmRestOfDay } from "@/state/commands";
import { carryOverItems, setWeekNote } from "@/state/goalCommands";
import { checklistList, statsFor, weekOf } from "@/state/selectors";
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
      </div>
    </div>
  );
}
