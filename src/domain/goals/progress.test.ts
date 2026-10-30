import { describe, expect, it } from "vitest";
import { weekDays } from "../time/localDate";
import { activeDayCount, goalProgress, paceOf, weekMet, type ProgressInput } from "./progress";

const DAYS = weekDays("2026-10-19"); // Mon 19 … Sun 25
const WEEKDAYS = 0b0111110;

describe("paceOf", () => {
  it("spreads the target evenly over every day by default", () => {
    const p = paceOf(700, DAYS, 127, { day: "2026-10-21", minute: 720 });
    expect(p).toMatchObject({ target: 700, dayShare: 100, prorated: false });
    expect(p.expected).toBeCloseTo(250);
  });

  it("only counts active days", () => {
    const sat = paceOf(500, DAYS, WEEKDAYS, { day: "2026-10-24", minute: 600 });
    expect(sat).toMatchObject({ expected: 500, dayShare: 100 });
    const mon = paceOf(500, DAYS, WEEKDAYS, { day: "2026-10-19", minute: 0 });
    expect(mon.expected).toBe(0);
  });

  it("prorates from the start day", () => {
    const p = paceOf(700, DAYS, 127, { day: "2026-10-22", minute: 0 }, "2026-10-22");
    expect(p).toMatchObject({ target: 400, expected: 0, dayShare: 100, prorated: true });
  });

  it("treats an empty mask as every day", () => {
    expect(paceOf(700, DAYS, 0, { day: "2026-10-19", minute: 0 }).dayShare).toBe(100);
    expect(activeDayCount(WEEKDAYS)).toBe(5);
  });
});

describe("goalProgress", () => {
  const base: ProgressInput = {
    kind: "min",
    phase: "current",
    target: 600,
    actual: 0,
    remainingPlan: 0,
    expected: 300,
    dayShare: 100,
    outcomes: { done: 0, total: 0 },
  };

  it("reports pace and plan separately", () => {
    expect(goalProgress({ ...base, actual: 250, remainingPlan: 400 })).toEqual({ status: "on_pace", paceDelta: -50, planGap: 0 });
    expect(goalProgress({ ...base, actual: 150, remainingPlan: 100 })).toEqual({ status: "behind", paceDelta: -150, planGap: 350 });
  });

  it("time target decides; outcomes don't change it", () => {
    expect(goalProgress({ ...base, actual: 600, outcomes: { done: 0, total: 3 } }).status).toBe("met");
  });

  it("future weeks are judged by their plan only", () => {
    expect(goalProgress({ ...base, phase: "future", remainingPlan: 600 }).status).toBe("planned");
    expect(goalProgress({ ...base, phase: "future", remainingPlan: 500 })).toMatchObject({ status: "under_planned", planGap: 100 });
  });

  it("an at-most limit of 0 is still a limit", () => {
    expect(goalProgress({ ...base, kind: "max", target: 0, actual: 5 }).status).toBe("over");
  });
});

describe("weekMet", () => {
  it("is open until the week ends, except a reached target or a broken limit", () => {
    expect(weekMet("on_pace", "current")).toBeNull();
    expect(weekMet("within", "current")).toBeNull();
    expect(weekMet("met", "current")).toBe(true);
    expect(weekMet("over", "current")).toBe(false);
    expect(weekMet("within", "past")).toBe(true);
    expect(weekMet("missed", "past")).toBe(false);
    expect(weekMet("no_target", "past")).toBeNull();
  });
});
