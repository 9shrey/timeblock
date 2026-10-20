/** A thin read-only strip of imported calendar events for the day, each copyable into a plan block. */
import { CalendarPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMinute } from "@/domain/time/localDate";
import type { LocalDate } from "@/domain/types";
import { clearIcsOverlay, copyToPlan, useIcsEventsOn, useIcsOverlay } from "@/state/ics";

export function IcsOverlay({ day }: { day: LocalDate }) {
  const events = useIcsEventsOn(day);
  const fileName = useIcsOverlay((s) => s.fileName);
  if (events.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2 text-xs">
      <span className="font-semibold tracking-wide text-muted-foreground uppercase">Imported</span>
      {events.map((e) => (
        <span key={e.id} className="flex items-center gap-1.5 rounded-full border bg-background px-2 py-1">
          <span className="text-muted-foreground">{e.allDay ? "All day" : `${formatMinute(e.startMinute)}–${formatMinute(e.endMinute)}`}</span>
          <span className="max-w-40 truncate font-medium">{e.title}</span>
          <Button variant="ghost" size="icon-xs" aria-label={`Copy "${e.title}" to plan`} onClick={() => copyToPlan(e)}>
            <CalendarPlus />
          </Button>
        </span>
      ))}
      {fileName && (
        <Button variant="ghost" size="icon-xs" aria-label="Clear events imported from a file" title={`Clear ${fileName}`} onClick={clearIcsOverlay} className="ml-auto">
          <X />
        </Button>
      )}
    </div>
  );
}
