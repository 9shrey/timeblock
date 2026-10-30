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
import { ALL_DAYS } from "@/domain/goals/progress";
import { effectiveTarget } from "@/domain/goals/targets";
import { formatHours, weekNumber } from "@/domain/time/localDate";
import type { Goal, GoalKind, LocalDate } from "@/domain/types";
import { createGoal, deleteGoal, editGoal, setTarget } from "@/state/goalCommands";
import { goalList, targetList, weekOf } from "@/state/selectors";
import { useStore } from "@/state/store";
import { cn } from "@/lib/utils";
import { dailyPaceHint, parseTargetInput } from "./TargetInput";
import { WeekdayPicker } from "./WeekdayPicker";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Goal to edit; null creates a new one. */
  goal: Goal | null;
  weekStart: LocalDate;
}

function Form({ goal, weekStart, onDone }: { goal: Goal | null; weekStart: LocalDate; onDone: () => void }) {
  const goals = useStore((s) => goalList(s.data.goals));
  const settings = useStore((s) => s.settings);
  const today = useStore((s) => s.now.day);
  const rows = useStore((s) => targetList(s.data.weekTargets));
  // A new goal starts this week; an edited target applies from the week being viewed.
  const targetWeek = goal ? weekStart : weekOf(today, settings).weekStart;
  const current = goal ? effectiveTarget(rows, goal.id, targetWeek).minutes : null;
  const initialTarget = current === null ? "" : formatHours(current);

  const [name, setName] = useState(goal?.name ?? "");
  const [color, setColor] = useState(goal?.color ?? nextColor(goals.map((g) => g.color)));
  const [kind, setKind] = useState<GoalKind>(goal?.kind ?? "min");
  const [activeDays, setActiveDays] = useState(goal?.activeDays ?? ALL_DAYS);
  const [target, setTargetText] = useState(initialTarget);
  const parsed = target.trim() === "" ? null : parseTargetInput(target);
  const targetInvalid = parsed === undefined;
  const validName = name.trim().length >= 1 && name.trim().length <= 80;
  const valid = validName && !targetInvalid && activeDays !== 0;
  const hint = parsed === undefined ? null : dailyPaceHint(parsed, activeDays);

  const save = () => {
    if (!valid || parsed === undefined) return;
    if (goal) {
      editGoal(goal, { name, color, kind, activeDays });
      if (target.trim() !== initialTarget) setTarget(goal.id, targetWeek, parsed);
    } else if (createGoal({ name, color, kind, activeDays, targetMinutes: parsed }, targetWeek) === null) {
      return;
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
        <Label htmlFor="goal-target">Weekly target</Label>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup type="single" variant="outline" value={kind} onValueChange={(v) => v && setKind(v as GoalKind)} aria-label="Kind">
            <ToggleGroupItem value="min" className="px-3">
              At least
            </ToggleGroupItem>
            <ToggleGroupItem value="max" className="px-3">
              At most
            </ToggleGroupItem>
          </ToggleGroup>
          <Input
            id="goal-target"
            aria-invalid={targetInvalid}
            className="w-20 text-right tabular-nums"
            placeholder="none"
            value={target}
            onChange={(e) => setTargetText(e.target.value)}
          />
          <span className="text-sm text-muted-foreground">hours per week</span>
        </div>
        <p className={cn("text-xs", targetInvalid ? "text-destructive" : "text-muted-foreground")}>
          {targetInvalid
            ? "Type hours like 15, 7.5, 1h30 or 90m."
            : target.trim() === ""
              ? "No target: time and outcomes are tracked, and the goal is judged by its outcomes."
              : kind === "min"
                ? `Only logged time counts. ${hint ?? ""}`.trim()
                : "Logged time counts against the limit; planned time warns you before you go over."}
        </p>
      </div>
      {kind === "min" && (
        <div className="grid gap-1.5">
          <Label>Spread over</Label>
          <WeekdayPicker value={activeDays} onChange={setActiveDays} weekStartDay={settings.weekStartDay} label="Days this goal is worked on" />
          <p className={cn("text-xs", activeDays === 0 ? "text-destructive" : "text-muted-foreground")}>
            {activeDays === 0 ? "Pick at least one day." : "Pace is measured over these days, so a weekday goal isn't behind on Saturday."}
          </p>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {goal
          ? `Target changes apply from week ${weekNumber(targetWeek)} on; earlier weeks keep theirs. Outcomes are added on the Goals page.`
          : "The target applies from this week on and carries forward until you change it. Add outcomes on the Goals page."}
      </p>
      <DialogFooter className="items-center sm:justify-between">
        {goal ? <GoalDangerZone goal={goal} onDone={onDone} /> : <span />}
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

function GoalDangerZone({ goal, onDone }: { goal: Goal; onDone: () => void }) {
  const archived = !!goal.archivedOn;
  const settings = useStore((s) => s.settings);
  const today = useStore((s) => s.now.day);
  return (
    <div className="flex gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          editGoal(goal, { archivedOn: archived ? null : weekOf(today, settings).weekStart });
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
            {goal
              ? "Archiving hides a goal from pickers from this week on; past weeks keep it."
              : "A weekly time target, a list of outcomes, or both."}
          </DialogDescription>
        </DialogHeader>
        {open && <Form key={goal?.id ?? "new"} goal={goal} weekStart={weekStart} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
