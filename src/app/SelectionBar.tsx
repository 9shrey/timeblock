import { Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clearMulti, deleteMulti } from "@/state/commands";
import { useUi } from "@/state/ui";

/** Floating bar for the Ctrl/Shift+click multi-selection: delete them all, or clear the selection. */
export function SelectionBar() {
  const n = useUi((s) => s.multiSelected.length);
  if (n === 0) return null;
  return (
    <div
      role="toolbar"
      aria-label="Selected blocks"
      className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-lg border bg-popover px-3 py-2 text-sm shadow-lg"
    >
      <span className="tabular-nums">{n} selected</span>
      <Button variant="destructive" size="sm" onClick={deleteMulti}>
        <Trash2 /> Delete
      </Button>
      <Button variant="ghost" size="sm" onClick={clearMulti}>
        <X /> Clear
      </Button>
    </div>
  );
}
