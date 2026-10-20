import { useMemo, useState } from "react";
import { Archive, ArrowRightToLine, GripVertical, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { carryableCount } from "@/domain/goals/checklist";
import { effectiveTarget } from "@/domain/goals/targets";
import { addDays, formatDateLong, formatDuration, isoWeek, weekDays } from "@/domain/time/localDate";
import type { Goal, GoalKind } from "@/domain/types";
import { carryOverItems, editGoal, reorderGoals } from "@/state/goalCommands";
import { checklistList, goalList, statsFor, targetList, weekOf } from "@/state/selectors";
import { useStore } from "@/state/store";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useDragReorder } from "./useDragReorder";
import { Checklist } from "./Checklist";
import { GoalDialog } from "./GoalDialog";
import { TargetInput, TaskTargetInput } from "./TargetInput";

function GoalRow({
  goal,
  weekStart,
  onEdit,
  dragHandleProps,
  dropZoneProps,
  dragOver,
}: {
  goal: Goal;
  weekStart: string;
  onEdit: () => void;
  dragHandleProps: React.HTMLAttributes<HTMLButtonElement>;
  dropZoneProps: React.HTMLAttributes<HTMLElement>;
  dragOver: boolean;
}) {
  const data = useStore((s) => s.data);
  const target = effectiveTarget(targetList(data.weekTargets), goal.id, weekStart);
  const items = checklistList(data.checklistItems).filter((c) => c.goalId === goal.id && c.weekStart === weekStart);
  return (
    <section className={cn("rounded-lg border p-3", dragOver && "border-primary")} aria-label={goal.name} {...dropZoneProps}>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" aria-label={`Reorder ${goal.name}`} className="cursor-grab text-muted-foreground/50 hover:text-muted-foreground" {...dragHandleProps}>
          <GripVertical className="size-4" />
        </button>
        <button type="button" onClick={onEdit} className="flex items-center gap-2 font-medium hover:underline">
          <span className="size-3 rounded-full" style={{ background: goal.color }} />
          {goal.name}
          <Pencil className="size-3 text-muted-foreground" />
        </button>
        <div className="flex-1" />
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={goal.kind}
          onValueChange={(v) => v && v !== goal.kind && editGoal(goal, { kind: v as GoalKind })}
          aria-label="Target kind"
        >
          <ToggleGroupItem value="min" aria-label="At least" title="At least">
            ≥
          </ToggleGroupItem>
          <ToggleGroupItem value="max" aria-label="At most" title="At most">
            ≤
          </ToggleGroupItem>
        </ToggleGroup>
        {goal.trackBy === "time" ? (
          <TargetInput
            key={`${weekStart}:${target.minutes}:${target.fromWeek}`}
            goalId={goal.id}
            weekStart={weekStart}
            minutes={target.minutes}
            fromWeek={target.fromWeek}
          />
        ) : (
          <TaskTargetInput
            key={`${weekStart}:${target.count}:${target.fromWeek}`}
            goalId={goal.id}
            weekStart={weekStart}
            count={target.count}
            fromWeek={target.fromWeek}
          />
        )}
      </div>
      <div className="mt-2 pl-5">
        <Checklist goalId={goal.id} weekStart={weekStart} items={items} />
      </div>
    </section>
  );
}

export function GoalsView() {
  const cursor = useStore((s) => s.cursor);
  const settings = useStore((s) => s.settings);
  const data = useStore((s) => s.data);
  const now = useStore((s) => s.now);
  const { weekStart } = weekOf(cursor, settings);
  const prevWeek = addDays(weekStart, -7);
  const [dialog, setDialog] = useState<{ goal: Goal | null } | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const goals = goalList(data.goals);
  const active = goals.filter((g) => !g.archivedOn || g.archivedOn > weekStart);
  const archived = goals.filter((g) => g.archivedOn && g.archivedOn <= weekStart);
  const carryable = carryableCount(checklistList(data.checklistItems), prevWeek, weekStart);
  const stats = useMemo(() => statsFor(data, weekDays(weekStart), weekStart, now), [data, weekStart, now]);
  const byGoal = new Map(stats.goals.map((g) => [g.goalId, g]));
  const activeIds = active.map((g) => g.id);
  const { dragHandleProps, dropZoneProps, isDragOver } = useDragReorder(activeIds, reorderGoals);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
        <header className="flex flex-wrap items-center gap-2">
          <div>
            <h2 className="text-lg font-semibold">Goals</h2>
            <p className="text-sm text-muted-foreground">
              Week {isoWeek(weekStart).week} · from {formatDateLong(weekStart)}. Targets apply from this week on.
            </p>
          </div>
          <div className="flex-1" />
          {carryable > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const n = carryOverItems(prevWeek, weekStart);
                toast(`Carried over ${n} unfinished outcome${n === 1 ? "" : "s"}.`);
              }}
            >
              <ArrowRightToLine /> Carry over {carryable} unfinished
            </Button>
          )}
          <Button size="sm" onClick={() => setDialog({ goal: null })}>
            <Plus /> New goal
          </Button>
        </header>

        {active.length === 0 && (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            No goals yet. Create one, set a weekly target, then tag blocks with it (keys 1–9 on a selected block).
          </div>
        )}
        {active.map((g) => (
          <div key={g.id}>
            <GoalRow
              goal={g}
              weekStart={weekStart}
              onEdit={() => setDialog({ goal: g })}
              dragHandleProps={dragHandleProps(g.id)}
              dropZoneProps={dropZoneProps(g.id)}
              dragOver={isDragOver(g.id)}
            />
            {byGoal.get(g.id) &&
              (g.trackBy === "time" ? (
                <p className="mt-1 pl-1 text-xs text-muted-foreground">
                  This week: planned {formatDuration(byGoal.get(g.id)!.planned)} · actual {formatDuration(byGoal.get(g.id)!.actual)}
                </p>
              ) : (
                <p className="mt-1 pl-1 text-xs text-muted-foreground">
                  This week: {byGoal.get(g.id)!.checklist.done}/{byGoal.get(g.id)!.checklist.total} outcomes done
                </p>
              ))}
          </div>
        ))}

        {archived.length > 0 && (
          <div>
            <Button variant="ghost" size="sm" onClick={() => setShowArchived((v) => !v)}>
              <Archive /> {showArchived ? "Hide" : "Show"} archived ({archived.length})
            </Button>
            {showArchived && (
              <ul className="mt-2 grid gap-1">
                {archived.map((g) => (
                  <li key={g.id} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="size-2.5 rounded-full" style={{ background: g.color }} />
                    {g.name} <span className="text-xs">(archived {formatDateLong(g.archivedOn!)})</span>
                    <Button variant="link" size="sm" onClick={() => setDialog({ goal: g })}>
                      Edit
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      <GoalDialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)} goal={dialog?.goal ?? null} weekStart={weekStart} />
    </div>
  );
}
