import { useEffect, useRef, useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { computeTrend, metStreak, type TrendWeek } from "@/domain/stats/trends";
import { addDays, weekStartOf } from "@/domain/time/localDate";
import type { Block, Goal } from "@/domain/types";
import { goalList, targetList } from "@/state/selectors";
import { getRepo, useStore } from "@/state/store";

const RANGES = [4, 12, 26] as const;
type Range = (typeof RANGES)[number];

/** A bar-and-target-line chart for one goal's trend, one bar pair per week. */
function TrendChart({ trend, goalId, target, color }: { trend: readonly TrendWeek[]; goalId: string; target: number | null; color: string }) {
  const weeks = trend.map((w) => {
    const g = w.stats.goals.find((g) => g.goalId === goalId);
    return { weekStart: w.weekStart, planned: g?.planned ?? 0, actual: g?.actual ?? 0 };
  });
  const H = 64;
  const max = Math.max(target ?? 0, ...weeks.map((w) => Math.max(w.planned, w.actual)), 60) * 1.08;
  const barW = 100 / weeks.length;
  const h = (m: number) => (m / max) * H;
  return (
    <svg width="100%" height={H} viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" aria-hidden className="overflow-visible">
      {target !== null && (
        <line x1="0" x2="100" y1={H - h(target)} y2={H - h(target)} className="stroke-foreground" strokeWidth="1" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
      )}
      {weeks.map((w, i) => {
        const x = i * barW + barW * 0.15;
        const bw = barW * 0.7;
        return (
          <g key={w.weekStart}>
            {w.planned > 0 && (
              <rect x={x} y={H - h(w.planned)} width={bw} height={h(w.planned)} fill="none" stroke={color} strokeWidth="1" opacity="0.5" vectorEffect="non-scaling-stroke" />
            )}
            <rect x={x} y={H - h(w.actual)} width={bw} height={h(w.actual)} fill={color} />
          </g>
        );
      })}
    </svg>
  );
}

function GoalTrend({ trend, goal, target }: { trend: readonly TrendWeek[]; goal: Goal; target: number | null }) {
  const streak = metStreak(trend, goal.id, goal.kind);
  return (
    <section className="rounded-lg border p-3" aria-label={goal.name}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <span className="size-2 rounded-full" style={{ background: goal.color }} />
          {goal.name}
        </div>
        {streak > 0 && (
          <span className="text-xs text-muted-foreground">
            🔥 {streak} week{streak === 1 ? "" : "s"} met
          </span>
        )}
      </div>
      <TrendChart trend={trend} goalId={goal.id} target={target} color={goal.color} />
    </section>
  );
}

export function TrendsView() {
  const settings = useStore((s) => s.settings);
  const now = useStore((s) => s.now);
  const goals = useStore((s) => goalList(s.data.goals));
  const targets = useStore((s) => targetList(s.data.weekTargets));
  const [range, setRange] = useState<Range>(12);
  const endWeekStart = weekStartOf(now.day, settings.weekStartDay);
  const from = addDays(endWeekStart, -7 * (range - 1));
  const to = addDays(endWeekStart, 6);
  const rangeKey = `${from}:${to}`;

  const [loaded, setLoaded] = useState<{ rangeKey: string; blocks: Block[] } | null>(null);
  const requestId = useRef(0);
  useEffect(() => {
    const id = ++requestId.current;
    void getRepo()
      .loadRange(from, to)
      .then((blocks) => {
        if (requestId.current === id) setLoaded({ rangeKey, blocks });
      });
  }, [from, to, rangeKey]);

  const blocks = loaded?.rangeKey === rangeKey ? loaded.blocks : null;
  const trend = blocks ? computeTrend({ blocks, goals, targets, weekStartDay: settings.weekStartDay, endDay: now.day, now, weeks: range }) : null;
  const latest = trend?.[trend.length - 1];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-5 p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Trends</h2>
            <p className="text-sm text-muted-foreground">Planned vs. actual by goal, target as a dashed line.</p>
          </div>
          <ToggleGroup type="single" size="sm" variant="outline" value={String(range)} onValueChange={(v) => v && setRange(Number(v) as Range)} aria-label="Weeks shown">
            {RANGES.map((r) => (
              <ToggleGroupItem key={r} value={String(r)} aria-label={`${r} weeks`}>
                {r}w
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </header>

        {!trend || !latest ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : goals.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No goals yet.</p>
        ) : (
          <div className="grid gap-4">
            {goals.map((goal) => (
              <GoalTrend key={goal.id} trend={trend} goal={goal} target={latest.stats.goals.find((g) => g.goalId === goal.id)?.target ?? null} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
