import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Trash2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ghostOf, isActualReadOnly, linksByPlan, planState } from "@/domain/blocks/reconcile";
import { formatDuration, formatMinute, parseTimeInput, weekStartOf } from "@/domain/time/localDate";
import type { Ghost, Goal } from "@/domain/types";
import { canEditLane, confirm, deleteItem, patchItem, restore, skip } from "@/state/commands";
import { activeGoals, allBlocks } from "@/state/selectors";
import { sealHistory, undo as storeUndo, useStore } from "@/state/store";
import { closeEditor, useUi, type Editing } from "@/state/ui";
import type { ItemRef } from "./dragMachine";
import { NO_GOAL_COLOR } from "./BlockView";

const NO_GOAL = "__none__";

function anchorFor(ref: ItemRef) {
  const sel =
    ref.kind === "block" ? `[data-item="block"][data-id="${ref.id}"]` : `[data-item="ghost"][data-id="${ref.planBlockId}"]`;
  return {
    current: {
      getBoundingClientRect: () => document.querySelector(sel)?.getBoundingClientRect() ?? new DOMRect(),
    },
  };
}

function GoalDot({ color }: { color: string }) {
  return <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: color }} />;
}

/** Time field that accepts "915", "9:15", "9.15"; commits on blur/Enter. Remount (key) to reset. */
function TimeField({ label, value, onCommit }: { label: string; value: number; onCommit: (m: number) => boolean }) {
  const [text, setText] = useState(formatMinute(value));
  const [invalid, setInvalid] = useState(false);
  const commit = () => {
    const m = parseTimeInput(text);
    if (m === null || !onCommit(m)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setText(formatMinute(m));
  };
  return (
    <Input
      aria-label={label}
      aria-invalid={invalid}
      className="h-8 w-[4.5rem] text-center tabular-nums"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}

function Editor({ editing }: { editing: Editing }) {
  const { ref, session } = editing;
  const data = useStore((s) => s.data);
  const now = useStore((s) => s.now);
  const weekStartDay = useStore((s) => s.settings.weekStartDay);
  const block = ref.kind === "block" ? data.blocks[ref.id] : undefined;
  const plan = ref.kind === "ghost" ? data.blocks[ref.planBlockId] : undefined;
  const item: { day: string; startMinute: number; endMinute: number; title: string; goalId: string | null; notes: string } | undefined =
    block ?? plan;
  const ghost: Ghost | null = plan ? ghostOf(plan) : null;
  const titleRef = useRef<HTMLInputElement>(null);

  const goals = useMemo<Goal[]>(() => (item ? activeGoals(data, weekStartOf(item.day, weekStartDay)) : []), [data, item, weekStartDay]);

  useEffect(() => {
    if (editing.isNew) titleRef.current?.focus();
  }, [editing.isNew]);

  if (!item) return null;
  const layer = block?.layer ?? "actual";
  const editable = canEditLane(item.day, layer);
  const isPlan = block?.layer === "plan";
  const links = isPlan ? (linksByPlan(allBlocks(data.blocks)).get(block.id) ?? []) : [];
  const state = isPlan ? planState(block, links, now) : null;
  const linkedPlan = block?.planBlockId ? data.blocks[block.planBlockId] : undefined;
  const ghostEditable = ghost ? !isActualReadOnly(ghost.day, now) : false;

  /** Applies a field change; a ghost becomes a linked actual on its first edit. */
  const apply = (patch: Parameters<typeof patchItem>[1]): boolean => {
    const next = patchItem(ref, patch, session);
    if (next && (next.kind !== ref.kind || (next.kind === "block" && ref.kind === "block" && next.id !== ref.id))) {
      useUi.setState({ editing: { ...editing, ref: next } });
    }
    return !!next;
  };

  const goal = item.goalId ? data.goals[item.goalId] : undefined;
  // Archived goals stay selectable on blocks that already use them.
  const options = goal && !goals.some((g) => g.id === goal.id) ? [...goals, goal] : goals;
  const disabled = ghost ? !ghostEditable : !editable;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{ghost ? "Planned (not confirmed)" : isPlan ? "Plan" : "Actual"}</span>
        {state && <span>· {state}</span>}
        {linkedPlan && (
          <span>
            · planned {formatMinute(linkedPlan.startMinute)}–{formatMinute(linkedPlan.endMinute)}
          </span>
        )}
        {block && !isPlan && !block.planBlockId && <span>· unplanned</span>}
      </div>
      <div className="grid gap-1">
        <Label htmlFor="block-title" className="text-xs">
          Title
        </Label>
        <Input
          id="block-title"
          ref={titleRef}
          className="h-8"
          placeholder={goal?.name ?? "Untitled"}
          value={item.title}
          maxLength={200}
          disabled={disabled}
          onChange={(e) => apply({ title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              closeEditor();
              sealHistory();
            }
          }}
        />
      </div>
      <div className="grid gap-1">
        <Label className="text-xs">Goal</Label>
        <Select
          value={item.goalId ?? NO_GOAL}
          disabled={disabled}
          onValueChange={(v) => apply({ goalId: v === NO_GOAL ? null : v })}
        >
          <SelectTrigger size="sm" className="w-full" aria-label="Goal">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_GOAL}>
              <GoalDot color={NO_GOAL_COLOR} /> No goal
            </SelectItem>
            {options.map((g, i) => (
              <SelectItem key={g.id} value={g.id}>
                <GoalDot color={g.color} /> {g.name}
                {i < 9 && <span className="ml-auto pl-3 text-xs text-muted-foreground">{i + 1}</span>}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-1.5">
        <TimeField
          key={`s${item.startMinute}`}
          label="Start time"
          value={item.startMinute}
          onCommit={(m) => !disabled && m < item.endMinute && m <= 1439 && apply({ startMinute: m })}
        />
        <span className="text-muted-foreground">–</span>
        <TimeField
          key={`e${item.endMinute}`}
          label="End time"
          value={item.endMinute}
          onCommit={(m) => !disabled && m > item.startMinute && apply({ endMinute: m })}
        />
        <span className="ml-1 text-xs text-muted-foreground">{formatDuration(item.endMinute - item.startMinute)}</span>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="block-notes" className="text-xs">
          Notes
        </Label>
        <Textarea
          id="block-notes"
          className="min-h-14 text-sm"
          value={item.notes}
          maxLength={5000}
          disabled={disabled}
          onChange={(e) => apply({ notes: e.target.value })}
        />
      </div>
      <div className="flex items-center gap-1.5 pt-1">
        {block && editable && (
          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteItem(ref)}>
            <Trash2 /> Delete
          </Button>
        )}
        <div className="flex-1" />
        {(ghost ? ghostEditable : state === "unconfirmed" || state === "pending") && (
          <>
            <Button
              variant="outline"
              size="sm"
              title="Happened as planned (a)"
              disabled={ghost ? false : isActualReadOnly(item.day, now)}
              onClick={() => {
                confirm(ghost ? ghost.planBlockId : block!.id);
                closeEditor();
              }}
            >
              <Check /> As planned
            </Button>
            <Button
              variant="outline"
              size="sm"
              title="Didn't happen (s)"
              onClick={() => {
                skip(ghost ? ghost.planBlockId : block!.id);
                closeEditor();
              }}
            >
              <X /> Skip
            </Button>
          </>
        )}
        {state === "skipped" && (
          <Button variant="outline" size="sm" onClick={() => restore(block!.id)}>
            <Undo2 /> Restore
          </Button>
        )}
      </div>
    </div>
  );
}

/** Editor popover anchored to the block or ghost being edited. */
export function BlockPopover() {
  const editing = useUi((s) => s.editing);
  const anchor = useMemo(() => (editing ? anchorFor(editing.ref) : null), [editing]);

  const close = () => {
    closeEditor();
    sealHistory();
  };

  return (
    <Popover open={!!editing} onOpenChange={(open) => !open && close()}>
      {anchor && <PopoverAnchor virtualRef={anchor} />}
      <PopoverContent
        side="right"
        align="start"
        className="w-80"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onEscapeKeyDown={() => {
          // Esc on a freshly drawn block with nothing entered cancels the create.
          const s = useStore.getState();
          const ed = useUi.getState().editing;
          const b = ed?.ref.kind === "block" ? s.data.blocks[ed.ref.id] : undefined;
          const top = s.history.undo[s.history.undo.length - 1];
          if (ed?.isNew && b && !b.title && !b.goalId && !b.notes && top?.label === "Create block") storeUndo();
        }}
        onInteractOutside={(e) => {
          // Clicking another block re-targets instead of closing; the timeline handles it.
          if ((e.target as Element | null)?.closest?.("[data-item]")) e.preventDefault();
        }}
      >
        {editing && <Editor key={editing.session} editing={editing} />}
      </PopoverContent>
    </Popover>
  );
}
