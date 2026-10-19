import { useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatMinute, parseTimeInput } from "@/domain/time/localDate";
import type { LocalDate, Routine } from "@/domain/types";
import { createRoutine, deleteRoutine, editRoutine } from "@/state/routineCommands";
import { useGoals } from "@/state/selectors";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const NO_GOAL = "__none__";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Routine to edit; null creates a new one. */
  routine: Routine | null;
  /** The day a new routine starts on by default. */
  today: LocalDate;
}

function Form({ routine, today, onDone }: { routine: Routine | null; today: LocalDate; onDone: () => void }) {
  const goals = useGoals();
  const [title, setTitle] = useState(routine?.title ?? "");
  const [goalId, setGoalId] = useState(routine?.goalId ?? null);
  const [start, setStart] = useState(formatMinute(routine?.startMinute ?? 540));
  const [end, setEnd] = useState(formatMinute(routine?.endMinute ?? 600));
  const [weekdays, setWeekdays] = useState(routine?.weekdays ?? 0b0111110);
  const [startsOn, setStartsOn] = useState(routine?.startsOn ?? today);
  const [hasEnd, setHasEnd] = useState(routine?.endsOn !== null && routine !== null);
  const [endsOn, setEndsOn] = useState(routine?.endsOn ?? today);

  const startMinute = parseTimeInput(start);
  const endMinute = parseTimeInput(end);
  const valid =
    title.trim().length >= 1 &&
    title.trim().length <= 200 &&
    startMinute !== null &&
    endMinute !== null &&
    endMinute > startMinute &&
    weekdays !== 0;

  const toggleDay = (bit: number) => setWeekdays((w) => w ^ (1 << bit));

  const save = () => {
    if (!valid) return;
    const input = {
      title,
      goalId,
      notes: routine?.notes ?? "",
      startMinute: startMinute!,
      endMinute: endMinute!,
      weekdays,
      startsOn,
      endsOn: hasEnd ? endsOn : null,
    };
    const ok = routine ? editRoutine(routine, input) : createRoutine(input) !== null;
    if (ok) onDone();
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
        <Label htmlFor="routine-title">Title</Label>
        <Input id="routine-title" autoFocus value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Gym" />
      </div>
      <div className="grid gap-1.5">
        <Label>Goal</Label>
        <Select value={goalId ?? NO_GOAL} onValueChange={(v) => setGoalId(v === NO_GOAL ? null : v)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_GOAL}>No goal</SelectItem>
            {goals.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="routine-start">Start</Label>
          <Input id="routine-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="routine-end">End</Label>
          <Input id="routine-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label>Repeats on</Label>
        <div className="flex gap-1" role="group" aria-label="Repeats on">
          {WEEKDAY_LABELS.map((label, bit) => (
            <button
              key={bit}
              type="button"
              aria-pressed={(weekdays & (1 << bit)) !== 0}
              aria-label={label}
              onClick={() => toggleDay(bit)}
              className="flex size-8 items-center justify-center rounded-full border text-xs data-[on=true]:bg-primary data-[on=true]:text-primary-foreground"
              data-on={(weekdays & (1 << bit)) !== 0}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="routine-starts">Starts on</Label>
          <Input id="routine-starts" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <div className="flex items-center gap-2">
            <Checkbox id="routine-has-end" checked={hasEnd} onCheckedChange={(c) => setHasEnd(c === true)} />
            <Label htmlFor="routine-has-end">Ends on</Label>
          </div>
          <Input id="routine-ends" type="date" disabled={!hasEnd} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </div>
      </div>
      <DialogFooter className="items-center sm:justify-between">
        {routine ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="text-destructive">
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete “{routine.title}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  Occurrences already on the plan are kept as ordinary blocks; no new ones will be created.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => {
                    deleteRoutine(routine);
                    onDone();
                  }}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={!valid}>
            {routine ? "Save" : "Create routine"}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}

export function RoutineDialog({ open, onOpenChange, routine, today }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{routine ? "Edit routine" : "New routine"}</DialogTitle>
          <DialogDescription>
            Creates plan blocks automatically on the days it repeats. Editing it later only updates occurrences you
            haven't customized.
          </DialogDescription>
        </DialogHeader>
        {open && <Form key={routine?.id ?? "new"} routine={routine} today={today} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
