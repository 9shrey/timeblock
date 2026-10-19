import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { computeAccuracy, type AccuracyStats } from "@/domain/stats/accuracy";
import { heatmapMinutesByDay } from "@/domain/stats/heatmap";
import { computeTrends, trendWeekStarts, type GoalTrend } from "@/domain/stats/trends";
import { addDays, formatDuration } from "@/domain/time/localDate";
import type { Block, TrendWindowWeeks } from "@/domain/types";
import { setSetting } from "@/state/dataCommands";
import { targetList, useGoals, weekOf } from "@/state/selectors";
import { getRepo, useStore } from "@/state/store";
import { Heatmap } from "./Heatmap";
import { TrendChart } from "./TrendChart";

const WINDOWS: TrendWindowWeeks[] = [4, 12, 26];
const HEATMAP_DAYS = 371;

/** `null` while `[fromDay, toExclusive)` is loading (including while an older range's result is still in state). */
function useBlocksRange(fromDay: string, toExclusive: string): Block[] | null {
  const key = `${fromDay}|${toExclusive}`;
  const [loaded, setLoaded] = useState<{ key: string; blocks: Block[] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getRepo()
      .loadBlocksRange(fromDay, toExclusive)
      .then((blocks) => {
        if (!cancelled) setLoaded({ key, blocks });
      });
    return () => {
      cancelled = true;
    };
  }, [fromDay, toExclusive, key]);
  return loaded?.key === key ? loaded.blocks : null;
}

function AccuracySummary({ stats }: { stats: AccuracyStats }) {
  const pct = (n: number) => `${Math.round(n)}%`;
  return (
    <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm" aria-label="Plan accuracy">
      <span>
        Confirmed as planned <b className="tabular-nums">{pct(stats.confirmedPct)}</b>
      </span>
      <span>
        Skipped <b className="tabular-nums">{pct(stats.skippedPct)}</b>
      </span>
      <span>
        Unplanned <b className="tabular-nums">{pct(stats.unplannedPct)}</b>
      </span>
      {stats.avgStartDriftMinutes !== null && (
        <span>
          Avg. start drift{" "}
          <b className="tabular-nums">
            {stats.avgStartDriftMinutes >= 0 ? "+" : ""}
            {formatDuration(stats.avgStartDriftMinutes)}
          </b>
        </span>
      )}
    </p>
  );
}

function GoalTrendRow({ trend }: { trend: GoalTrend }) {
  if (!trend.goal) return null;
  return (
    <div className="rounded-lg border px-3 py-2">
      <div className="mb-1 flex items-center justify-between gap-2 text-sm">
        <span className="flex min-w-0 items-center gap-1.5 font-medium">
          <span className="size-2 shrink-0 rounded-full" style={{ background: trend.goal.color }} />
          <span className="truncate">{trend.goal.name}</span>
        </span>
        {trend.streak > 0 && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {trend.streak} week{trend.streak === 1 ? "" : "s"} met in a row
          </span>
        )}
      </div>
      <TrendChart weeks={trend.weeks} color={trend.goal.color} />
    </div>
  );
}

export function TrendsView() {
  const settings = useStore((s) => s.settings);
  const goals = useGoals();
  const targets = useStore((s) => targetList(s.data.weekTargets));
  const now = useStore((s) => s.now);
  const { weekStart: currentWeekStart } = weekOf(now.day, settings);

  const weekStarts = useMemo(
    () => trendWeekStarts(currentWeekStart, settings.trendWindowWeeks),
    [currentWeekStart, settings.trendWindowWeeks],
  );
  const fromDay = weekStarts[0]!;
  const toExclusive = addDays(weekStarts[weekStarts.length - 1]!, 7);
  const trendBlocks = useBlocksRange(fromDay, toExclusive);

  const heatmapFrom = addDays(now.day, -(HEATMAP_DAYS - 1));
  const yearBlocks = useBlocksRange(heatmapFrom, addDays(now.day, 1));

  const trends = useMemo(
    () => (trendBlocks ? computeTrends({ weekStarts, blocks: trendBlocks, goals, targets, now }) : []),
    [trendBlocks, weekStarts, goals, targets, now],
  );
  const accuracy = useMemo(() => (trendBlocks ? computeAccuracy(trendBlocks, now) : null), [trendBlocks, now]);
  const heatmap = useMemo(
    () => (yearBlocks ? heatmapMinutesByDay({ blocks: yearBlocks, goalId: settings.heatmapGoalId }) : new Map()),
    [yearBlocks, settings.heatmapGoalId],
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Trends</h2>
          <div className="flex gap-1">
            {WINDOWS.map((w) => (
              <Button
                key={w}
                size="xs"
                variant={settings.trendWindowWeeks === w ? "secondary" : "outline"}
                onClick={() => setSetting("trendWindowWeeks", w)}
              >
                {w} weeks
              </Button>
            ))}
          </div>
        </header>

        {!trendBlocks || !accuracy ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <AccuracySummary stats={accuracy} />
            <section className="grid gap-3">
              {trends.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">No goals yet.</p>
              ) : (
                trends.map((t) => <GoalTrendRow key={t.goalId} trend={t} />)
              )}
            </section>
          </>
        )}

        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Year heatmap</h3>
            <Select
              value={settings.heatmapGoalId ?? "__all__"}
              onValueChange={(v) => setSetting("heatmapGoalId", v === "__all__" ? null : v)}
            >
              <SelectTrigger className="h-8 w-44" aria-label="Heatmap goal">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All goals</SelectItem>
                {goals.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {yearBlocks ? <Heatmap minutesByDay={heatmap} endDay={now.day} /> : <p className="text-sm text-muted-foreground">Loading…</p>}
        </section>
      </div>
    </div>
  );
}
