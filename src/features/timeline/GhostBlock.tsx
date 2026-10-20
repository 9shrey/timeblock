import { memo } from "react";
import { Check, X } from "lucide-react";
import { formatMinuteRange } from "@/domain/time/localDate";
import type { Ghost, Goal } from "@/domain/types";
import { cn } from "@/lib/utils";
import { confirm, select, skip } from "@/state/commands";
import { useDraft } from "@/state/draft";
import { displayTitle, NO_GOAL_COLOR, ResizeHandles, slotStyle, type Slot } from "./BlockView";
import { EDGE_PX, minutesToPx } from "./geometry";
import { useTimeFormat } from "@/state/selectors";

interface Props {
  ghost: Ghost;
  goal: Goal | null;
  slot: Slot;
  pxPerHour: number;
  col: number;
  selected: boolean;
  editable: boolean;
  dimmed?: boolean;
}

const GHOST_WIDTH = 0.7;

/** A plan block mirrored into the Actual lane until it is confirmed (✓) or skipped (✗). */
export const GhostBlock = memo(function GhostBlock({ ghost, goal, slot, pxPerHour, col, selected, editable, dimmed }: Props) {
  const tf = useTimeFormat();
  const dragging = useDraft((s) => s.draft?.ref?.kind === "ghost" && s.draft.ref.planBlockId === ghost.planBlockId);
  const title = displayTitle(ghost.title, goal);
  const time = formatMinuteRange(ghost.startMinute, ghost.endMinute, tf);
  const short = minutesToPx(ghost.endMinute - ghost.startMinute, pxPerHour) < 34;
  const color = goal?.color ?? NO_GOAL_COLOR;

  return (
    <div
      role="button"
      tabIndex={0}
      data-item="ghost"
      data-id={ghost.planBlockId}
      data-col={col}
      aria-label={`Planned, not confirmed: ${time}, ${title}`}
      aria-pressed={selected}
      onFocus={(e) => e.target === e.currentTarget && select({ kind: "ghost", planBlockId: ghost.planBlockId })}
      className={cn(
        "group absolute rounded-md border-[1.5px] border-dashed text-left text-xs leading-tight text-foreground outline-none select-none",
        "opacity-55 transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring",
        selected && "z-10 opacity-90 ring-2 ring-ring ring-offset-1 ring-offset-background",
        dragging && "opacity-25",
        dimmed && !selected && "opacity-20",
      )}
      // Ghosts leave the right of their slot free, so unplanned time can be drawn over planned time.
      style={{ ...slotStyle(ghost.startMinute, ghost.endMinute, slot, pxPerHour, GHOST_WIDTH), borderColor: color }}
    >
      <span className={cn("flex h-full w-full overflow-hidden px-1.5", short ? "items-center gap-1" : "flex-col py-1")}>
        <span className="flex min-w-0 items-center gap-1 font-medium">
          <span aria-hidden className="text-muted-foreground">
            ?
          </span>
          <span className="truncate">{title}</span>
        </span>
        <span className={cn("truncate text-muted-foreground", short ? "text-[10px]" : "text-[11px]")}>{time}</span>
      </span>
      {editable && (
        <>
          <span
            data-nodrag
            className={cn(
              "absolute top-0.5 right-0.5 hidden gap-0.5 group-focus-within:flex group-hover:flex",
              selected && "flex",
            )}
          >
            <button
              type="button"
              aria-label="Happened as planned"
              title="Happened as planned (a)"
              className="rounded bg-background/90 p-0.5 text-emerald-600 shadow-sm hover:bg-emerald-50 dark:hover:bg-emerald-950"
              onClick={() => confirm(ghost.planBlockId)}
            >
              <Check className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label="Didn't happen (skip)"
              title="Didn't happen (s)"
              className="rounded bg-background/90 p-0.5 text-rose-600 shadow-sm hover:bg-rose-50 dark:hover:bg-rose-950"
              onClick={() => skip(ghost.planBlockId)}
            >
              <X className="size-3.5" />
            </button>
          </span>
          {minutesToPx(ghost.endMinute - ghost.startMinute, pxPerHour) >= 3 * EDGE_PX && <ResizeHandles />}
        </>
      )}
    </div>
  );
});
