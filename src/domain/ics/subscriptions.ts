/** Calendar subscriptions: validating a pasted link, and the ChangeSets that add or remove one. */
import { del, put } from "../changes";
import type { CalendarSubscription, ChangeSet, Env } from "../types";

export const MAX_SUBSCRIPTION_NAME_LENGTH = 80;
export const MAX_SUBSCRIPTION_URL_LENGTH = 2048;
/** How often subscriptions are re-fetched while the app runs. */
export const SUBSCRIPTION_REFRESH_MS = 30 * 60_000;

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * A pasted calendar link as the `https://` URL to fetch: `webcal://` (what "subscribe"
 * buttons hand out) becomes `https://`; plain `http://` is refused, since a secret link
 * sent in the clear isn't secret, and the desktop app only allows https.
 */
export function normalizeCalendarUrl(input: string): Checked<string> {
  let text = input.trim();
  if (!text) return { ok: false, error: "Paste the calendar's .ics link." };
  if (/^webcals?:\/\//i.test(text)) text = text.replace(/^webcals?:\/\//i, "https://");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: "That isn't a valid link." };
  }
  if (url.protocol === "http:") return { ok: false, error: "Use the https:// version of this link." };
  if (url.protocol !== "https:") return { ok: false, error: "Calendar links start with https:// or webcal://." };
  const href = url.href;
  if (href.length > MAX_SUBSCRIPTION_URL_LENGTH) return { ok: false, error: "That link is too long." };
  return { ok: true, value: href };
}

/** The name shown for a subscription: what the user typed, else the link's host. */
export function subscriptionName(input: string, url: string): Checked<string> {
  const name = input.trim() || new URL(url).hostname;
  if ([...name].length > MAX_SUBSCRIPTION_NAME_LENGTH)
    return { ok: false, error: `Names need at most ${MAX_SUBSCRIPTION_NAME_LENGTH} characters.` };
  return { ok: true, value: name };
}

export function addSubscriptionChanges(
  nameInput: string,
  urlInput: string,
  existing: readonly CalendarSubscription[],
  env: Env,
): { ok: true; subscription: CalendarSubscription; changes: ChangeSet } | { ok: false; error: string } {
  const url = normalizeCalendarUrl(urlInput);
  if (!url.ok) return url;
  if (existing.some((s) => s.url === url.value)) return { ok: false, error: "You're already subscribed to this calendar." };
  const name = subscriptionName(nameInput, url.value);
  if (!name.ok) return name;
  const now = env.nowMs();
  const subscription: CalendarSubscription = { id: env.newId(), name: name.value, url: url.value, createdAt: now, updatedAt: now };
  return { ok: true, subscription, changes: [put("calendarSubscriptions", subscription)] };
}

export function removeSubscriptionChanges(subscription: CalendarSubscription): ChangeSet {
  return [del("calendarSubscriptions", subscription.id)];
}
