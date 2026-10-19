import { useEffect, useState } from "react";
import { Download, FolderOpen, HardDriveDownload, History, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ImportResult } from "@/domain/export/schema";
import { formatMinute } from "@/domain/time/localDate";
import type { SnapMinutes, ThemePref, WeekStartDay } from "@/domain/types";
import { getPlatform } from "@/platform";
import { applyImport, backupNow, exportJson, pickImportFile, setSetting } from "@/state/dataCommands";
import { changeWeekStartDay, flushWrites, useStore } from "@/state/store";
import { BackupList } from "./BackupList";

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
const DAY_STARTS = Array.from({ length: 24 }, (_, h) => ({ value: h * 60, label: formatMinute(h * 60) }));
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
  settings: "settings",
};

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
  const settings = useStore((s) => s.settings);
  const [pending, setPending] = useState<{ name: string; result: ImportResult } | null>(null);
  const [info, setInfo] = useState<{ kind: string; version: string; dir: string | null; lastBackup: number | null } | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);

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
              <Choice label="Day starts at" value={settings.dayStartMinute} options={DAY_STARTS} onChange={(v) => setSetting("dayStartMinute", v)} />
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

        <p className="text-xs text-muted-foreground">
          Timeblock {info?.version ?? ""} · MIT licensed{info?.kind === "web" ? " · browser dev mode (data in localStorage)" : ""}
        </p>
      </div>
      <ImportDialog pending={pending} onClose={() => setPending(null)} />
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
