import { formatHourLabel, formatMinute } from "@/domain/time/localDate";
import { minutesToPx } from "./geometry";
import { useTimeFormat } from "@/state/selectors";

/** Hour labels down the left edge, plus the current time when today is visible. */
export function TimeGutter({ pxPerHour, nowMinute }: { pxPerHour: number; nowMinute: number | null }) {
  const tf = useTimeFormat();
  return (
    <div className="relative w-12 shrink-0 select-none" aria-hidden>
      {Array.from({ length: 24 }, (_, h) => (
        <div
          key={h}
          className="absolute right-1.5 -translate-y-1/2 text-[10px] text-muted-foreground tabular-nums"
          style={{ top: minutesToPx(h * 60, pxPerHour) }}
        >
          {h === 0 ? "" : formatHourLabel(h, tf)}
        </div>
      ))}
      {nowMinute !== null && (
        <div
          className="absolute right-0 z-30 -translate-y-1/2 rounded bg-red-500 px-1 text-[10px] font-semibold whitespace-nowrap text-white tabular-nums"
          style={{ top: minutesToPx(nowMinute, pxPerHour) }}
        >
          {formatMinute(nowMinute, tf)}
        </div>
      )}
    </div>
  );
}
