import { useState } from "react";
import { Input } from "@/components/ui/input";
import { formatHours, isoWeek } from "@/domain/time/localDate";
import type { LocalDate } from "@/domain/types";
import { setTarget } from "@/state/goalCommands";

/** "7.5" / "7,5" / "7h" → minutes rounded to a quarter hour; undefined if invalid. */
export function hoursToMinutes(text: string): number | undefined {
  const n = Number(text.trim().replace(",", ".").replace(/h$/i, ""));
  if (!Number.isFinite(n) || n < 0 || n > 168) return undefined;
  return Math.round(n * 4) * 15;
}

interface Props {
  goalId: string;
  weekStart: LocalDate;
  minutes: number | null;
  fromWeek: LocalDate | null;
}

/** Target hours for one week (0.25 h steps). Empty = tracked only. Shows where an inherited value comes from. */
export function TargetInput({ goalId, weekStart, minutes, fromWeek }: Props) {
  const initial = minutes === null ? "" : formatHours(minutes);
  const [text, setText] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const inherited = fromWeek !== null && fromWeek !== weekStart;

  const commit = () => {
    if (text.trim() === initial) return;
    if (text.trim() === "") {
      setTarget(goalId, weekStart, null);
      return;
    }
    const m = hoursToMinutes(text);
    if (m === undefined) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setTarget(goalId, weekStart, m);
  };

  return (
    <div className="flex items-center gap-1.5">
      <Input
        aria-label="Target hours this week"
        aria-invalid={invalid}
        inputMode="decimal"
        className="h-8 w-16 text-right tabular-nums"
        placeholder="–"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setText(initial);
        }}
      />
      <span className="text-xs text-muted-foreground">h</span>
      {inherited && minutes !== null && <span className="text-xs text-muted-foreground">inherited from W{isoWeek(fromWeek).week}</span>}
      {minutes === null && <span className="text-xs text-muted-foreground">tracked only</span>}
    </div>
  );
}
