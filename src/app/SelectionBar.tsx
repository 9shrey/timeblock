import { ListChecks, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clearMulti, deleteMulti, selectAllVisible, setSelectMode } from "@/state/commands";
import { useStore } from "@/state/store";
import { useUi } from "@/state/ui";

/** Floating bar for select mode / the Ctrl+click multi-selection: select all, delete, or finish. */
export function SelectionBar() {
  const n = useUi((s) => s.multiSelected.length);
  const selectMode = useUi((s) => s.selectMode);
  const view = useStore((s) => s.view);
  if (n === 0 && !selectMode) return null;
  return (
    <div
      role="toolbar"
      aria-label="Selected blocks"
      className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-lg border bg-popover px-3 py-2 text-sm shadow-lg"
    >
      <span className="tabular-nums">{n === 0 ? "Drag a box over blocks" : `${n} selected`}</span>
      {(view === "day" || view === "week") && (
        <Button variant="outline" size="sm" onClick={selectAllVisible}>
          <ListChecks /> Select all {view === "day" ? "today" : "this week"}
        </Button>
      )}
      <Button variant="destructive" size="sm" disabled={n === 0} onClick={deleteMulti}>
        <Trash2 /> Delete
      </Button>
      {selectMode ? (
        <Button variant="ghost" size="sm" onClick={() => setSelectMode(false)}>
          Done
        </Button>
      ) : (
        <Button variant="ghost" size="sm" onClick={clearMulti}>
          <X /> Clear
        </Button>
      )}
    </div>
  );
}
