import { memo } from "react";
import { Check, Circle, X } from "lucide-react";
import { formatDuration, formatMinute } from "@/domain/time/localDate";
import type { Block, Goal, PlanState } from "@/domain/types";
import { cn } from "@/lib/utils";
import { select } from "@/state/commands";
import { useDraft } from "@/state/draft";
import { EDGE_PX, minutesToPx } from "./geometry";

export const NO_GOAL_COLOR = "#94a3b8";

export interface Slot {
  lane: number;
  lanes: number;
}

/** Absolute position of a timeline item inside its column. */
export function slotStyle(start: number, end: number, slot: Slot, pxPerHour: number, widthFactor = 1): React.CSSProperties {
  const top = minutesToPx(start, pxPerHour);
  return {
    top,
    height: Math.max(minutesToPx(end - start, pxPerHour) - 1, 6),
    left: `calc(${(slot.lane / slot.lanes) * 100}% + 2px)`,
    width: `calc(${(100 / slot.lanes) * widthFactor}% - 4px)`,
  };
}

export const displayTitle = (title: string, goal: Goal | null | undefined) => title.trim() || goal?.name || "Untitled";

const STATE_LABEL: Record<PlanState, string> = {
  done: "done",
  adjusted: "adjusted",
  skipped: "skipped",
  unconfirmed: "not yet confirmed",
  pending: "upcoming",
};

function PlanBadge({ state }: { state: PlanState }) {
  const cls = "size-3.5 shrink-0";
  switch (state) {
    case "done":
      return <Check className={cls} aria-hidden />;
    case "adjusted":
      return (
        <span aria-hidden className="w-3.5 shrink-0 text-center leading-none font-bold">
          ~
        </span>
      );
    case "skipped":
      return <X className={cls} aria-hidden />;
    case "unconfirmed":
      return <Circle className="size-2 shrink-0 fill-current" aria-hidden />;
    default:
      return null;
  }
}

/** 6px hit zones centred on the top and bottom edges (3px inside, 3px outside). */
export function ResizeHandles() {
  return (
    <>
      <span data-edge="start" className="absolute inset-x-0 -top-[3px] z-10 h-1.5 cursor-ns-resize" />
      <span data-edge="end" className="absolute inset-x-0 -bottom-[3px] z-10 h-1.5 cursor-ns-resize" />
    </>
  );
}

interface Props {
  block: Block;
  goal: Goal | null;
  slot: Slot;
  pxPerHour: number;
  col: number;
  planState: PlanState | null;
  selected: boolean;
  editable: boolean;
  dimmed?: boolean;
}

export const BlockView = memo(function BlockView({ block, goal, slot, pxPerHour, col, planState, selected, editable, dimmed }: Props) {
  const dragging = useDraft((s) => s.draft?.ref?.kind === "block" && s.draft.ref.id === block.id && !s.draft.copy);
  const len = block.endMinute - block.startMinute;
  const short = minutesToPx(len, pxPerHour) < 34;
  const isPlan = block.layer === "plan";
  const title = displayTitle(block.title, goal);
  const time = `${formatMinute(block.startMinute)}–${formatMinute(block.endMinute)}`;
  const label = [
    isPlan ? "Plan" : "Actual",
    time,
    title,
    goal ? `goal ${goal.name}` : "no goal",
    planState ? STATE_LABEL[planState] : !isPlan && !block.planBlockId ? "unplanned" : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <button
      type="button"
      data-item="block"
      data-id={block.id}
      data-col={col}
      aria-label={label}
      aria-pressed={selected}
      onFocus={() => select({ kind: "block", id: block.id })}
      className={cn(
        // No overflow clipping here: the resize handles reach 3px outside the block.
        "absolute rounded-md text-left text-xs leading-tight outline-none select-none",
        "focus-visible:ring-2 focus-visible:ring-ring",
        isPlan ? "border-[1.5px] text-foreground" : "text-white shadow-sm",
        planState === "skipped" && "opacity-50",
        selected && "z-10 ring-2 ring-ring ring-offset-1 ring-offset-background",
        dragging && "opacity-40",
        dimmed && "opacity-25",
      )}
      style={{
        ...slotStyle(block.startMinute, block.endMinute, slot, pxPerHour),
        borderColor: isPlan ? (goal?.color ?? NO_GOAL_COLOR) : undefined,
        background: isPlan
          ? `color-mix(in oklab, ${goal?.color ?? NO_GOAL_COLOR} 14%, var(--background))`
          : (goal?.color ?? NO_GOAL_COLOR),
      }}
    >
      <span className={cn("flex h-full w-full overflow-hidden px-1.5", short ? "items-center gap-1" : "flex-col py-1")}>
        <span className={cn("flex min-w-0 items-center gap-1 font-medium", short && "flex-1")}>
          {planState && <PlanBadge state={planState} />}
          <span className={cn("truncate", planState === "skipped" && "line-through")}>{title}</span>
        </span>
        <span className={cn("truncate opacity-75", short ? "shrink-0 text-[10px]" : "text-[11px]")}>
          {time}
          {!short && len >= 45 && ` · ${formatDuration(len)}`}
        </span>
      </span>
      {editable && minutesToPx(len, pxPerHour) >= 3 * EDGE_PX && <ResizeHandles />}
    </button>
  );
});
