import { memo, useMemo } from "react";
import { blockDelta } from "@/domain/blocks/delta";
import { layoutLanes } from "@/domain/blocks/layout";
import { ghostsOf, planStates } from "@/domain/blocks/reconcile";
import type { Block, Ghost } from "@/domain/types";
import { cn } from "@/lib/utils";
import { useDayBlocks, useGoalMap, useLaneMinute, useLaneSelection } from "@/state/selectors";
import { useUi } from "@/state/ui";
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
  const laneMinute = useLaneMinute(spec.day);
  const selected = useLaneSelection(spec.day, spec.layer, !!spec.showGhosts);
  const editable = isEditable(spec);
  const highlighted = useUi((s) => s.highlightedGoalId);
  const dim = (goalId: string | null) => highlighted !== null && goalId !== highlighted;

  // Plan states only change when the day's blocks or (today only) the clock change.
  const states = useMemo(
    () => (spec.layer === "plan" ? planStates(dayBlocks, { day: spec.day, minute: laneMinute }) : null),
    [dayBlocks, laneMinute, spec.day, spec.layer],
  );

  // For the Actual lane: the plan block behind each linked actual, to compute its delta badge.
  const plansById = useMemo(() => {
    const map = new Map<string, Block>();
    if (spec.layer === "actual") for (const b of dayBlocks) if (b.layer === "plan") map.set(b.id, b);
    return map;
  }, [dayBlocks, spec.layer]);

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

  const isToday = laneMinute >= 0 && laneMinute < 1440;
  const isFuture = laneMinute < 0;
  const hatchFrom = spec.layer === "actual" ? (isFuture ? 0 : isToday ? laneMinute : null) : null;

  return (
    <div
      data-col={index}
      data-col-key={spec.key}
      className={cn("relative min-w-0 flex-1 border-l", spec.locked && "bg-muted/40")}
      style={{
        flexGrow: spec.span ?? 1,
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
              selected={selected === it.id}
              editable={editable}
              dimmed={dim(g.goalId)}
            />
          );
        }
        const b = it.block;
        const plan = b.planBlockId ? plansById.get(b.planBlockId) : undefined;
        return (
          <BlockView
            key={it.id}
            block={b}
            goal={b.goalId ? (goals[b.goalId] ?? null) : null}
            slot={slot}
            pxPerHour={pxPerHour}
            col={index}
            planState={states?.get(b.id) ?? null}
            delta={plan ? blockDelta(b, plan) : null}
            selected={selected === `block:${b.id}`}
            editable={editable}
            dimmed={dim(b.goalId)}
          />
        );
      })}
      {isToday && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 z-30 h-0.5 bg-red-500"
          style={{ top: minutesToPx(laneMinute, pxPerHour) - 1 }}
        />
      )}
      <DraftLayer col={index} pxPerHour={pxPerHour} />
    </div>
  );
});
