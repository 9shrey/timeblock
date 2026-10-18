import { useMemo } from "react";
import { formatDuration } from "@/domain/time/localDate";
import type { LocalDate } from "@/domain/types";
import { statsFor, weekOf } from "@/state/selectors";
import { useStore } from "@/state/store";
import { NO_GOAL_COLOR } from "../timeline/BlockView";

function Metric({ label, minutes, hint }: { label: string; minutes: number; hint?: string }) {
  return (
    <span title={hint}>
      <span className="text-muted-foreground">{label}</span> <span className="font-medium tabular-nums">{formatDuration(minutes)}</span>
    </span>
  );
}

/** Plan · Actual · Unplanned · Skipped · Unconfirmed for one day, plus per-goal chips. */
export function SummaryBar({ day }: { day: LocalDate }) {
  const data = useStore((s) => s.data);
  const settings = useStore((s) => s.settings);
  const now = useStore((s) => s.now);
  const stats = useMemo(() => statsFor(data, [day], weekOf(day, settings).weekStart, now), [data, day, settings, now]);
  const { totals } = stats;
  const chips = [...stats.goals, ...(stats.unassigned ? [stats.unassigned] : [])].filter((g) => g.planned > 0 || g.actual > 0);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2 text-xs" aria-label="Day summary">
      <Metric label="Plan" minutes={totals.planned} />
      <Metric label="Actual" minutes={totals.actual} hint="Confirmed time only" />
      <Metric label="Unplanned" minutes={totals.unplanned} hint="Actual time with no matching plan block" />
      <Metric label="Skipped" minutes={totals.skipped} />
      {totals.unconfirmed > 0 && <Metric label="Unconfirmed" minutes={totals.unconfirmed} hint="Planned time that has passed but isn't confirmed yet" />}
      <span className="mx-1 h-4 w-px bg-border" />
      {chips.map((g) => (
        <span key={g.goalId} className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5">
          <span className="size-2 rounded-full" style={{ background: g.goal?.color ?? NO_GOAL_COLOR }} />
          {g.goal?.name ?? "No goal"}
          <span className="tabular-nums text-muted-foreground">
            {formatDuration(g.actual)}/{formatDuration(g.planned)}
          </span>
        </span>
      ))}
    </div>
  );
}
