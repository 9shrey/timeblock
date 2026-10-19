import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_TEMPLATE_NAME_LENGTH } from "@/domain/templates";
import { weekStartOf } from "@/domain/time/localDate";
import { applyTemplateToDay, applyTemplateToWeek, saveDayAsTemplate, saveWeekAsTemplate } from "@/state/templateCommands";
import { useTemplates } from "@/state/selectors";
import { useStore } from "@/state/store";
import { closeTemplateDialog, useUi } from "@/state/ui";

function SaveForm({ scope, day, onDone }: { scope: "day" | "week"; day: string; onDone: () => void }) {
  const [name, setName] = useState("");
  const valid = name.trim().length >= 1 && name.trim().length <= MAX_TEMPLATE_NAME_LENGTH;
  const weekStartDay = useStore((s) => s.settings.weekStartDay);

  const save = () => {
    if (!valid) return;
    const saved = scope === "day" ? saveDayAsTemplate(day, name) : saveWeekAsTemplate(weekStartOf(day, weekStartDay), name);
    if (saved) onDone();
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="template-name">Name</Label>
        <Input
          id="template-name"
          autoFocus
          value={name}
          maxLength={MAX_TEMPLATE_NAME_LENGTH}
          onChange={(e) => setName(e.target.value)}
          placeholder={scope === "day" ? "e.g. Focus day" : "e.g. Typical week"}
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!valid}>
          Save template
        </Button>
      </DialogFooter>
    </form>
  );
}

function ApplyList({ scope, day, onDone }: { scope: "day" | "week"; day: string; onDone: () => void }) {
  const weekStartDay = useStore((s) => s.settings.weekStartDay);
  const templates = useTemplates().filter((t) => t.spanDays === (scope === "day" ? 1 : 7));
  if (templates.length === 0) {
    return <p className="text-sm text-muted-foreground">No {scope} templates saved yet.</p>;
  }
  return (
    <div className="grid gap-1">
      {templates.map((t) => (
        <Button
          key={t.id}
          type="button"
          variant="outline"
          className="justify-between"
          onClick={() => {
            const applied =
              scope === "day" ? applyTemplateToDay(t, day) : applyTemplateToWeek(t, weekStartOf(day, weekStartDay));
            if (applied) onDone();
          }}
        >
          {t.name}
          <span className="text-xs text-muted-foreground">{t.blocks.length} block{t.blocks.length === 1 ? "" : "s"}</span>
        </Button>
      ))}
    </div>
  );
}

/** Save-as-template or apply-template dialog, driven by `useUi().templateDialog`. */
export function TemplateDialog() {
  const state = useUi((s) => s.templateDialog);
  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && closeTemplateDialog()}>
      <DialogContent className="sm:max-w-md">
        {state && (
          <>
            <DialogHeader>
              <DialogTitle>
                {state.kind === "save" ? `Save this ${state.scope} as a template` : `Apply a ${state.scope} template`}
              </DialogTitle>
              <DialogDescription>
                {state.kind === "save"
                  ? "Applying it later creates ordinary, editable plan blocks; it never links back to this one."
                  : "Creates ordinary plan blocks from the template. Locked or past days are skipped."}
              </DialogDescription>
            </DialogHeader>
            {state.kind === "save" ? (
              <SaveForm key={`${state.scope}:${state.day}`} scope={state.scope} day={state.day} onDone={closeTemplateDialog} />
            ) : (
              <ApplyList key={`${state.scope}:${state.day}`} scope={state.scope} day={state.day} onDone={closeTemplateDialog} />
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
