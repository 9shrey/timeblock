import { ChevronLeft, ChevronRight, CopyPlus, PanelRight, Redo2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { addDays, addMonths, formatDateLong, formatMonthLong, isoWeek, weekdayLong, weekStartOf } from "@/domain/time/localDate";
import { copyWeekPlan, redo, undo } from "@/state/commands";
import { useStore } from "@/state/store";

/** Step size for ‹ › in the current view: a day in Day view, a week elsewhere. */
export function stepCursor(direction: -1 | 1): void {
  const { view, cursor } = useStore.getState();
  const next = view === "month" ? addMonths(cursor, direction) : addDays(cursor, direction * (view === "day" ? 1 : 7));
  useStore.setState({ cursor: next, selection: null });
}

export function goToday(): void {
  useStore.setState((s) => ({ cursor: s.now.day, selection: null }));
}

function IconButton({ label, shortcut, onClick, disabled, children }: { label: string; shortcut?: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} onClick={onClick} disabled={disabled}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {shortcut && <kbd className="ml-2 opacity-70">{shortcut}</kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

export function TopBar() {
  const cursor = useStore((s) => s.cursor);
  const today = useStore((s) => s.now.day);
  const view = useStore((s) => s.view);
  const weekStartDay = useStore((s) => s.settings.weekStartDay);
  const canUndo = useStore((s) => s.history.undo.length > 0);
  const canRedo = useStore((s) => s.history.redo.length > 0);
  const budgetOpen = useStore((s) => s.budgetOpen);
  const { week } = isoWeek(cursor);
  const unit = view === "day" ? "day" : view === "month" ? "month" : "week";
  const weekStart = weekStartOf(cursor, weekStartDay);

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
      <IconButton label={`Previous ${unit}`} shortcut="[" onClick={() => stepCursor(-1)}>
        <ChevronLeft />
      </IconButton>
      <Button variant={cursor === today ? "secondary" : "outline"} size="sm" onClick={goToday}>
        Today
      </Button>
      <IconButton label={`Next ${unit}`} shortcut="]" onClick={() => stepCursor(1)}>
        <ChevronRight />
      </IconButton>
      <h1 className="ml-2 text-sm font-semibold">
        {view === "day" ? `${weekdayLong(cursor)}, ${formatDateLong(cursor)}` : view === "month" ? formatMonthLong(cursor) : formatDateLong(cursor)}
        {view !== "month" && <span className="ml-2 font-normal text-muted-foreground">W{week}</span>}
      </h1>
      {view === "week" && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="sm" className="ml-2" onClick={() => copyWeekPlan(addDays(weekStart, -7), weekStart)}>
              <CopyPlus /> Copy last week's plan
            </Button>
          </TooltipTrigger>
          <TooltipContent>Copies every day of last week onto this week. Locked and past days are skipped.</TooltipContent>
        </Tooltip>
      )}
      <div className="flex-1" />
      <IconButton label="Undo" shortcut="Ctrl+Z" onClick={undo} disabled={!canUndo}>
        <Undo2 />
      </IconButton>
      <IconButton label="Redo" shortcut="Ctrl+Shift+Z" onClick={redo} disabled={!canRedo}>
        <Redo2 />
      </IconButton>
      <IconButton label={budgetOpen ? "Hide week budget" : "Show week budget"} shortcut="Ctrl+B" onClick={() => useStore.setState({ budgetOpen: !budgetOpen })}>
        <PanelRight />
      </IconButton>
    </header>
  );
}
