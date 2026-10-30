import { useState } from "react";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { activeDayCount } from "@/domain/goals/progress";
import { formatDuration, formatHours, isoWeek } from "@/domain/time/localDate";
import type { LocalDate } from "@/domain/types";
import { clearTarget, MAX_TARGET_MINUTES, setTarget } from "@/state/goalCommands";

/**
 * A weekly time target typed as "15", "7.5", "7,5", "15h", "1h30", "1h 30m", "90m" or "1:30"
 * → minutes, rounded to 5 (a non-zero amount never rounds down to 0). Undefined if invalid.
 */
export function parseTargetInput(text: string): number | undefined {
  const t = text.trim().toLowerCase().replace(/\s+/g, "").replace(",", ".");
  let m: RegExpExecArray | null;
  let minutes: number;
  if ((m = /^(\d+(?:\.\d+)?)(?:h|hrs?|hours?)?$/.exec(t))) minutes = Number(m[1]) * 60;
  else if ((m = /^(\d+)h([0-5]?\d)(?:m|min)?$/.exec(t))) minutes = Number(m[1]) * 60 + Number(m[2]);
  else if ((m = /^(\d+):([0-5]\d)$/.exec(t))) minutes = Number(m[1]) * 60 + Number(m[2]);
  else if ((m = /^(\d+)(?:m|mins?|minutes?)$/.exec(t))) minutes = Number(m[1]);
  else return undefined;
  if (!Number.isFinite(minutes) || minutes > MAX_TARGET_MINUTES) return undefined;
  const rounded = Math.round(minutes / 5) * 5;
  return minutes > 0 && rounded === 0 ? 5 : rounded;
}

/** "≈ 3h a day over 5 days", or null when there's nothing useful to say. */
export function dailyPaceHint(minutes: number | null, activeDays: number): string | null {
  if (minutes === null || minutes <= 0) return null;
  const n = activeDayCount(activeDays) || 7;
  const perDay = Math.round(minutes / n / 5) * 5;
  return `≈ ${formatDuration(Math.max(5, perDay))} a day over ${n} day${n === 1 ? "" : "s"}`;
}

interface Props {
  goalId: string;
  weekStart: LocalDate;
  minutes: number | null;
  /** Week the effective target was set in; null = never set. */
  fromWeek: LocalDate | null;
  /** What this week would inherit without its own row (shown on the "use previous" button). */
  previous: { minutes: number | null; fromWeek: LocalDate | null } | null;
}

/** Target hours for one week, carried forward to later weeks. Empty = no target. */
export function TargetInput({ goalId, weekStart, minutes, fromWeek, previous }: Props) {
  const initial = minutes === null ? "" : formatHours(minutes);
  const [text, setText] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const own = fromWeek === weekStart;
  const inherited = fromWeek !== null && !own;

  const commit = () => {
    if (text.trim() === initial) {
      setInvalid(false);
      return;
    }
    if (text.trim() === "") {
      setInvalid(false);
      setTarget(goalId, weekStart, null);
      return;
    }
    const m = parseTargetInput(text);
    if (m === undefined) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setTarget(goalId, weekStart, m);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Input
        aria-label="Target hours per week"
        aria-invalid={invalid}
        title="Hours per week, e.g. 15, 7.5, 1h30 or 90m"
        className="h-8 w-20 text-right tabular-nums"
        placeholder="none"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setText(initial);
            setInvalid(false);
          }
        }}
      />
      <span className="text-xs text-muted-foreground">h / week</span>
      {invalid && <span className="text-xs text-destructive">Try 15, 7.5, 1h30 or 90m</span>}
      {!invalid && inherited && <span className="text-xs text-muted-foreground">since W{isoWeek(fromWeek).week}</span>}
      {!invalid && own && previous?.fromWeek && (
        <Button
          variant="ghost"
          size="xs"
          className="text-muted-foreground"
          title={`Drop this week's change and use the earlier target (${previous.minutes === null ? "none" : formatDuration(previous.minutes)})`}
          onClick={() => clearTarget(goalId, weekStart)}
        >
          <Undo2 /> Use previous
        </Button>
      )}
    </div>
  );
}
