import { memo, useMemo } from "react";
import { layoutLanes } from "@/domain/blocks/layout";
import { ghostsOf, planStates } from "@/domain/blocks/reconcile";
import type { Block, Ghost } from "@/domain/types";
import { cn } from "@/lib/utils";
import { useDayBlocks, useGoalMap } from "@/state/selectors";
import { useStore } from "@/state/store";
import { BlockView } from "./BlockView";
import { DraftLayer } from "./DraftLayer";
import { GhostBlock } from "./GhostBlock";
import { isEditable, minutesToPx, type ColumnSpec } from "./geometry";

interface Props {
  spec: ColumnSpec;
  index: number;
  pxPerHour: number;
}

type Item = { id: string; startMinute: number; endMinute: number } & ({ kind: "block"; block: Block } | { kind: "ghost"; ghost: Ghost });

/** One (day, layer) lane: its blocks (and ghosts for Actual), the now line and the drag preview. */
export const LaneColumn = memo(function LaneColumn({ spec, index, pxPerHour }: Props) {
  const dayBlocks = useDayBlocks(spec.day);
  const goals = useGoalMap();
  const now = useStore((s) => s.now);
  const selection = useStore((s) => s.selection);
  const editable = isEditable(spec);

  // Plan states only change when the day's blocks or the clock change.
  const states = useMemo(() => (spec.layer === "plan" ? planStates(dayBlocks, now) : null), [dayBlocks, now, spec.layer]);

  const { items, slots } = useMemo(() => {
    const items: Item[] = dayBlocks
      .filter((b) => b.layer === spec.layer)
      .map((block) => ({ id: block.id, startMinute: block.startMinute, endMinute: block.endMinute, kind: "block", block }));
    if (spec.showGhosts) {
      for (const ghost of ghostsOf(dayBlocks)) {
        items.push({ id: `ghost:${ghost.planBlockId}`, startMinute: ghost.startMinute, endMinute: ghost.endMinute, kind: "ghost", ghost });
      }
    }
    return { items, slots: layoutLanes(items) };
  }, [dayBlocks, spec.layer, spec.showGhosts]);

  const isToday = spec.day === now.day;
  const hatchFrom = spec.layer === "actual" ? (spec.day > now.day ? 0 : isToday ? now.minute : null) : null;

  return (
    <div
      data-col={index}
      data-col-key={spec.key}
      className={cn("relative min-w-0 flex-1 border-l", spec.locked && "bg-muted/40")}
      style={{
        backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0 1px, transparent 1px ${pxPerHour}px)`,
      }}
    >
      {hatchFrom !== null && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0"
          style={{
            top: minutesToPx(hatchFrom, pxPerHour),
            backgroundImage:
              "repeating-linear-gradient(135deg, color-mix(in oklab, var(--muted-foreground) 10%, transparent) 0 1px, transparent 1px 8px)",
          }}
        />
      )}
      {items.map((it) => {
        const slot = slots.get(it.id) ?? { lane: 0, lanes: 1 };
        if (it.kind === "ghost") {
          const g = it.ghost;
          return (
            <GhostBlock
              key={it.id}
              ghost={g}
              goal={g.goalId ? (goals[g.goalId] ?? null) : null}
              slot={slot}
              pxPerHour={pxPerHour}
              col={index}
              selected={selection?.kind === "ghost" && selection.planBlockId === g.planBlockId}
              editable={editable}
            />
          );
        }
        const b = it.block;
        return (
          <BlockView
            key={it.id}
            block={b}
            goal={b.goalId ? (goals[b.goalId] ?? null) : null}
            slot={slot}
            pxPerHour={pxPerHour}
            col={index}
            planState={states?.get(b.id) ?? null}
            selected={selection?.kind === "block" && selection.id === b.id}
            editable={editable}
          />
        );
      })}
      {isToday && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 z-30 h-0.5 bg-red-500"
          style={{ top: minutesToPx(now.minute, pxPerHour) - 1 }}
        />
      )}
      <DraftLayer col={index} pxPerHour={pxPerHour} />
    </div>
  );
});
