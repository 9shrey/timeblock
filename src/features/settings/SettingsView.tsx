import { useEffect, useState } from "react";
import {
  CalendarArrowDown,
  CalendarArrowUp,
  Download,
  FileSpreadsheet,
  FolderOpen,
  HardDriveDownload,
  History,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ImportResult } from "@/domain/export/schema";
import { formatMinute, formatMinuteRange, weekDays, weekStartOf } from "@/domain/time/localDate";
import type { Routine, SnapMinutes, Template, ThemePref, TimeFormat, WeekStartDay } from "@/domain/types";
import { cn } from "@/lib/utils";
import { getPlatform, RELEASES_URL } from "@/platform";
import { applyImport, backupNow, exportCsv, exportJson, pickImportFile, setSetting } from "@/state/dataCommands";
import { exportIcs, importIcsFile } from "@/state/ics";
import { useGoalMap, useRoutines, useTemplates, useTimeFormat } from "@/state/selectors";
import { changeWeekStartDay, flushWrites, useStore } from "@/state/store";
import { deleteTemplate, renameTemplate } from "@/state/templateCommands";
import { checkForUpdate, installUpdate, plainReleaseNotes, useUpdates, type UpdateState } from "@/state/updates";
import { BackupList } from "./BackupList";
import { CalendarSubscriptions } from "./CalendarSubscriptions";
import { RoutineDialog } from "./RoutineDialog";

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-3 last:border-0">
      <div>
        <Label className="text-sm">{label}</Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Choice<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(options.find((o) => String(o.value) === v)!.value)}>
      <SelectTrigger className="w-40" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={String(o.value)} value={String(o.value)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const WEEK_STARTS: { value: WeekStartDay; label: string }[] = [
  { value: 1, label: "Monday" },
  { value: 0, label: "Sunday" },
  { value: 6, label: "Saturday" },
];
const SNAPS: { value: SnapMinutes; label: string }[] = [5, 10, 15, 30].map((v) => ({ value: v as SnapMinutes, label: `${v} minutes` }));
const LENGTHS = [15, 30, 45, 60, 90, 120, 180, 240].map((v) => ({ value: v, label: v < 60 ? `${v} minutes` : `${v / 60} h` }));
const dayStarts = (tf: TimeFormat) => Array.from({ length: 24 }, (_, h) => ({ value: h * 60, label: formatMinute(h * 60, tf) }));
const TIME_FORMATS: { value: TimeFormat; label: string }[] = [
  { value: "24h", label: "24-hour (13:00)" },
  { value: "12h", label: "12-hour (1:00 PM)" },
];
const THEMES: { value: ThemePref; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const COUNT_LABELS: Record<string, string> = {
  goals: "goals",
  weekTargets: "weekly targets",
  checklistItems: "outcomes",
  templates: "templates",
  routines: "routines",
  blocks: "blocks",
  weekNotes: "reflections",
  calendarSubscriptions: "calendar subscriptions",
  settings: "settings",
};

function TemplateRow({ template }: { template: Template }) {
  const [name, setName] = useState(template.name);
  const commitRename = () => {
    if (name.trim() !== template.name) renameTemplate(template, name);
    else setName(template.name);
  };
  return (
    <div className="flex items-center gap-2 border-b py-2 last:border-0">
      <Input
        value={name}
        maxLength={80}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitRename}
        onKeyDown={(e) => e.key === "Enter" && commitRename()}
        className="h-8"
      />
      <span className="shrink-0 text-xs text-muted-foreground">
        {template.spanDays === 1 ? "Day" : "Week"} · {template.blocks.length} block{template.blocks.length === 1 ? "" : "s"}
      </span>
      <Button variant="ghost" size="icon-xs" aria-label={`Delete "${template.name}"`} onClick={() => deleteTemplate(template)}>
        <Trash2 />
      </Button>
    </div>
  );
}

function TemplatesSection() {
  const templates = useTemplates();
  if (templates.length === 0) return null;
  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Templates</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Saved from a day or week's plan. Apply them from the block/empty-space menu in Day or Week view.
      </p>
      <div className="rounded-lg border px-4">
        {templates.map((t) => (
          <TemplateRow key={t.id} template={t} />
        ))}
      </div>
    </section>
  );
}

const WEEKDAY_LETTERS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function weekdaysSummary(mask: number): string {
  if (mask === 0b0111110) return "Weekdays";
  if (mask === 0b1000001) return "Weekends";
  if (mask === 0b1111111) return "Every day";
  return WEEKDAY_LETTERS.filter((_, i) => (mask & (1 << i)) !== 0).join(" ");
}

function RoutineRow({ routine, onEdit }: { routine: Routine; onEdit: () => void }) {
  const tf = useTimeFormat();
  const goals = useGoalMap();
  const goal = routine.goalId ? goals[routine.goalId] : null;
  return (
    <div className="flex items-center gap-3 border-b py-2 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm">
          {goal && <span className="size-2 shrink-0 rounded-full" style={{ background: goal.color }} />}
          <span className="truncate">{routine.title}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {formatMinuteRange(routine.startMinute, routine.endMinute, tf)} · {weekdaysSummary(routine.weekdays)}
          {routine.endsOn ? ` · until ${routine.endsOn}` : ""}
        </p>
      </div>
      <Button variant="ghost" size="icon-xs" aria-label={`Edit "${routine.title}"`} onClick={onEdit}>
        <Pencil />
      </Button>
    </div>
  );
}

function RoutinesSection() {
  const routines = useRoutines();
  const today = useStore((s) => s.now.day);
  const [editing, setEditing] = useState<Routine | null | undefined>(undefined);
  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Routines</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Recurring plan blocks. Editing one only updates occurrences you haven't customized.
      </p>
      <div className="rounded-lg border px-4">
        {routines.length === 0 && <p className="py-3 text-sm text-muted-foreground">No routines yet.</p>}
        {routines.map((r) => (
          <RoutineRow key={r.id} routine={r} onEdit={() => setEditing(r)} />
        ))}
      </div>
      <Button variant="outline" className="mt-2" onClick={() => setEditing(null)}>
        <Plus /> New routine
      </Button>
      <RoutineDialog open={editing !== undefined} onOpenChange={(o) => !o && setEditing(undefined)} routine={editing ?? null} today={today} />
    </section>
  );
}

function NotifyRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-3 last:border-0">
      <div className="flex items-center gap-2">
        <Checkbox id={`notify-${label}`} checked={checked} onCheckedChange={(c) => onChange(c === true)} />
        <Label htmlFor={`notify-${label}`} className="text-sm">
          {label}
        </Label>
      </div>
      <p className="max-w-xs text-right text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function NotificationsSection() {
  const settings = useStore((s) => s.settings);
  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Notifications</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Scheduled while Timeblock is running, from the same clock as the rest of the app — no background process.
      </p>
      <div className="rounded-lg border px-4">
        <NotifyRow
          label="Upcoming block"
          hint="5 minutes before a plan block starts."
          checked={settings.notifyNextBlock}
          onChange={(v) => setSetting("notifyNextBlock", v)}
        />
        <NotifyRow
          label="Unconfirmed blocks"
          hint="An evening nudge if today has anything unconfirmed."
          checked={settings.notifyUnconfirmed}
          onChange={(v) => setSetting("notifyUnconfirmed", v)}
        />
        <NotifyRow
          label="Weekly review"
          hint="On the last day of the week, once there's something to look back on."
          checked={settings.notifyWeeklyReview}
          onChange={(v) => setSetting("notifyWeeklyReview", v)}
        />
      </div>
    </section>
  );
}

function DesktopSection() {
  const settings = useStore((s) => s.settings);
  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Desktop</h2>
      <div className="rounded-lg border px-4">
        <NotifyRow
          label="Close to tray"
          hint="Closing the window hides it instead of quitting. Quit from the tray icon."
          checked={settings.closeToTray}
          onChange={(v) => setSetting("closeToTray", v)}
        />
      </div>
    </section>
  );
}

function updateStatus(state: UpdateState, version: string): string {
  switch (state.kind) {
    case "idle":
      return `You have Timeblock ${version}.`;
    case "checking":
      return "Checking for updates…";
    case "current":
      return `Timeblock ${version} is up to date.`;
    case "checkFailed":
      return "Couldn't reach the update server. Check your connection and try again.";
    case "available":
      return `Version ${state.update.version} is available. You have ${version}.`;
    case "downloading":
      return state.percent === null ? `Downloading ${state.update.version}…` : `Downloading ${state.update.version}… ${state.percent}%`;
    case "installing":
      return `Installing ${state.update.version}. Timeblock restarts when it's done.`;
    case "installFailed":
      return `Couldn't install ${state.update.version}: ${state.message}`;
  }
}

function UpdatesSection({ version }: { version: string }) {
  const state = useUpdates((s) => s.state);
  const autoCheck = useStore((s) => s.settings.autoCheckUpdates);
  const update = "update" in state ? state.update : null;
  const busy = state.kind === "checking" || state.kind === "downloading" || state.kind === "installing";
  const notes = update?.notes ? plainReleaseNotes(update.notes) : "";
  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Updates</h2>
      <div className="rounded-lg border px-4">
        <div className="flex flex-col gap-3 border-b py-3">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground" role="status">
              {updateStatus(state, version)}
            </p>
            {state.kind === "available" || state.kind === "installFailed" ? (
              <Button className="shrink-0" onClick={() => void getPlatform().then(installUpdate)}>
                {state.kind === "installFailed" ? "Try again" : "Install and restart"}
              </Button>
            ) : (
              <Button className="shrink-0" variant="outline" disabled={busy} onClick={() => void getPlatform().then((p) => checkForUpdate(p))}>
                Check for updates
              </Button>
            )}
          </div>
          {state.kind === "downloading" && (
            <div
              role="progressbar"
              aria-label="Download progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={state.percent ?? undefined}
              className="h-1.5 overflow-hidden rounded-full bg-muted"
            >
              <div
                className={cn("h-full rounded-full bg-primary transition-[width]", state.percent === null && "w-1/3 animate-pulse")}
                style={state.percent === null ? undefined : { width: `${state.percent}%` }}
              />
            </div>
          )}
          {update?.needsPassword && (state.kind === "available" || state.kind === "downloading" || state.kind === "installFailed") && (
            <p className="text-xs text-muted-foreground">Installing asks for your system password, because this copy was installed from a .deb or .rpm package.</p>
          )}
          {state.kind === "installFailed" && (
            <p className="text-xs text-muted-foreground">
              Your data is unchanged, and a backup was made first. You can also download the new version yourself.{" "}
              <Button variant="link" className="h-auto p-0 text-xs" onClick={() => void getPlatform().then((p) => p.openUrl(RELEASES_URL))}>
                Open the Releases page
              </Button>
            </p>
          )}
          {notes && (
            <details className="text-sm">
              <summary className="cursor-pointer select-none text-muted-foreground">What's new in {update!.version}</summary>
              <p className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed">{notes}</p>
            </details>
          )}
        </div>
        <NotifyRow
          label="Check automatically"
          hint="On launch and once a day while Timeblock runs. Nothing installs without your click."
          checked={autoCheck}
          onChange={(v) => setSetting("autoCheckUpdates", v)}
        />
      </div>
    </section>
  );
}

function IcsExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cursor = useStore((s) => s.cursor);
  const weekStartDay = useStore((s) => s.settings.weekStartDay);
  const week = weekDays(weekStartOf(cursor, weekStartDay));
  const [from, setFrom] = useState(week[0]!);
  const [to, setTo] = useState(week[6]!);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Export calendar</DialogTitle>
          <DialogDescription>Writes your plan and actual blocks for this range as a .ics file.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1">
            <Label htmlFor="ics-from">From</Label>
            <Input id="ics-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="ics-to">To</Label>
            <Input id="ics-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await exportIcs(from, to);
              setBusy(false);
              onClose();
            }}
          >
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({ pending, onClose }: { pending: { name: string; result: ImportResult } | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const result = pending?.result;
  return (
    <Dialog open={!!pending} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{result?.ok ? "Replace all data?" : "This file can't be imported"}</DialogTitle>
          <DialogDescription className="break-all">{pending?.name}</DialogDescription>
        </DialogHeader>
        {result && !result.ok && (
          <ul className="max-h-60 list-disc overflow-y-auto pl-5 text-sm text-destructive">
            {result.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
        {result?.ok && (
          <div className="grid gap-3 text-sm">
            <p>
              The file contains{" "}
              {Object.entries(result.counts)
                .filter(([k]) => k !== "settings")
                .map(([k, n]) => `${n} ${COUNT_LABELS[k] ?? k}`)
                .join(", ")}
              . Importing replaces <b>everything</b> currently in Timeblock. A backup of the current data is made first.
            </p>
            {result.warnings.length > 0 && (
              <div>
                <p className="font-medium">Repairs applied:</p>
                <ul className="max-h-40 list-disc overflow-y-auto pl-5 text-muted-foreground">
                  {result.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {result?.ok ? "Cancel" : "Close"}
          </Button>
          {result?.ok && (
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const ok = await applyImport(result.data);
                setBusy(false);
                if (ok) onClose();
              }}
            >
              Replace all data
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SettingsView() {
  const tf = useTimeFormat();
  const settings = useStore((s) => s.settings);
  const [pending, setPending] = useState<{ name: string; result: ImportResult } | null>(null);
  const [info, setInfo] = useState<{ kind: string; version: string; dir: string | null; lastBackup: number | null } | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [icsExportOpen, setIcsExportOpen] = useState(false);

  useEffect(() => {
    void getPlatform().then(async (p) =>
      setInfo({
        kind: p.kind,
        version: await p.appVersion(),
        dir: await p.dataDir(),
        lastBackup: (await p.listBackups().catch(() => []))[0]?.createdAt ?? null,
      }),
    );
  }, []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
        <section>
          <h2 className="mb-1 text-lg font-semibold">Preferences</h2>
          <div className="rounded-lg border px-4">
            <Row label="Week starts on" hint="Changing this moves targets, outcomes and reflections to the matching weeks and clears undo history.">
              <Choice
                label="Week starts on"
                value={settings.weekStartDay}
                options={WEEK_STARTS}
                onChange={(v) =>
                  void changeWeekStartDay(v).then(
                    () => toast("Week start changed"),
                    (e: unknown) => toast.error("Couldn't change the week start", { description: String(e) }),
                  )
                }
              />
            </Row>
            <Row label="Day starts at" hint="Where Day and Week views scroll to for days other than today.">
              <Choice label="Day starts at" value={settings.dayStartMinute} options={dayStarts(tf)} onChange={(v) => setSetting("dayStartMinute", v)} />
            </Row>
            <Row label="Time format" hint="How times are shown. Typing 9:30pm or 21:30 works either way.">
              <Choice label="Time format" value={settings.timeFormat} options={TIME_FORMATS} onChange={(v) => setSetting("timeFormat", v)} />
            </Row>
            <Row label="Snap to" hint="Hold Shift while dragging for 5-minute steps.">
              <Choice label="Snap to" value={settings.snapMinutes} options={SNAPS} onChange={(v) => setSetting("snapMinutes", v)} />
            </Row>
            <Row label="Default block length" hint="Used when you double-click an empty slot.">
              <Choice label="Default block length" value={settings.defaultBlockMinutes} options={LENGTHS} onChange={(v) => setSetting("defaultBlockMinutes", v)} />
            </Row>
            <Row label="Theme" hint="System follows your desktop's light/dark setting.">
              <Choice label="Theme" value={settings.theme} options={THEMES} onChange={(v) => setSetting("theme", v)} />
            </Row>
          </div>
        </section>

        <NotificationsSection />
        {info?.kind === "tauri" && <DesktopSection />}
        {info?.kind === "tauri" && <UpdatesSection version={info.version} />}
        <TemplatesSection />
        <RoutinesSection />

        <section>
          <h2 className="mb-1 text-lg font-semibold">Data</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Your data stays on this computer{info?.dir ? ` in ${info.dir}` : ""}. A backup is made automatically once a day; the newest 14 are kept.
            {info?.kind === "tauri" && (info.lastBackup ? ` Last backup: ${new Date(info.lastBackup * 1000).toLocaleString()}.` : " No backup yet.")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void exportJson()}>
              <Download /> Export JSON
            </Button>
            <Button variant="outline" onClick={() => void exportCsv()}>
              <FileSpreadsheet /> Export CSV (last 12 weeks)
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                const picked = await pickImportFile();
                if (picked) setPending(picked);
              }}
            >
              <Upload /> Import JSON…
            </Button>
            <Button variant="outline" onClick={() => void backupNow()}>
              <HardDriveDownload /> Back up now
            </Button>
            {info?.kind === "tauri" && (
              <Button variant="outline" onClick={() => setRestoreOpen(true)}>
                <History /> Restore a backup…
              </Button>
            )}
            {info?.kind === "tauri" && (
              <Button variant="outline" onClick={() => void getPlatform().then((p) => p.revealDataDir())}>
                <FolderOpen /> Open data folder
              </Button>
            )}
          </div>
        </section>

        <section>
          <h2 className="mb-1 text-lg font-semibold">Calendar</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Show a calendar's events as a read-only overlay in Day view, with a button to copy any of them into your plan — from a
            subscription that stays up to date, or a one-off .ics file. Export writes your plan and actual blocks for a date range as a
            calendar file.
          </p>
          <CalendarSubscriptions web={info?.kind === "web"} />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void importIcsFile()}>
              <CalendarArrowDown /> Import .ics…
            </Button>
            <Button variant="outline" onClick={() => setIcsExportOpen(true)}>
              <CalendarArrowUp /> Export .ics…
            </Button>
          </div>
        </section>

        <p className="text-xs text-muted-foreground">
          Timeblock {info?.version ?? ""} · MIT licensed{info?.kind === "web" ? " · browser dev mode (data in localStorage)" : ""}
        </p>
      </div>
      <ImportDialog pending={pending} onClose={() => setPending(null)} />
      <IcsExportDialog open={icsExportOpen} onClose={() => setIcsExportOpen(false)} />
      <Dialog open={restoreOpen} onOpenChange={setRestoreOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Restore a backup</DialogTitle>
            <DialogDescription>Restoring replaces all current data. Your current data is backed up first, and the app reloads.</DialogDescription>
          </DialogHeader>
          {restoreOpen && <BackupList beforeRestore={flushWrites} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
