import { describe, expect, it } from "vitest";
import { biggestGaps } from "./gaps";
import { weekDays } from "../time/localDate";
import type { Block, Goal, Now } from "../types";

const WEEK = "2026-10-19";
const DAYS = weekDays(WEEK);
const MON = "2026-10-19";
const now: Now = { day: "2026-10-23", minute: 0 }; // Friday: Mon-Thu are past

let seq = 0;
function block(p: Partial<Block> & Pick<Block, "day" | "startMinute" | "endMinute">): Block {
  return {
    id: `b${++seq}`,
    layer: "plan",
    title: "",
    goalId: null,
    notes: "",
    planBlockId: null,
    skipped: false,
    routineId: null,
    createdAt: 0,
    updatedAt: 0,
    ...p,
  };
}
const plan = (day: string, s: number, e: number, p: Partial<Block> = {}) => block({ day, startMinute: s, endMinute: e, ...p });
const actual = (day: string, s: number, e: number, p: Partial<Block> = {}) => block({ day, startMinute: s, endMinute: e, layer: "actual", ...p });

const goal = (id: string, name: string): Goal => ({ id, name, color: "#336699", kind: "min", sortOrder: 0, archivedOn: null, createdAt: 0, updatedAt: 0 });

describe("biggestGaps", () => {
  it("is empty with no unplanned actuals or unconfirmed plans", () => {
    const p = plan(MON, 540, 600, { id: "p1" });
    const a = actual(MON, 540, 600, { planBlockId: "p1" });
    expect(biggestGaps([p, a], DAYS, {}, now)).toEqual([]);
  });

  it("includes an unplanned actual block, titled from its goal", () => {
    const a = actual(MON, 540, 600, { goalId: "g1", title: "" });
    const gaps = biggestGaps([a], DAYS, { g1: goal("g1", "Thesis") }, now);
    expect(gaps).toEqual([{ day: MON, startMinute: 540, endMinute: 600, minutes: 60, kind: "unplanned", title: "Thesis" }]);
  });

  it("includes a past, unconfirmed plan block as a gap", () => {
    const p = plan(MON, 540, 600, { title: "Write" });
    const gaps = biggestGaps([p], DAYS, {}, now);
    expect(gaps).toEqual([{ day: MON, startMinute: 540, endMinute: 600, minutes: 60, kind: "unconfirmed", title: "Write" }]);
  });

  it("excludes a future unconfirmed plan block, a skipped one, and a confirmed one", () => {
    const future = plan("2026-10-25", 540, 600); // Sunday, still future
    const skipped = plan(MON, 540, 600, { skipped: true });
    const confirmedPlan = plan(MON, 600, 660, { id: "p2" });
    const confirmedActual = actual(MON, 600, 660, { planBlockId: "p2" });
    expect(biggestGaps([future, skipped, confirmedPlan, confirmedActual], DAYS, {}, now)).toEqual([]);
  });

  it("sorts largest first and respects the limit", () => {
    const small = actual(MON, 540, 570); // 30 min
    const big = actual(MON, 600, 720); // 120 min
    const gaps = biggestGaps([small, big], DAYS, {}, now, 1);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.minutes).toBe(120);
  });

  it("ignores blocks outside the given days", () => {
    expect(biggestGaps([actual("2026-09-01", 540, 600)], DAYS, {}, now)).toEqual([]);
  });
});
