import { useMemo } from "react";
import { addDays, formatMinute, weekdayLong } from "@/domain/time/localDate";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  canEditLane,
  confirm,
  confirmRestOfDay,
  copyPlanFrom,
  createDefaultAt,
  deleteItem,
  moveBlockTo,
  restore,
  select,
  setGoal,
  skip,
} from "@/state/commands";
import { activeGoals, weekOf } from "@/state/selectors";
import { useStore } from "@/state/store";
import { openEditor, useUi } from "@/state/ui";
import type { ItemRef } from "./dragMachine";
import type { ColumnSpec } from "./geometry";
import { NO_GOAL_COLOR } from "./BlockView";

function GoalSubmenu({ itemRef, day }: { itemRef: ItemRef; day: string }) {
  const data = useStore((s) => s.data);
  const settings = useStore((s) => s.settings);
  const goals = useMemo(() => activeGoals(data, weekOf(day, settings).weekStart), [data, day, settings]);
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>Set goal</ContextMenuSubTrigger>
      <ContextMenuSubContent>
        {goals.map((g, i) => (
          <ContextMenuItem
            key={g.id}
            onSelect={() => {
              const next = setGoal(itemRef, g.id);
              if (next) select(next);
            }}
          >
            <span className="size-2.5 rounded-full" style={{ background: g.color }} />
            {g.name}
            {i < 9 && <ContextMenuShortcut>{i + 1}</ContextMenuShortcut>}
          </ContextMenuItem>
        ))}
        <ContextMenuItem onSelect={() => setGoal(itemRef, null)}>
          <span className="size-2.5 rounded-full" style={{ background: NO_GOAL_COLOR }} />
          No goal
        </ContextMenuItem>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

/** Menu content for whatever was right-clicked (stored in `useUi().menu`). */
export function BlockContextMenu({ columns }: { columns: readonly ColumnSpec[] }) {
  const menu = useUi((s) => s.menu);
  const data = useStore((s) => s.data);
  const nowDay = useStore((s) => s.now.day);
  if (!menu) return <ContextMenuContent className="hidden" />;
  const col = columns[menu.col];
  if (!col) return <ContextMenuContent className="hidden" />;

  if (menu.kind === "empty") {
    const lastWeek = addDays(col.day, -7);
    return (
      <ContextMenuContent className="w-60">
        <ContextMenuItem disabled={!canEditLane(col.day, col.layer)} onSelect={() => createDefaultAt(col.day, col.layer, menu.minute)}>
          New block at {formatMinute(Math.floor(menu.minute / 15) * 15)}
        </ContextMenuItem>
        <ContextMenuItem disabled={col.day > nowDay} onSelect={() => confirmRestOfDay(col.day)}>
          Confirm rest of day as planned
          <ContextMenuShortcut>⇧A</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!canEditLane(col.day, "plan")} onSelect={() => copyPlanFrom(addDays(col.day, -1), col.day)}>
          Copy yesterday's plan
        </ContextMenuItem>
        <ContextMenuItem disabled={!canEditLane(col.day, "plan")} onSelect={() => copyPlanFrom(lastWeek, col.day)}>
          Copy last {weekdayLong(lastWeek)}'s plan
        </ContextMenuItem>
      </ContextMenuContent>
    );
  }

  const ref = menu.ref;
  if (ref.kind === "ghost") {
    const editable = canEditLane(col.day, "actual");
    return (
      <ContextMenuContent className="w-56">
        <ContextMenuItem disabled={!editable} onSelect={() => confirm(ref.planBlockId)}>
          Happened as planned<ContextMenuShortcut>A</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => skip(ref.planBlockId)}>
          Didn't happen (skip)<ContextMenuShortcut>S</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem disabled={!editable} onSelect={() => openEditor(ref)}>
          Log differently…<ContextMenuShortcut>⏎</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    );
  }

  const block = data.blocks[ref.id];
  if (!block) return <ContextMenuContent className="hidden" />;
  const editable = canEditLane(block.day, block.layer);
  const isPlan = block.layer === "plan";
  const hasGhost = isPlan && !block.skipped && !Object.values(data.blocks).some((b) => b.planBlockId === block.id);
  return (
    <ContextMenuContent className="w-56">
      <ContextMenuItem onSelect={() => openEditor(ref)}>
        Edit…<ContextMenuShortcut>⏎</ContextMenuShortcut>
      </ContextMenuItem>
      {editable && <GoalSubmenu itemRef={ref} day={block.day} />}
      {isPlan && hasGhost && (
        <ContextMenuItem disabled={block.day > nowDay} onSelect={() => confirm(block.id)}>
          Happened as planned<ContextMenuShortcut>A</ContextMenuShortcut>
        </ContextMenuItem>
      )}
      {isPlan && hasGhost && (
        <ContextMenuItem onSelect={() => skip(block.id)}>
          Didn't happen (skip)<ContextMenuShortcut>S</ContextMenuShortcut>
        </ContextMenuItem>
      )}
      {isPlan && block.skipped && <ContextMenuItem onSelect={() => restore(block.id)}>Restore</ContextMenuItem>}
      {isPlan && (
        <ContextMenuItem
          disabled={!canEditLane(addDays(block.day, 1), "plan")}
          onSelect={() => moveBlockTo(block.id, addDays(block.day, 1), block.startMinute, block.endMinute, true)}
        >
          Copy to tomorrow
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" disabled={!editable} onSelect={() => deleteItem(ref)}>
        Delete<ContextMenuShortcut>Del</ContextMenuShortcut>
      </ContextMenuItem>
    </ContextMenuContent>
  );
}
