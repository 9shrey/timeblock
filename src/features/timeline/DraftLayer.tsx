import { formatDuration, formatMinuteRange } from "@/domain/time/localDate";
import { useDraft } from "@/state/draft";
import { cn } from "@/lib/utils";
import { minutesToPx } from "./geometry";
import { useTimeFormat } from "@/state/selectors";

/** The live drag preview for one column. Only this component re-renders while dragging. */
export function DraftLayer({ col, pxPerHour }: { col: number; pxPerHour: number }) {
  const tf = useTimeFormat();
  const draft = useDraft((s) => (s.draft?.col === col ? s.draft : null));
  if (!draft) return null;
  const len = draft.end - draft.start;
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-0.5 z-20 rounded-md border-2 border-dashed border-primary bg-primary/10",
        "px-1.5 py-0.5 text-[11px] font-medium text-foreground",
      )}
      style={{ top: minutesToPx(draft.start, pxPerHour), height: Math.max(minutesToPx(len, pxPerHour), 6) }}
    >
      {formatMinuteRange(draft.start, draft.end, tf)} · {formatDuration(len)}
      {draft.copy && " · copy"}
    </div>
  );
}
