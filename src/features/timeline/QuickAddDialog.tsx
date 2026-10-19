import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatDayLabel } from "@/domain/time/localDate";
import { quickAddBlock } from "@/state/commands";
import { closeQuickAdd, useUi } from "@/state/ui";

function Form({ day, layer, onDone }: { day: string; layer: "plan" | "actual"; onDone: () => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const err = quickAddBlock(day, layer, text);
    if (err) setError(err);
    else onDone();
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Input
        autoFocus
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        placeholder="9-10:30 Thesis #thesis"
      />
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      <p className="mt-2 text-xs text-muted-foreground">
        {formatDayLabel(day)} · {layer === "plan" ? "Plan" : "Actual"}
      </p>
    </form>
  );
}

/** One-line quick-add input, opened with the `n` key. */
export function QuickAddDialog() {
  const state = useUi((s) => s.quickAdd);
  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && closeQuickAdd()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Quick add</DialogTitle>
          <DialogDescription>Start-end, a title and an optional #tag to set the goal.</DialogDescription>
        </DialogHeader>
        {state && <Form key={`${state.day}:${state.layer}`} day={state.day} layer={state.layer} onDone={closeQuickAdd} />}
      </DialogContent>
    </Dialog>
  );
}
