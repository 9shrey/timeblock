import type { GoalStats, GoalStatus } from "@/domain/stats/stats";
import { formatDuration } from "@/domain/time/localDate";
import { cn } from "@/lib/utils";

export const STATUS_LABEL: Record<GoalStatus, string> = {
  met: "Met",
  missed: "Missed",
  on_pace: "On pace",
  behind: "Behind",
  within: "Within limit",
  over: "Over",
  watch: "Watch",
  planned: "Planned",
  under_planned: "Under-planned",
  open: "In progress",
  no_target: "No target",
};

const STATUS_HINT: Record<GoalStatus, string> = {
  met: "Target reached.",
  missed: "The week ended below the target.",
  on_pace: "Logged time is keeping up with a steady pace over this goal's days (within a day's share).",
  behind: "Logged time is more than a day's share behind a steady pace.",
  within: "Logged time is under the limit.",
  over: "Logged time went over the limit.",
  watch: "Logged time plus what's still planned would go over the limit.",
  planned: "The plan for this week covers the target.",
  under_planned: "The plan for this week doesn't cover the target yet.",
  open: "Judged by its outcomes once the week ends.",
  no_target: "No target: time and outcomes are only tracked.",
};

const STATUS_CLASS: Record<GoalStatus, string> = {
  met: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  within: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  on_pace: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  planned: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  behind: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  watch: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  under_planned: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  missed: "bg-red-500/15 text-red-700 dark:text-red-400",
  over: "bg-red-500/15 text-red-700 dark:text-red-400",
  open: "bg-muted text-muted-foreground",
  no_target: "bg-muted text-muted-foreground",
};

export function StatusChip({ status, className }: { status: GoalStatus; className?: string }) {
  return (
    <span
      data-testid="status"
      title={STATUS_HINT[status]}
      className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", STATUS_CLASS[status], className)}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/** "≥ 15h" / "≤ 3h" / "–". */
export function targetText(g: Pick<GoalStats, "kind" | "target">): string {
  return g.target === null ? "–" : `${g.kind === "min" ? "≥" : "≤"} ${formatDuration(g.target)}`;
}

/** One line on where a goal stands and what the plan says, in the words the status uses. */
export function progressText(g: GoalStats): string {
  const parts: string[] = [];
  const d = formatDuration;
  const { target, status } = g;
  if (target === null) {
    parts.push(g.checklist.total > 0 ? `${g.checklist.done} of ${g.checklist.total} outcomes done` : `${d(g.actual)} logged`);
  } else if (g.kind === "min") {
    const done = status === "on_pace" || status === "behind" ? g.actualSoFar : g.actual;
    if (done >= target) parts.push(done > target ? `target met (+${d(done - target)})` : "target met");
    else if (status === "planned" || status === "under_planned") parts.push(`${d(g.upcoming)} planned of ${d(target)}`);
    else if (status === "missed") parts.push(`${d(done)} of ${d(target)} · ${d(target - done)} short`);
    else {
      parts.push(`${d(done)} of ${d(target)}`);
      if (g.paceDelta !== null) {
        const delta = Math.round(g.paceDelta);
        if (delta >= 0) parts.push(delta > 0 ? `${d(delta)} ahead of pace` : "on pace");
        else parts.push(`${d(-delta)} behind pace`);
      }
      if (g.planGap !== null) parts.push(g.planGap > 0 ? `plan short by ${d(g.planGap)}` : "plan covers the rest");
    }
  } else {
    const done = g.actual;
    if (done > target) parts.push(`${d(done - target)} over the limit`);
    else {
      parts.push(`${d(target - done)} left`);
      if (status === "watch" && g.planGap) parts.push(`plan goes over by ${d(g.planGap)}`);
    }
  }
  if (g.prorated && g.weeklyTarget !== null) parts.push(`started this week, target prorated from ${d(g.weeklyTarget)}`);
  return parts.join(" · ");
}

/** Shown when past plan blocks haven't been confirmed: they don't count until they are. */
export function unconfirmedText(g: GoalStats): string | null {
  return g.unconfirmed > 0 ? `${formatDuration(g.unconfirmed)} unconfirmed (confirm to count it)` : null;
}
