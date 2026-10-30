import { describe, expect, it } from "vitest";
import { dueNotifications, EVENING_MINUTE } from "./notifications";
import { DEFAULT_SETTINGS } from "./settings";
import type { Block, Goal } from "./types";

const DAY = "2026-10-19"; // Monday, with weekStartDay 1

const block = (over: Partial<Block> = {}): Block => ({
  id: "b",
  day: DAY,
  layer: "plan",
  startMinute: 540,
  endMinute: 600,
  title: "Write",
  goalId: null,
  notes: "",
  planBlockId: null,
  skipped: false,
  routineId: null,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

const goal = (id: string, name: string): Goal => ({
  id,
  name,
  color: "#336699",
  kind: "min",
  trackBy: "time", activeDays: 127,
  sortOrder: 0,
  archivedOn: null,
  createdAt: 0,
  updatedAt: 0,
});

const settings = { ...DEFAULT_SETTINGS, notifyNextBlock: true, notifyUnconfirmed: true, notifyWeeklyReview: true };

describe("dueNotifications: next block", () => {
  it("fires exactly 5 minutes before an unskipped plan block starts", () => {
    const b = block({ startMinute: 545 });
    const events = dueNotifications({ blocks: [b], goals: {}, settings, now: { day: DAY, minute: 540 }, weekStartDay: 1 });
    expect(events).toEqual([{ key: "next-block:b", title: "Next block in 5 min", body: "Write · 09:05", action: "openDay" }]);
  });

  it("shows the start time in the 12-hour format when set", () => {
    const b = block({ startMinute: 545 });
    const twelve = { ...settings, timeFormat: "12h" as const };
    const events = dueNotifications({ blocks: [b], goals: {}, settings: twelve, now: { day: DAY, minute: 540 }, weekStartDay: 1 });
    expect(events[0]?.body).toBe("Write · 9:05 AM");
  });

  it("includes the goal name when the title is blank", () => {
    const b = block({ startMinute: 545, title: "", goalId: "g1" });
    const events = dueNotifications({
      blocks: [b],
      goals: { g1: goal("g1", "Thesis") },
      settings,
      now: { day: DAY, minute: 540 },
      weekStartDay: 1,
    });
    expect(events[0]?.body).toBe("Thesis · 09:05");
  });

  it("does not fire at other offsets, for skipped blocks, or for actual blocks", () => {
    const base = { day: DAY, minute: 540 } as const;
    expect(dueNotifications({ blocks: [block({ startMinute: 544 })], goals: {}, settings, now: base, weekStartDay: 1 })).toEqual([]);
    expect(dueNotifications({ blocks: [block({ startMinute: 546 })], goals: {}, settings, now: base, weekStartDay: 1 })).toEqual([]);
    expect(dueNotifications({ blocks: [block({ startMinute: 545, skipped: true })], goals: {}, settings, now: base, weekStartDay: 1 })).toEqual([]);
    expect(dueNotifications({ blocks: [block({ startMinute: 545, layer: "actual" })], goals: {}, settings, now: base, weekStartDay: 1 })).toEqual([]);
  });

  it("is off when the setting is disabled", () => {
    const b = block({ startMinute: 545 });
    const off = { ...settings, notifyNextBlock: false };
    expect(dueNotifications({ blocks: [b], goals: {}, settings: off, now: { day: DAY, minute: 540 }, weekStartDay: 1 })).toEqual([]);
  });
});

describe("dueNotifications: evening unconfirmed nudge", () => {
  it("fires at 20:00 when today has an unconfirmed (past) ghost", () => {
    const b = block({ startMinute: 540, endMinute: 600 }); // ended at 10:00, well before 20:00
    const now = { day: DAY, minute: EVENING_MINUTE };
    const events = dueNotifications({ blocks: [b], goals: {}, settings, now, weekStartDay: 1 });
    expect(events).toContainEqual({
      key: `unconfirmed:${DAY}`,
      title: "1 unconfirmed block today",
      body: "Open Day view to confirm what happened.",
      action: "openDay",
    });
  });

  it("does not fire outside 20:00, or when there's nothing unconfirmed", () => {
    const b = block();
    expect(dueNotifications({ blocks: [b], goals: {}, settings, now: { day: DAY, minute: EVENING_MINUTE - 1 }, weekStartDay: 1 })).toEqual([]);
    const confirmed = [b, block({ id: "a", layer: "actual", planBlockId: "b" })];
    expect(dueNotifications({ blocks: confirmed, goals: {}, settings, now: { day: DAY, minute: EVENING_MINUTE }, weekStartDay: 1 })).toEqual([]);
  });

  it("is off when the setting is disabled", () => {
    const off = { ...settings, notifyUnconfirmed: false };
    const events = dueNotifications({ blocks: [block()], goals: {}, settings: off, now: { day: DAY, minute: EVENING_MINUTE }, weekStartDay: 1 });
    expect(events).toEqual([]);
  });
});

describe("dueNotifications: weekly review", () => {
  it("fires at 20:00 only on the last day of the week", () => {
    const sunday = "2026-10-25"; // last day of the Mon-start week containing DAY
    const events = dueNotifications({ blocks: [], goals: {}, settings, now: { day: sunday, minute: EVENING_MINUTE }, weekStartDay: 1 });
    expect(events).toContainEqual({
      key: `weekly-review:${sunday}`,
      title: "Weekly review is ready",
      body: "This week's plan vs. actual is ready to look back on.",
      action: "openReview",
    });
    expect(dueNotifications({ blocks: [], goals: {}, settings, now: { day: DAY, minute: EVENING_MINUTE }, weekStartDay: 1 })).toEqual([]);
  });

  it("respects a different week start day", () => {
    const saturday = "2026-10-24"; // last day of a Sunday-start week
    const events = dueNotifications({ blocks: [], goals: {}, settings, now: { day: saturday, minute: EVENING_MINUTE }, weekStartDay: 0 });
    expect(events.some((e) => e.key.startsWith("weekly-review"))).toBe(true);
  });

  it("is off when the setting is disabled", () => {
    const sunday = "2026-10-25";
    const off = { ...settings, notifyWeeklyReview: false };
    expect(dueNotifications({ blocks: [], goals: {}, settings: off, now: { day: sunday, minute: EVENING_MINUTE }, weekStartDay: 1 })).toEqual([]);
  });
});
