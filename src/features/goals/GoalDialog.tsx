import { useState } from "react";
import { Check } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { nextColor, PALETTE } from "@/domain/goals/palette";
import type { Goal, GoalKind, LocalDate } from "@/domain/types";
import { createGoal, deleteGoal, editGoal } from "@/state/goalCommands";
import { goalList } from "@/state/selectors";
import { useStore } from "@/state/store";
import { cn } from "@/lib/utils";
import { hoursToMinutes } from "./TargetInput";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Goal to edit; null creates a new one. */
  goal: Goal | null;
  weekStart: LocalDate;
}

function Form({ goal, weekStart, onDone }: { goal: Goal | null; weekStart: LocalDate; onDone: () => void }) {
  const goals = useStore((s) => goalList(s.data.goals));
  const [name, setName] = useState(goal?.name ?? "");
  const [color, setColor] = useState(goal?.color ?? nextColor(goals.map((g) => g.color)));
  const [kind, setKind] = useState<GoalKind>(goal?.kind ?? "min");
  const [target, setTarget] = useState("");
  const valid = name.trim().length >= 1 && name.trim().length <= 80;

  const save = () => {
    if (!valid) return;
    if (goal) {
      editGoal(goal, { name, color, kind });
    } else {
      const minutes = target.trim() === "" ? null : hoursToMinutes(target);
      if (createGoal({ name, color, kind, targetMinutes: minutes === undefined ? null : minutes }, weekStart) === null) return;
    }
    onDone();
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="goal-name">Name</Label>
        <Input id="goal-name" autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Thesis" />
      </div>
      <div className="grid gap-1.5">
        <Label>Color</Label>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Color">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={c === color}
              aria-label={c}
              className={cn("flex size-7 items-center justify-center rounded-full ring-offset-2 ring-offset-background", c === color && "ring-2 ring-ring")}
              style={{ background: c }}
              onClick={() => setColor(c)}
            >
              {c === color && <Check className="size-4 text-white" />}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label>Kind</Label>
        <ToggleGroup type="single" variant="outline" value={kind} onValueChange={(v) => v && setKind(v as GoalKind)} className="justify-start">
          <ToggleGroupItem value="min" className="px-3">
            ≥ At least
          </ToggleGroupItem>
          <ToggleGroupItem value="max" className="px-3">
            ≤ At most
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {!goal && (
        <div className="grid gap-1.5">
          <Label htmlFor="goal-target">Target this week (hours)</Label>
          <Input
            id="goal-target"
            inputMode="decimal"
            className="w-32"
            placeholder="none"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Leave empty to only track time. Targets carry forward to later weeks.</p>
        </div>
      )}
      <DialogFooter className="items-center sm:justify-between">
        {goal ? <GoalDangerZone goal={goal} weekStart={weekStart} onDone={onDone} /> : <span />}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={!valid}>
            {goal ? "Save" : "Create goal"}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}

function GoalDangerZone({ goal, weekStart, onDone }: { goal: Goal; weekStart: LocalDate; onDone: () => void }) {
  const archived = !!goal.archivedOn;
  return (
    <div className="flex gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          editGoal(goal, { archivedOn: archived ? null : weekStart });
          onDone();
        }}
      >
        {archived ? "Unarchive" : "Archive"}
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="text-destructive">
            Delete
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{goal.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Only goals that no block or outcome uses can be deleted. Goals with history can be archived instead, which keeps past weeks intact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                if (await deleteGoal(goal)) onDone();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function GoalDialog({ open, onOpenChange, goal, weekStart }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{goal ? "Edit goal" : "New goal"}</DialogTitle>
          <DialogDescription>
            {goal ? "Archiving hides a goal from pickers from this week on; past weeks keep it." : "Track time against a weekly target."}
          </DialogDescription>
        </DialogHeader>
        {open && <Form key={goal?.id ?? "new"} goal={goal} weekStart={weekStart} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
