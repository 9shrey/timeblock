import { formatDuration } from "@/domain/time/localDate";
import type { GoalStats, GoalStatus } from "@/domain/stats/stats";
import { cn } from "@/lib/utils";
import { BulletBar, bulletScale } from "../goals/BulletBar";
import { NO_GOAL_COLOR } from "../timeline/BlockView";

export const STATUS_LABEL: Record<GoalStatus, string> = {
  met: "Met",
  missed: "Missed",
  on_track: "On track",
  behind: "Behind",
  over: "Over",
  within: "Within",
  at_risk: "At risk",
  no_target: "No target",
};

const STATUS_CLASS: Record<GoalStatus, string> = {
  met: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  within: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  on_track: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  behind: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  at_risk: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  missed: "bg-red-500/15 text-red-700 dark:text-red-400",
  over: "bg-red-500/15 text-red-700 dark:text-red-400",
  no_target: "bg-muted text-muted-foreground",
};

export function StatusChip({ status }: { status: GoalStatus }) {
  return (
    <span data-testid="status" className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", STATUS_CLASS[status])}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function delta(g: GoalStats): string {
  if (g.target === null) return "–";
  if (g.trackBy === "tasks") {
    const d = g.checklist.done - g.target;
    return d === 0 ? "±0" : `${d > 0 ? "+" : "−"}${Math.abs(d)}`;
  }
  const d = g.actual - g.target;
  return d === 0 ? "±0" : `${d > 0 ? "+" : "−"}${formatDuration(Math.abs(d))}`;
}

/** Target vs plan vs actual per goal, with bullet bars on one shared scale (time and task goals scaled separately). */
export function GoalTable({ goals, unassigned }: { goals: readonly GoalStats[]; unassigned: GoalStats | null }) {
  const rows = unassigned ? [...goals, unassigned] : [...goals];
  const timeScale = bulletScale(rows.filter((g) => g.trackBy === "time"));
  const taskScale = bulletScale(
    rows.filter((g) => g.trackBy === "tasks").map((g) => ({ target: g.target, planned: 0, actual: g.checklist.done, unconfirmed: 0 })),
  );
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-xs text-muted-foreground">
          <th className="py-2 pr-3 font-medium">Goal</th>
          <th className="px-2 text-right font-medium">Target</th>
          <th className="px-2 text-right font-medium">Plan</th>
          <th className="px-2 text-right font-medium">Actual</th>
          <th className="px-2 text-right font-medium">Δ</th>
          <th className="w-[28%] px-3 font-medium">Progress</th>
          <th className="px-2 text-right font-medium">Outcomes</th>
          <th className="pl-2 font-medium">Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((g) => (
          <tr key={g.goalId} className="border-b last:border-0" data-testid="goal-row">
            <td className="py-2 pr-3">
              <span className="flex items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: g.goal?.color ?? NO_GOAL_COLOR }} />
                <span className="truncate">{g.goal?.name ?? "No goal"}</span>
              </span>
            </td>
            <td className="px-2 text-right tabular-nums">
              {g.target === null
                ? "–"
                : g.trackBy === "tasks"
                  ? `${g.kind === "min" ? "≥" : "≤"} ${g.target} outcome${g.target === 1 ? "" : "s"}`
                  : `${g.kind === "min" ? "≥" : "≤"} ${formatDuration(g.target)}`}
            </td>
            <td className="px-2 text-right tabular-nums">{g.trackBy === "tasks" ? "–" : formatDuration(g.planned)}</td>
            <td className="px-2 text-right tabular-nums">
              {g.trackBy === "tasks" ? (
                `${g.checklist.done}`
              ) : (
                <>
                  {formatDuration(g.actual)}
                  {g.unconfirmed > 0 && <span className="block text-[11px] text-muted-foreground">+{formatDuration(g.unconfirmed)} unconf.</span>}
                </>
              )}
            </td>
            <td className="px-2 text-right tabular-nums">{delta(g)}</td>
            <td className="px-3">
              {g.trackBy === "tasks" ? (
                <BulletBar target={g.target} planned={0} actual={g.checklist.done} unconfirmed={0} kind={g.kind} color={g.goal?.color} scaleMax={taskScale} />
              ) : (
                <BulletBar target={g.target} planned={g.planned} actual={g.actual} unconfirmed={g.unconfirmed} kind={g.kind} color={g.goal?.color} scaleMax={timeScale} />
              )}
            </td>
            <td className="px-2 text-right tabular-nums">{g.checklist.total > 0 ? `${g.checklist.done}/${g.checklist.total}` : "–"}</td>
            <td className="pl-2">{g.goal ? <StatusChip status={g.status} /> : null}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
