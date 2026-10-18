import { useId } from "react";
import type { GoalKind } from "@/domain/types";
import { NO_GOAL_COLOR } from "../timeline/BlockView";

interface Props {
  target: number | null;
  planned: number;
  actual: number;
  unconfirmed: number;
  kind: GoalKind;
  color?: string;
  /** Shared scale so rows are comparable (minutes at the right edge). */
  scaleMax: number;
  className?: string;
}

/**
 * Bullet bar: a track up to the target with a tick, the plan as an outline, confirmed
 * actual time solid, and unconfirmed (past, planned) time hatched after it.
 */
export function BulletBar({ target, planned, actual, unconfirmed, kind, color = NO_GOAL_COLOR, scaleMax, className }: Props) {
  const id = useId();
  const max = Math.max(scaleMax, 1);
  const pct = (m: number) => Math.min(100, (Math.max(0, m) / max) * 100);
  const over = kind === "max" && target !== null && actual > target;
  return (
    <svg className={className} width="100%" height="14" viewBox="0 0 100 14" preserveAspectRatio="none" aria-hidden>
      <defs>
        <pattern id={`${id}-hatch`} width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="1.2" height="3" fill={color} />
        </pattern>
      </defs>
      {target !== null && <rect x="0" y="3" width={pct(target)} height="8" rx="1" className="fill-muted" />}
      <rect x="0" y="4" width={pct(actual)} height="6" fill={color} />
      {over && target !== null && <rect x={pct(target)} y="4" width={pct(actual) - pct(target)} height="6" className="fill-red-500" />}
      <rect x={pct(actual)} y="4" width={pct(actual + unconfirmed) - pct(actual)} height="6" fill={`url(#${id}-hatch)`} opacity="0.8" />
      {planned > 0 && (
        <rect
          x="0.5"
          y="2"
          width={Math.max(0, pct(planned) - 1)}
          height="10"
          fill="none"
          stroke={color}
          strokeWidth="1.25"
          vectorEffect="non-scaling-stroke"
          opacity="0.7"
        />
      )}
      {target !== null && (
        <line x1={pct(target)} x2={pct(target)} y1="0" y2="14" className="stroke-foreground" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}

/** Max of every value a row of bars needs to show, plus headroom. */
export function bulletScale(rows: readonly { target: number | null; planned: number; actual: number; unconfirmed: number }[]): number {
  let m = 60;
  for (const r of rows) m = Math.max(m, r.target ?? 0, r.planned, r.actual + r.unconfirmed);
  return m * 1.08;
}
