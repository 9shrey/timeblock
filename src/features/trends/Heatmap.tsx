import { addDays, formatDateLong, formatDuration } from "@/domain/time/localDate";
import { heatmapLevel } from "@/domain/stats/heatmap";
import type { LocalDate } from "@/domain/types";

interface Props {
  minutesByDay: ReadonlyMap<LocalDate, number>;
  /** Last day shown (the grid covers the 371 days up to and including this one). */
  endDay: LocalDate;
}

const CELL = 11;
const GAP = 2;
const LEVEL_OPACITY = [0.08, 0.3, 0.5, 0.75, 1] as const;

/**
 * A year view, one cell per day (GitHub-contributions style: weeks as columns, Sun..Sat as
 * rows), colored by actual hours for the day. `endDay` anchors the grid so it always ends on
 * the current week.
 */
export function Heatmap({ minutesByDay, endDay }: Props) {
  // Start on a Sunday so rows line up, 53 weeks back from the week containing `endDay`.
  const endDow = new Date(`${endDay}T00:00:00Z`).getUTCDay();
  const gridEnd = addDays(endDay, 6 - endDow);
  const gridStart = addDays(gridEnd, -(53 * 7 - 1));

  const weeks: LocalDate[][] = [];
  for (let w = 0; w < 53; w++) {
    const col: LocalDate[] = [];
    for (let d = 0; d < 7; d++) col.push(addDays(gridStart, w * 7 + d));
    weeks.push(col);
  }

  const width = 53 * (CELL + GAP);
  const height = 7 * (CELL + GAP);

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Year heatmap of actual hours per day">
      {weeks.map((col, w) =>
        col.map((day, d) => {
          if (day > endDay) return null;
          const minutes = minutesByDay.get(day) ?? 0;
          const level = heatmapLevel(minutes);
          return (
            <rect
              key={day}
              x={w * (CELL + GAP)}
              y={d * (CELL + GAP)}
              width={CELL}
              height={CELL}
              rx="2"
              className="fill-primary"
              opacity={level === 0 ? 0.06 : LEVEL_OPACITY[level]}
            >
              <title>
                {formatDateLong(day)}: {minutes > 0 ? formatDuration(minutes) : "no time logged"}
              </title>
            </rect>
          );
        }),
      )}
    </svg>
  );
}
