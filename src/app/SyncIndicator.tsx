import { Cloud, CloudAlert, CloudOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { syncNow, useSync } from "@/sync/engine";

function ago(ms: number | null): string {
  if (ms == null) return "not yet";
  // eslint-disable-next-line no-restricted-syntax -- display only
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(ms).toLocaleString();
}

/** Top-bar sync status. Hidden when not signed in; click to sync now. */
export function SyncIndicator() {
  const status = useSync((s) => s.status);
  const last = useSync((s) => s.lastSyncedAt);
  const error = useSync((s) => s.error);
  const username = useSync((s) => s.username);
  if (status === "off") return null;

  const label =
    status === "syncing"
      ? "Syncing…"
      : status === "offline"
        ? "Offline — changes are saved here and sync when you're back"
        : status === "error"
          ? `Sync problem: ${error ?? "unknown error"}`
          : `Synced ${ago(last)}`;
  const Icon = status === "syncing" ? RefreshCw : status === "offline" ? CloudOff : status === "error" ? CloudAlert : Cloud;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} data-sync-status={status} onClick={() => void syncNow()}>
          <Icon className={status === "syncing" ? "animate-spin" : status === "error" ? "text-destructive" : undefined} />
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        {label}
        {username && <div className="opacity-70">Signed in as {username} · click to sync now</div>}
      </TooltipContent>
    </Tooltip>
  );
}
