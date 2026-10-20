/** Settings → Calendar: subscribe to `.ics` links, see when each was last fetched, refresh or remove them. */
import { useState } from "react";
import { Link, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { systemEnv } from "@/domain/env";
import type { CalendarSubscription } from "@/domain/types";
import { addSubscription, refreshSubscriptions, removeSubscription, useIcsOverlay, type SubscriptionStatus } from "@/state/ics";
import { subscriptionList } from "@/state/selectors";
import { useStore } from "@/state/store";

function ago(ms: number, now: number): string {
  const min = Math.max(0, Math.round((now - ms) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

function statusText(status: SubscriptionStatus | undefined): string {
  if (!status || (status.loading && status.fetchedAt === null)) return "Fetching…";
  if (status.loading) return "Refreshing…";
  if (status.fetchedAt === null) return "Not fetched yet";
  return `Updated ${ago(status.fetchedAt, systemEnv.nowMs())}`;
}

/** The secret part of a private link is the path, so only the host is ever shown. */
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

function SubscriptionRow({ sub }: { sub: CalendarSubscription }) {
  const status = useIcsOverlay((s) => s.status[sub.id]);
  return (
    <li className="flex items-start gap-3 border-b py-2 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{sub.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {hostOf(sub.url)} · {statusText(status)}
        </p>
        {status?.error && (
          <p role="alert" className="text-xs text-destructive">
            {status.error}
          </p>
        )}
      </div>
      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${sub.name}`} onClick={() => removeSubscription(sub)}>
        <Trash2 />
      </Button>
    </li>
  );
}

export function CalendarSubscriptions({ web }: { web: boolean }) {
  const subs = useStore((s) => subscriptionList(s.data.calendarSubscriptions));
  const anyLoading = useIcsOverlay((s) => Object.values(s.status).some((x) => x.loading));
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const problem = addSubscription(name, url);
    setError(problem);
    if (!problem) {
      setName("");
      setUrl("");
    }
  };

  return (
    <div className="mb-3 flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Subscriptions</h3>
        {subs.length > 0 && (
          <Button variant="outline" size="sm" disabled={anyLoading} onClick={() => void refreshSubscriptions({ manual: true })}>
            <RefreshCw className={anyLoading ? "animate-spin" : undefined} /> Refresh
          </Button>
        )}
      </div>
      {subs.length > 0 ? (
        <ul>
          {subs.map((s) => (
            <SubscriptionRow key={s.id} sub={s} />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          Paste a calendar's secret iCal link — in Google Calendar, Settings → your calendar → "Secret address in iCal format"; in
          Outlook, Settings → Calendar → Shared calendars → Publish a calendar → ICS. Subscriptions refresh when Timeblock starts and
          every 30 minutes.
        </p>
      )}
      {web && subs.length === 0 && (
        <p className="text-xs text-muted-foreground">
          In the browser, most calendar hosts block these requests (CORS); subscriptions work in the desktop app.
        </p>
      )}
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1 sm:w-36">
          <Label htmlFor="sub-name" className="text-xs">
            Name
          </Label>
          <Input id="sub-name" placeholder="Work" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor="sub-url" className="text-xs">
            .ics link
          </Label>
          <Input
            id="sub-url"
            placeholder="https://… or webcal://…"
            value={url}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        <Button type="submit" variant="outline" disabled={!url.trim()}>
          <Link /> Subscribe
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
