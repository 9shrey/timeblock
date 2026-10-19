import { describe, expect, it } from "vitest";
import type { Block, Now } from "../types";
import { EVENING_NUDGE_MINUTE, WEEKLY_REVIEW_MINUTE, dueEveningNudge, dueNextBlockNotice, dueWeeklyReview } from "./schedule";

function block(over: Partial<Block>): Block {
  return {
    id: "b1",
    day: "2026-04-20",
    layer: "plan",
    startMinute: 600,
    endMinute: 660,
    title: "Thesis",
    goalId: null,
    notes: "",
    planBlockId: null,
    skipped: false,
    routineId: null,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe("dueNextBlockNotice", () => {
  const plan = block({ id: "p1", startMinute: 600, title: "Thesis" });

  it("fires within the lead window", () => {
    const now: Now = { day: "2026-04-20", minute: 596 };
    expect(dueNextBlockNotice(now, [plan], new Set())).toEqual({ kind: "nextBlock", blockId: "p1", title: "Thesis" });
  });

  it("does not fire outside the window", () => {
    expect(dueNextBlockNotice({ day: "2026-04-20", minute: 590 }, [plan], new Set())).toBeNull();
    expect(dueNextBlockNotice({ day: "2026-04-20", minute: 601 }, [plan], new Set())).toBeNull();
  });

  it("does not re-fire an already-notified block", () => {
    const now: Now = { day: "2026-04-20", minute: 598 };
    expect(dueNextBlockNotice(now, [plan], new Set(["p1"]))).toBeNull();
  });

  it("ignores blocks on other days", () => {
    const other = block({ id: "p2", day: "2026-04-21", startMinute: 0 });
    expect(dueNextBlockNotice({ day: "2026-04-20", minute: 1439 }, [other], new Set())).toBeNull();
  });
});

describe("dueEveningNudge", () => {
  const past = block({ id: "p1", startMinute: 540, endMinute: 600 });

  it("fires after the threshold when a plan block is unconfirmed", () => {
    const now: Now = { day: "2026-04-20", minute: EVENING_NUDGE_MINUTE };
    expect(dueEveningNudge(now, [past], false)).toEqual({ kind: "eveningNudge", day: "2026-04-20", unconfirmedCount: 1 });
  });

  it("does not fire before the threshold", () => {
    expect(dueEveningNudge({ day: "2026-04-20", minute: EVENING_NUDGE_MINUTE - 1 }, [past], false)).toBeNull();
  });

  it("does not fire twice in one day", () => {
    expect(dueEveningNudge({ day: "2026-04-20", minute: EVENING_NUDGE_MINUTE }, [past], true)).toBeNull();
  });

  it("does not fire when everything is confirmed", () => {
    const actual = block({ id: "a1", layer: "actual", planBlockId: "p1", startMinute: 540, endMinute: 600 });
    const now: Now = { day: "2026-04-20", minute: EVENING_NUDGE_MINUTE };
    expect(dueEveningNudge(now, [past, actual], false)).toBeNull();
  });
});

describe("dueWeeklyReview", () => {
  it("fires on the last day of the week at/after the threshold", () => {
    // Week starts Monday: 2026-04-20 is a Monday, so Sunday 2026-04-26 is the last day.
    const now: Now = { day: "2026-04-26", minute: WEEKLY_REVIEW_MINUTE };
    expect(dueWeeklyReview(now, 1, null)).toEqual({ kind: "weeklyReview", weekStart: "2026-04-20" });
  });

  it("does not fire on other days", () => {
    expect(dueWeeklyReview({ day: "2026-04-25", minute: WEEKLY_REVIEW_MINUTE }, 1, null)).toBeNull();
  });

  it("does not fire twice for the same week", () => {
    const now: Now = { day: "2026-04-26", minute: WEEKLY_REVIEW_MINUTE };
    expect(dueWeeklyReview(now, 1, "2026-04-20")).toBeNull();
  });

  it("fires again for a later week", () => {
    const now: Now = { day: "2026-04-26", minute: WEEKLY_REVIEW_MINUTE };
    expect(dueWeeklyReview(now, 1, "2026-04-13")).toEqual({ kind: "weeklyReview", weekStart: "2026-04-20" });
  });
});
