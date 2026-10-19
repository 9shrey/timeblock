import { useState } from "react";
import { CalendarDays, CheckCheck, Download, LayoutTemplate, Target } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { isLocalDate } from "@/domain/time/localDate";
import { confirmRestOfDay, setGoal } from "@/state/commands";
import { exportJson } from "@/state/dataCommands";
import { useGoals, useTemplates } from "@/state/selectors";
import { useStore } from "@/state/store";
import { applyTemplateToDay, applyTemplateToWeek } from "@/state/templateCommands";
import { setCommandPaletteOpen, useUi } from "@/state/ui";

/**
 * Ctrl+K command palette: go to a date, apply a template, confirm the rest of the day,
 * switch the selected block's goal, or export. Built on cmdk, inside the shared Dialog.
 *
 * Filters itself (`shouldFilter={false}` on the Command root): the "Go to date" item only
 * exists once `search` parses as a date, and cmdk's own filter — which scores items via a
 * DOM-mutation-observed snapshot taken on mount — can miss an item that appears in the same
 * keystroke that makes it match, so it's simpler and more predictable to filter by hand.
 */
export function CommandPalette() {
  const open = useUi((s) => s.commandPaletteOpen);
  const cursor = useStore((s) => s.cursor);
  const templates = useTemplates();
  const goals = useGoals();
  const [search, setSearch] = useState("");
  const close = () => setCommandPaletteOpen(false);
  const selection = useStore((s) => s.selection);
  const sel = selection ? (selection.kind === "block" ? { kind: "block" as const, id: selection.id } : selection) : null;
  const q = search.trim().toLowerCase();
  const matches = (label: string) => q === "" || label.toLowerCase().includes(q);

  const run = (fn: () => void) => {
    fn();
    close();
  };

  const matchingTemplates = templates.filter((t) => matches(t.name));
  const matchingGoals = goals.filter((g) => matches(g.name));
  const showConfirm = matches("confirm rest of day");
  const showExport = matches("export json");
  const showNoGoal = matches("no goal");
  const anyMatch =
    isLocalDate(search) || showConfirm || matchingTemplates.length > 0 || (!!sel && (matchingGoals.length > 0 || showNoGoal)) || showExport;

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => {
        setCommandPaletteOpen(o);
        if (!o) setSearch("");
      }}
      title="Command palette"
      description="Jump to a date, apply a template, or run a command."
      shouldFilter={false}
    >
      <CommandInput value={search} onValueChange={setSearch} placeholder="Type a date (YYYY-MM-DD) or search commands…" />
      <CommandList>
        {!anyMatch && <CommandEmpty>No matching command.</CommandEmpty>}
        {isLocalDate(search) && (
          <CommandGroup heading="Go to date">
            <CommandItem onSelect={() => run(() => useStore.setState({ cursor: search, selection: null }))}>
              <CalendarDays /> Go to {search}
            </CommandItem>
          </CommandGroup>
        )}
        {showConfirm && (
          <CommandGroup heading="Plan">
            <CommandItem onSelect={() => run(() => confirmRestOfDay(cursor))}>
              <CheckCheck /> Confirm rest of day
            </CommandItem>
          </CommandGroup>
        )}
        {matchingTemplates.length > 0 && (
          <CommandGroup heading="Apply template">
            {matchingTemplates.map((t) => (
              <CommandItem
                key={t.id}
                onSelect={() => run(() => (t.spanDays === 1 ? applyTemplateToDay(t, cursor) : applyTemplateToWeek(t, cursor)))}
              >
                <LayoutTemplate /> {t.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {sel && (matchingGoals.length > 0 || showNoGoal) && (
          <CommandGroup heading="Switch goal">
            {matchingGoals.map((g) => (
              <CommandItem key={g.id} onSelect={() => run(() => setGoal(sel, g.id))}>
                <span className="size-2.5 rounded-full" style={{ background: g.color }} /> {g.name}
              </CommandItem>
            ))}
            {showNoGoal && (
              <CommandItem onSelect={() => run(() => setGoal(sel, null))}>
                <Target /> No goal
              </CommandItem>
            )}
          </CommandGroup>
        )}
        {showExport && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Data">
              <CommandItem onSelect={() => run(() => void exportJson())}>
                <Download /> Export JSON
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
