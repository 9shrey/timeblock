import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getPlatform, type BackupInfo } from "@/platform";

const REASONS: Record<string, string> = {
  auto: "Daily",
  manual: "Manual",
  "pre-clear": "Before clearing data",
  "pre-import": "Before import",
  "pre-migration": "Before upgrade",
  "pre-restore": "Before restore",
};

/** "data-1760860800-pre-import.sqlite3" → "Before import". */
function reasonOf(name: string): string {
  const reason = name.replace(/^data-\d+-/, "").replace(/(-\d+)?\.sqlite3$/, "");
  return REASONS[reason] ?? reason;
}

const formatSize = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/**
 * Backups, newest first, each restorable after a confirm step. Restoring backs up the current
 * data first, then reloads the window so the app boots on the restored file.
 */
export function BackupList({ beforeRestore }: { beforeRestore?: () => Promise<void> }) {
  const [backups, setBackups] = useState<BackupInfo[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getPlatform()
      .then((p) => p.listBackups())
      .then(setBackups, (e: unknown) => setError(String(e)));
  }, []);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!backups) return null;
  if (backups.length === 0) return <p className="text-sm text-muted-foreground">No backups yet.</p>;

  const restore = async (name: string) => {
    setBusy(true);
    try {
      await beforeRestore?.();
      await (await getPlatform()).restoreBackup(name);
      location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <ul className="grid max-h-72 gap-1 overflow-y-auto text-sm" aria-label="Backups">
      {backups.map((b) => (
        <li key={b.name} className="flex items-center gap-3 rounded-md px-2 py-1 hover:bg-muted/50">
          <span className="w-44 tabular-nums">{new Date(b.createdAt * 1000).toLocaleString()}</span>
          <span className="flex-1 text-muted-foreground">
            {reasonOf(b.name)} · {formatSize(b.sizeBytes)}
          </span>
          {confirming === b.name ? (
            <>
              <Button size="xs" variant="destructive" disabled={busy} onClick={() => void restore(b.name)}>
                Replace current data
              </Button>
              <Button size="xs" variant="ghost" disabled={busy} onClick={() => setConfirming(null)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button size="xs" variant="outline" disabled={busy} onClick={() => setConfirming(b.name)}>
              <History /> Restore
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
