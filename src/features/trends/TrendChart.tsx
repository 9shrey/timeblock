import { bulletScale } from "@/features/goals/BulletBar";
import { NO_GOAL_COLOR } from "@/features/timeline/BlockView";
import type { TrendWeek } from "@/domain/stats/trends";

interface Props {
  weeks: readonly TrendWeek[];
  color?: string;
  className?: string;
}

/**
 * One SVG per goal: a planned (outline) vs actual (filled) bar per week, with a target line
 * across the top. Plain inline SVG, no chart library — matches `BulletBar`'s style, just
 * oriented as a bar-per-week strip instead of a single bullet.
 */
export function TrendChart({ weeks, color = NO_GOAL_COLOR, className }: Props) {
  const max = Math.max(
    1,
    bulletScale(weeks.map((w) => ({ target: w.target, planned: w.planned, actual: w.actual, unconfirmed: 0 }))),
  );
  const n = Math.max(weeks.length, 1);
  const gap = 1.5;
  const barW = (100 - gap * (n + 1)) / n;
  const h = 48;
  const y = (m: number) => h - (Math.min(m, max) / max) * h;

  return (
    <svg className={className} width="100%" height={h + 4} viewBox={`0 0 100 ${h + 4}`} preserveAspectRatio="none" aria-hidden>
      {weeks.map((w, i) => {
        const x = gap + i * (barW + gap);
        const missed = w.met === false;
        return (
          <g key={w.weekStart}>
            {w.planned > 0 && (
              <rect x={x} y={y(w.planned)} width={barW} height={h - y(w.planned)} fill="none" stroke={color} strokeWidth="1" opacity="0.6" />
            )}
            <rect
              x={x}
              y={y(w.actual)}
              width={barW}
              height={Math.max(0, h - y(w.actual))}
              fill={missed ? "var(--color-red-500, #ef4444)" : color}
            />
            {w.target !== null && <line x1={x} x2={x + barW} y1={y(w.target)} y2={y(w.target)} className="stroke-foreground" strokeWidth="1" />}
          </g>
        );
      })}
    </svg>
  );
}
