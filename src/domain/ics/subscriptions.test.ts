import { describe, expect, it } from "vitest";
import type { CalendarSubscription, Env } from "../types";
import { addSubscriptionChanges, normalizeCalendarUrl, removeSubscriptionChanges } from "./subscriptions";

const env: Env = { newId: () => "s-new", nowMs: () => 1000 };
const GOOGLE = "https://calendar.google.com/calendar/ical/me%40example.com/private-abc123/basic.ics";

describe("normalizeCalendarUrl", () => {
  it("accepts an https link as is", () => {
    expect(normalizeCalendarUrl(`  ${GOOGLE} `)).toEqual({ ok: true, value: GOOGLE });
  });

  it("turns webcal:// into https://", () => {
    expect(normalizeCalendarUrl("webcal://p01-caldav.icloud.com/published/2/abc")).toEqual({
      ok: true,
      value: "https://p01-caldav.icloud.com/published/2/abc",
    });
  });

  it("refuses http, other schemes, junk and empty input", () => {
    expect(normalizeCalendarUrl("http://example.com/cal.ics")).toMatchObject({ ok: false, error: expect.stringMatching(/https/) });
    expect(normalizeCalendarUrl("file:///home/me/cal.ics").ok).toBe(false);
    expect(normalizeCalendarUrl("not a url").ok).toBe(false);
    expect(normalizeCalendarUrl("   ").ok).toBe(false);
  });
});

describe("addSubscriptionChanges", () => {
  it("creates a subscription, naming it after the host when no name is given", () => {
    const r = addSubscriptionChanges("", GOOGLE, [], env);
    if (!r.ok) throw new Error(r.error);
    expect(r.subscription).toEqual({ id: "s-new", name: "calendar.google.com", url: GOOGLE, createdAt: 1000, updatedAt: 1000 });
    expect(r.changes).toEqual([{ op: "put", table: "calendarSubscriptions", row: r.subscription }]);
  });

  it("refuses a duplicate link and an overlong name", () => {
    const existing: CalendarSubscription = { id: "s1", name: "Work", url: GOOGLE, createdAt: 1, updatedAt: 1 };
    expect(addSubscriptionChanges("Again", GOOGLE, [existing], env)).toMatchObject({ ok: false, error: expect.stringMatching(/already/) });
    expect(addSubscriptionChanges("x".repeat(81), GOOGLE, [], env).ok).toBe(false);
  });

  it("removes by id", () => {
    const sub: CalendarSubscription = { id: "s1", name: "Work", url: GOOGLE, createdAt: 1, updatedAt: 1 };
    expect(removeSubscriptionChanges(sub)).toEqual([{ op: "del", table: "calendarSubscriptions", key: "s1" }]);
  });
});
