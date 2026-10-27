import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { setShortcutsOpen, useUi } from "@/state/ui";

const GROUPS: { title: string; rows: { keys: string; label: string }[] }[] = [
  {
    title: "Navigate",
    rows: [
      { keys: "[ / ]", label: "Previous / next day or week" },
      { keys: "t", label: "Go to today" },
      { keys: "d / w / m / g / r / i", label: "Day / Week / Month / Goals / Review / Trends view" },
      { keys: "Ctrl+K", label: "Command palette" },
      { keys: "?", label: "This sheet" },
    ],
  },
  {
    title: "Create",
    rows: [
      { keys: "n", label: "Quick add (Day view)" },
      { keys: "⏎", label: "Edit the selected block" },
      { keys: "Del / ⌫", label: "Delete block, or skip a ghost" },
      { keys: "Ctrl/⇧ + click", label: "Add or remove a block from the selection" },
      { keys: "Ctrl+A", label: "Select every block on this day or week (Del deletes)" },
    ],
  },
  {
    title: "Edit a selected block",
    rows: [
      { keys: "↑ / ↓", label: "Nudge by the snap interval" },
      { keys: "⇧ + ↑ / ↓", label: "Resize the end" },
      { keys: "1–9", label: "Set goal by position" },
      { keys: "a", label: "Confirm as planned" },
      { keys: "s", label: "Skip" },
    ],
  },
  {
    title: "Other",
    rows: [
      { keys: "⇧A", label: "Confirm rest of day (Day view)" },
      { keys: "Ctrl+Z / Ctrl+⇧Z", label: "Undo / redo" },
      { keys: "Ctrl+B", label: "Toggle week budget panel" },
      { keys: "Esc", label: "Close popover, or clear selection" },
    ],
  },
];

export function ShortcutsSheet() {
  const open = useUi((s) => s.shortcutsOpen);
  return (
    <Dialog open={open} onOpenChange={setShortcutsOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Shortcuts are ignored while typing in a field.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{group.title}</h3>
              <dl className="grid gap-1">
                {group.rows.map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-4 text-sm">
                    <dt className="text-muted-foreground">{row.label}</dt>
                    <dd>
                      <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">{row.keys}</kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
