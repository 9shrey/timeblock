import { CalendarDays, CalendarRange, ClipboardCheck, Settings, Target, type LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { statsFor, weekOf } from "@/state/selectors";
import { useStore, type View } from "@/state/store";

const ITEMS: { view: View; label: string; icon: LucideIcon; key: string }[] = [
  { view: "day", label: "Day", icon: CalendarDays, key: "D" },
  { view: "week", label: "Week", icon: CalendarRange, key: "W" },
  { view: "goals", label: "Goals", icon: Target, key: "G" },
  { view: "review", label: "Review", icon: ClipboardCheck, key: "R" },
];

/** Number of days up to today in the current week with unconfirmed plan blocks. */
function useUnconfirmedDays(): number {
  return useStore((s) => {
    const { weekStart, days } = weekOf(s.now.day, s.settings);
    return statsFor(s.data, days, weekStart, s.now).uncorrectedDays.length;
  });
}

function RailButton({ view, label, icon: Icon, shortcut, badge }: { view: View; label: string; icon: LucideIcon; shortcut?: string; badge?: number }) {
  const active = useStore((s) => s.view === view);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={badge ? `${label} (${badge} days to review)` : label}
          aria-current={active ? "page" : undefined}
          onClick={() => useStore.setState({ view })}
          className={cn(
            "relative flex w-14 flex-col items-center gap-0.5 rounded-md py-2 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
            active && "bg-accent text-foreground",
          )}
        >
          <Icon className="size-5" />
          {label}
          {!!badge && (
            <span className="absolute top-1 right-2 min-w-4 rounded-full bg-primary px-1 text-[10px] leading-4 font-semibold text-primary-foreground">
              {badge}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        {label}
        {shortcut && <kbd className="ml-2 opacity-70">{shortcut}</kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

export function NavRail() {
  const unconfirmed = useUnconfirmedDays();
  return (
    <nav className="flex w-16 shrink-0 flex-col items-center gap-1 border-r bg-muted/30 py-3" aria-label="Views">
      {ITEMS.map((i) => (
        <RailButton key={i.view} view={i.view} label={i.label} icon={i.icon} shortcut={i.key} badge={i.view === "review" ? unconfirmed : undefined} />
      ))}
      <div className="flex-1" />
      <RailButton view="settings" label="Settings" icon={Settings} />
    </nav>
  );
}
