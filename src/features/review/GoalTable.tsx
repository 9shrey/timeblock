import { formatDuration } from "@/domain/time/localDate";
import type { GoalStats } from "@/domain/stats/stats";
import { BulletBar, bulletScale } from "../goals/BulletBar";
import { progressText, StatusChip, targetText } from "../goals/GoalProgress";
import { NO_GOAL_COLOR } from "../timeline/BlockView";

export { STATUS_LABEL, StatusChip } from "../goals/GoalProgress";

function delta(g: GoalStats): string {
  if (g.target === null) return "–";
  const d = g.actual - g.target;
  return d === 0 ? "±0" : `${d > 0 ? "+" : "−"}${formatDuration(Math.abs(d))}`;
}

/** Target vs plan vs actual per goal, with bullet bars on one shared scale. */
export function GoalTable({ goals, unassigned }: { goals: readonly GoalStats[]; unassigned: GoalStats | null }) {
  const rows = unassigned ? [...goals, unassigned] : [...goals];
  const scale = bulletScale(rows);
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
            <td className="px-2 text-right tabular-nums" title={g.prorated ? "Prorated: the goal started this week" : undefined}>
              {targetText(g)}
              {g.prorated && "*"}
            </td>
            <td className="px-2 text-right tabular-nums">{formatDuration(g.planned - g.skipped)}</td>
            <td className="px-2 text-right tabular-nums">
              {formatDuration(g.actual)}
              {g.unconfirmed > 0 && <span className="block text-[11px] text-muted-foreground">+{formatDuration(g.unconfirmed)} unconf.</span>}
            </td>
            <td className="px-2 text-right tabular-nums">{delta(g)}</td>
            <td className="px-3">
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
              {g.goal && <span className="mt-0.5 block text-[11px] text-muted-foreground">{progressText(g)}</span>}
            </td>
            <td className="px-2 text-right tabular-nums">{g.checklist.total > 0 ? `${g.checklist.done}/${g.checklist.total}` : "–"}</td>
            <td className="pl-2">{g.goal ? <StatusChip status={g.status} /> : null}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
