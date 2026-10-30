import { useMemo } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDuration, weekNumber, weekDays } from "@/domain/time/localDate";
import { cn } from "@/lib/utils";
import { checklistList, statsFor, weekOf } from "@/state/selectors";
import { useStore } from "@/state/store";
import { toggleHighlightedGoal, useUi } from "@/state/ui";
import { BulletBar, bulletScale } from "./BulletBar";
import { Checklist } from "./Checklist";
import { progressText, StatusChip, targetText, unconfirmedText } from "./GoalProgress";

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
  const highlighted = useUi((s) => s.highlightedGoalId);

  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l bg-muted/20" aria-label="Week budget">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Week budget · W{weekNumber(weekStart)}</h2>
        <Button variant="ghost" size="icon-xs" aria-label="Close week budget" onClick={() => useStore.setState({ budgetOpen: false })}>
          <X />
        </Button>
      </div>
      <div className="grid gap-3 px-4">
        {stats.goals.length === 0 && <p className="text-sm text-muted-foreground">No goals for this week.</p>}
        {stats.goals.map((g) => (
          <div key={g.goalId} className={cn("grid gap-1", highlighted !== null && highlighted !== g.goalId && "opacity-50")}>
            <button
              type="button"
              className="flex items-baseline gap-1.5 rounded text-left text-sm hover:underline"
              aria-pressed={highlighted === g.goalId}
              title="Dim every other goal's blocks in the timeline"
              onClick={() => toggleHighlightedGoal(g.goalId)}
            >
              <span className="size-2.5 self-center rounded-full" style={{ background: g.goal?.color }} />
              <span className="font-medium">{g.goal?.name}</span>
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                {formatDuration(g.actual)}
                {g.target !== null && ` / ${targetText(g)}`}
              </span>
            </button>
            <BulletBar
              target={g.target}
              planned={g.planned - g.skipped}
              actual={g.actual}
              unconfirmed={g.unconfirmed}
              kind={g.kind}
              expected={g.expected}
              color={g.goal?.color}
              scaleMax={scale}
            />
            <div className="flex items-start gap-2">
              <p className="flex-1 text-xs text-muted-foreground">
                {progressText(g)}
                {unconfirmedText(g) && ` · ${unconfirmedText(g)}`}
              </p>
              {g.status !== "no_target" && <StatusChip status={g.status} className="text-[10px]" />}
            </div>
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
