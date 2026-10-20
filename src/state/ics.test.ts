import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seededStore } from "@/test/harness";
import type { Platform } from "@/platform";
import { addSubscription, removeSubscription, startCalendarSync, useIcsOverlay } from "./ics";
import { subscriptionList } from "./selectors";
import { undo, useStore } from "./store";

const URL_A = "https://calendar.example.com/a/basic.ics";
const FEED = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:weekly@example.com",
  "SUMMARY:Team sync",
  "DTSTART:20260105T100000",
  "DTEND:20260105T110000",
  "RRULE:FREQ=WEEKLY;BYDAY=WE",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

let fetchText: ReturnType<typeof vi.fn<(url: string) => Promise<string>>>;
let stop: () => void;

beforeEach(async () => {
  await seededStore(); // now = Wed 2026-10-21
  useIcsOverlay.setState({ events: [], fileName: null, range: null, status: {} });
  fetchText = vi.fn(async () => FEED);
  stop = startCalendarSync({ fetchText } as unknown as Platform);
});
afterEach(() => stop());

const subs = () => subscriptionList(useStore.getState().data.calendarSubscriptions);
const onDay = (day: string) => useIcsOverlay.getState().events.filter((e) => e.day === day);

describe("calendar subscriptions", () => {
  it("fetches a new subscription and shows its recurring events around the cursor", async () => {
    expect(addSubscription("Team", "webcal://calendar.example.com/a/basic.ics")).toBeNull();
    expect(subs().map((s) => s.url)).toEqual([URL_A]);
    await vi.waitFor(() => expect(onDay("2026-10-21")).toHaveLength(1));
    expect(fetchText).toHaveBeenCalledWith(URL_A);
    expect(onDay("2026-10-21")[0]).toMatchObject({ title: "Team sync", startMinute: 600, endMinute: 660 });
    expect(onDay("2026-10-28")).toHaveLength(1);
    const id = subs()[0]!.id;
    expect(useIcsOverlay.getState().status[id]).toMatchObject({ loading: false, error: null });
  });

  it("re-expands when the cursor moves far away", async () => {
    addSubscription("Team", URL_A);
    await vi.waitFor(() => expect(onDay("2026-10-21")).toHaveLength(1));
    useStore.setState({ cursor: "2027-03-17" });
    expect(onDay("2027-03-17")).toHaveLength(1);
    expect(fetchText).toHaveBeenCalledTimes(1);
  });

  it("records a failed fetch on the subscription", async () => {
    fetchText.mockRejectedValueOnce(new Error("The server answered 404 Not Found."));
    addSubscription("Team", URL_A);
    const id = subs()[0]!.id;
    await vi.waitFor(() => expect(useIcsOverlay.getState().status[id]?.error).toMatch(/404/));
    expect(useIcsOverlay.getState().events).toEqual([]);
  });

  it("drops a removed subscription's events, and brings them back on undo", async () => {
    addSubscription("Team", URL_A);
    await vi.waitFor(() => expect(onDay("2026-10-21")).toHaveLength(1));
    removeSubscription(subs()[0]!);
    expect(useIcsOverlay.getState().events).toEqual([]);
    undo();
    await vi.waitFor(() => expect(onDay("2026-10-21")).toHaveLength(1));
    expect(fetchText).toHaveBeenCalledTimes(2);
  });

  it("refuses an invalid or duplicate link", () => {
    expect(addSubscription("", "http://calendar.example.com/a.ics")).toMatch(/https/);
    addSubscription("Team", URL_A);
    expect(addSubscription("Again", URL_A)).toMatch(/already/);
    expect(subs()).toHaveLength(1);
  });
});
