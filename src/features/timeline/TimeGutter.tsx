import { formatMinute } from "@/domain/time/localDate";
import { minutesToPx } from "./geometry";

/** Hour labels down the left edge, plus the current time when today is visible. */
export function TimeGutter({ pxPerHour, nowMinute }: { pxPerHour: number; nowMinute: number | null }) {
  return (
    <div className="relative w-12 shrink-0 select-none" aria-hidden>
      {Array.from({ length: 24 }, (_, h) => (
        <div
          key={h}
          className="absolute right-1.5 -translate-y-1/2 text-[10px] text-muted-foreground tabular-nums"
          style={{ top: minutesToPx(h * 60, pxPerHour) }}
        >
          {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
        </div>
      ))}
      {nowMinute !== null && (
        <div
          className="absolute right-0.5 z-30 -translate-y-1/2 rounded bg-red-500 px-1 text-[10px] font-semibold text-white tabular-nums"
          style={{ top: minutesToPx(nowMinute, pxPerHour) }}
        >
          {formatMinute(nowMinute)}
        </div>
      )}
    </div>
  );
}
