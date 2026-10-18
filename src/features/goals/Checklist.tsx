import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import type { ChecklistItem, LocalDate } from "@/domain/types";
import { cn } from "@/lib/utils";
import { addChecklistItem, editChecklistItem, removeChecklistItem, toggleChecklistItem } from "@/state/goalCommands";

function ItemRow({ item, editable }: { item: ChecklistItem; editable: boolean }) {
  const [text, setText] = useState(item.text);
  return (
    <li className="group flex items-center gap-2">
      <Checkbox checked={item.done} onCheckedChange={() => toggleChecklistItem(item)} aria-label={`Done: ${item.text}`} />
      {editable ? (
        <input
          aria-label="Outcome"
          className={cn(
            "min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-sm outline-none focus:bg-muted",
            item.done && "text-muted-foreground line-through",
          )}
          value={text}
          maxLength={500}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => editChecklistItem(item, text)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setText(item.text);
          }}
        />
      ) : (
        <span className={cn("min-w-0 flex-1 truncate text-sm", item.done && "text-muted-foreground line-through")}>{item.text}</span>
      )}
      {editable && (
        <button
          type="button"
          aria-label={`Delete outcome: ${item.text}`}
          className="invisible rounded p-0.5 text-muted-foreground group-hover:visible hover:text-destructive focus-visible:visible"
          onClick={() => removeChecklistItem(item)}
        >
          <X className="size-3.5" />
        </button>
      )}
    </li>
  );
}

/** A goal's outcome checklist for one week. `editable` adds inline editing and an add field. */
export function Checklist({ goalId, weekStart, items, editable = true }: { goalId: string; weekStart: LocalDate; items: readonly ChecklistItem[]; editable?: boolean }) {
  const [draft, setDraft] = useState("");
  const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    <ul className="grid gap-1">
      {sorted.map((i) => (
        // Remount when the stored text changes (undo) so the field shows it.
        <ItemRow key={`${i.id}:${i.text}`} item={i} editable={editable} />
      ))}
      {editable && (
        <li className="flex items-center gap-2 text-muted-foreground">
          <Plus className="size-4" />
          <input
            aria-label="Add outcome"
            placeholder="Add an outcome…"
            className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-sm outline-none focus:bg-muted"
            value={draft}
            maxLength={500}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim()) {
                addChecklistItem(goalId, weekStart, draft);
                setDraft("");
              }
            }}
          />
        </li>
      )}
    </ul>
  );
}
