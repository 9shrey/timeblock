import { useMemo } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDuration, isoWeek, weekDays } from "@/domain/time/localDate";
import type { GoalStats } from "@/domain/stats/stats";
import { checklistList, statsFor, weekOf } from "@/state/selectors";
import { useStore } from "@/state/store";
import { BulletBar, bulletScale } from "./BulletBar";
import { Checklist } from "./Checklist";

function remainingText(g: GoalStats): string {
  if (g.target === null) return `${formatDuration(g.actual)} logged`;
  const left = g.target - g.actual;
  if (g.kind === "min") {
    if (left <= 0) return `target met (+${formatDuration(-left)})`;
    const free = g.target - g.projected;
    return free > 0 ? `${formatDuration(left)} to go · ${formatDuration(free)} not yet planned` : `${formatDuration(left)} to go · planned enough`;
  }
  if (left < 0) return `${formatDuration(-left)} over`;
  const planOver = g.projected - g.target;
  return planOver > 0 ? `${formatDuration(left)} left · plan exceeds by ${formatDuration(planOver)}` : `${formatDuration(left)} left`;
}

/** Ctrl+B side panel: this week's progress per goal and its outcomes. */
export function BudgetPanel() {
  const cursor = useStore((s) => s.cursor);
  const settings = useStore((s) => s.settings);
  const data = useStore((s) => s.data);
  const now = useStore((s) => s.now);
  const { weekStart } = weekOf(cursor, settings);
  const stats = useMemo(() => statsFor(data, weekDays(weekStart), weekStart, now), [data, weekStart, now]);
  const scale = bulletScale(stats.goals);
  const items = checklistList(data.checklistItems).filter((c) => c.weekStart === weekStart);

  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l bg-muted/20" aria-label="Week budget">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Week budget · W{isoWeek(weekStart).week}</h2>
        <Button variant="ghost" size="icon-xs" aria-label="Close week budget" onClick={() => useStore.setState({ budgetOpen: false })}>
          <X />
        </Button>
      </div>
      <div className="grid gap-3 px-4">
        {stats.goals.length === 0 && <p className="text-sm text-muted-foreground">No goals for this week.</p>}
        {stats.goals.map((g) => (
          <div key={g.goalId} className="grid gap-1">
            <div className="flex items-baseline gap-1.5 text-sm">
              <span className="size-2.5 self-center rounded-full" style={{ background: g.goal?.color }} />
              <span className="font-medium">{g.goal?.name}</span>
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                {formatDuration(g.actual)}
                {g.target !== null && ` / ${g.kind === "min" ? "≥" : "≤"}${formatDuration(g.target)}`}
              </span>
            </div>
            <BulletBar target={g.target} planned={g.planned} actual={g.actual} unconfirmed={g.unconfirmed} kind={g.kind} color={g.goal?.color} scaleMax={scale} />
            <p className="text-xs text-muted-foreground">
              {remainingText(g)}
              {g.unconfirmed > 0 && ` · ${formatDuration(g.unconfirmed)} unconfirmed`}
            </p>
          </div>
        ))}
      </div>
      <h2 className="px-4 pt-5 pb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Outcomes</h2>
      <div className="grid gap-3 px-4 pb-4">
        {stats.goals
          .filter((g) => items.some((i) => i.goalId === g.goalId))
          .map((g) => (
            <div key={g.goalId}>
              <div className="mb-1 text-xs font-medium">
                {g.goal?.name} · {g.checklist.done}/{g.checklist.total}
              </div>
              <Checklist goalId={g.goalId} weekStart={weekStart} items={items.filter((i) => i.goalId === g.goalId)} editable={false} />
            </div>
          ))}
        {items.length === 0 && <p className="text-sm text-muted-foreground">No outcomes this week. Add them on the Goals page.</p>}
      </div>
    </aside>
  );
}
