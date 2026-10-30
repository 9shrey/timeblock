import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { weekDays } from "../time/localDate";
import type { Block, ChecklistItem, Goal, GoalKind, Now, WeekTarget } from "../types";
import { computeStats, UNASSIGNED, type GoalStatus, type StatsInput, type WeekPhase } from "./stats";

const WEEK = "2026-10-19";
const DAYS = weekDays(WEEK);
const MON = "2026-10-19";
const WED = "2026-10-21";
const FRI = "2026-10-23";
const SUN = "2026-10-25";

let seq = 0;
function block(p: Partial<Block> & Pick<Block, "day" | "startMinute" | "endMinute">): Block {
  return {
    id: `b${++seq}`,
    layer: "plan",
    title: "",
    goalId: "g",
    notes: "",
    planBlockId: null,
    skipped: false,
    routineId: null,
    createdAt: 0,
    updatedAt: 0,
    ...p,
  };
}
const plan = (day: string, s: number, e: number, p: Partial<Block> = {}) =>
  block({ day, startMinute: s, endMinute: e, ...p });
const actual = (day: string, s: number, e: number, p: Partial<Block> = {}) =>
  block({ day, startMinute: s, endMinute: e, layer: "actual", ...p });

function goal(id: string, p: Partial<Goal> = {}): Goal {
  return { id, name: id, color: "#336699", kind: "min", trackBy: "time", activeDays: 127, sortOrder: 0, archivedOn: null, createdAt: 0, updatedAt: 0, ...p };
}
const target = (goalId: string, weekStart: string, targetMinutes: number | null): WeekTarget => ({
  goalId,
  weekStart,
  targetMinutes,
  targetCount: null,
  updatedAt: 0,
});

const NOW_CURRENT: Now = { day: WED, minute: 720 };
function input(p: Partial<StatsInput>): StatsInput {
  return {
    days: DAYS,
    weekStart: WEEK,
    blocks: [],
    goals: [goal("g")],
    targets: [],
    checklist: [],
    now: NOW_CURRENT,
    ...p,
  };
}
const statsOf = (p: Partial<StatsInput>, id = "g") => {
  const s = computeStats(input(p)).goals.find((g) => g.goalId === id);
  if (!s) throw new Error(`no stats for ${id}`);
  return s;
};

describe("computeStats amounts", () => {
  it("Thesis 9-11 plus 10-12 counts 180 min, not 240", () => {
    const s = statsOf({ blocks: [actual(MON, 540, 660), actual(MON, 600, 720)] });
    expect(s.actual).toBe(180);
    expect(s.byDay[MON]!.actual).toBe(180);
    expect(s.unplanned).toBe(180);
  });

  it("a 01:30-03:30 block on the DST day 2026-10-25 counts 120 min", () => {
    const s = statsOf({ blocks: [actual(SUN, 90, 210)], now: { day: "2026-11-01", minute: 0 } });
    expect(s.actual).toBe(120);
    expect(s.byDay[SUN]!.actual).toBe(120);
  });

  it("splits ghosts into unconfirmed and upcoming at now", () => {
    const s = statsOf({
      blocks: [plan(MON, 60, 120), plan(WED, 660, 780), plan(FRI, 600, 660)],
      now: { day: WED, minute: 720 },
    });
    expect(s.unconfirmed).toBe(60 + 60);
    expect(s.upcoming).toBe(60 + 60);
    expect(s.byDay[WED]).toMatchObject({ unconfirmed: 60, upcoming: 60 });
    expect(s.actual).toBe(0);
    expect(s.projected).toBe(240);
    expect(s.planned).toBe(240);
  });

  it("counts unplanned actuals and skipped plans; linked/skipped plans are not ghosts", () => {
    const p1 = plan(MON, 540, 600);
    const p2 = plan(MON, 600, 660, { skipped: true });
    const s = statsOf({
      blocks: [p1, p2, actual(MON, 540, 610, { planBlockId: p1.id }), actual(MON, 700, 730)],
    });
    expect(s.planned).toBe(120);
    expect(s.skipped).toBe(60);
    expect(s.actual).toBe(100);
    expect(s.unplanned).toBe(30);
    expect(s.unconfirmed + s.upcoming).toBe(0);
    expect(s.projected).toBe(100);
  });

  it("projected is the union of actual and ghosts", () => {
    const s = statsOf({ blocks: [actual(FRI, 600, 660), plan(FRI, 630, 720)] });
    expect(s.projected).toBe(120);
  });

  it("ignores blocks outside input.days", () => {
    const s = statsOf({ blocks: [actual("2026-10-26", 0, 60), actual("2026-10-18", 0, 60)] });
    expect(s.actual).toBe(0);
  });

  it("the unassigned bucket collects goalId null blocks; totals union across goals", () => {
    const st = computeStats(
      input({
        goals: [goal("g"), goal("h", { sortOrder: 1 })],
        blocks: [
          actual(MON, 540, 600, { goalId: null }),
          actual(MON, 570, 630, { goalId: null }),
          actual(MON, 540, 660, { goalId: "g" }),
          actual(MON, 600, 720, { goalId: "h" }),
        ],
      }),
    );
    expect(st.unassigned).toMatchObject({ goalId: UNASSIGNED, goal: null, actual: 90, status: "no_target" });
    expect(st.goals.map((g) => [g.goalId, g.actual])).toEqual([
      ["g", 120],
      ["h", 120],
    ]);
    expect(st.totals.actual).toBe(180);
    expect(st.byDay[MON]!.actual).toBe(180);
    expect(computeStats(input({ blocks: [actual(MON, 0, 60)] })).unassigned).toBeNull();
  });

  it("totals equal the sum of byDay and never exceed the sum of buckets", () => {
    const arbBlock = fc
      .record({
        day: fc.constantFrom(...DAYS),
        s: fc.integer({ min: 0, max: 1439 }),
        len: fc.integer({ min: 1, max: 240 }),
        layer: fc.constantFrom("plan" as const, "actual" as const),
        goalId: fc.constantFrom("g", "h", null),
        skipped: fc.boolean(),
      })
      .map((r) =>
        block({
          day: r.day,
          startMinute: r.s,
          endMinute: Math.min(1440, r.s + r.len),
          layer: r.layer,
          goalId: r.goalId,
          skipped: r.layer === "plan" && r.skipped,
        }),
      );
    fc.assert(
      fc.property(fc.array(arbBlock, { maxLength: 15 }), (blocks) => {
        const st = computeStats(input({ goals: [goal("g"), goal("h")], blocks }));
        const keys = ["planned", "actual", "unconfirmed", "upcoming", "projected", "unplanned", "skipped"] as const;
        const buckets = [...st.goals, ...(st.unassigned ? [st.unassigned] : [])];
        for (const k of keys) {
          expect(DAYS.reduce((n, d) => n + st.byDay[d]![k], 0)).toBe(st.totals[k]);
          expect(st.totals[k]).toBeLessThanOrEqual(buckets.reduce((n, b) => n + b[k], 0));
          expect(st.totals[k]).toBeLessThanOrEqual(7 * 1440);
        }
        expect(st.totals.unconfirmed + st.totals.upcoming).toBeGreaterThanOrEqual(0);
      }),
    );
  });
});

describe("computeStats phase and status", () => {
  const NOWS: Record<WeekPhase, Now> = {
    past: { day: "2026-11-02", minute: 600 },
    current: NOW_CURRENT,
    future: { day: "2026-10-12", minute: 600 },
  };
  // a = actual minutes on Monday, p = ghost (plan) minutes on Friday; T = 120 over 7 days.
  // "Current" is Wednesday noon: a steady pace expects 2.5/7 × 120 ≈ 43 min, a day's share ≈ 17.
  const cases: [WeekPhase, GoalKind, GoalStatus, number, number][] = [
    ["past", "min", "met", 120, 0],
    ["past", "min", "missed", 60, 120],
    ["current", "min", "met", 120, 0],
    ["current", "min", "on_pace", 60, 0],
    ["current", "min", "on_pace", 30, 0], // behind the pace, but by less than a day's share
    ["current", "min", "behind", 0, 120], // a plan alone doesn't keep you on pace
    ["current", "min", "behind", 20, 0],
    ["future", "min", "planned", 0, 120],
    ["future", "min", "under_planned", 0, 60],
    ["past", "max", "over", 180, 0],
    ["past", "max", "within", 120, 120],
    ["current", "max", "over", 180, 0],
    ["current", "max", "watch", 60, 120],
    ["current", "max", "within", 60, 60],
    ["future", "max", "watch", 0, 180],
    ["future", "max", "within", 0, 120],
  ];

  it.each(cases)("%s %s → %s (actual %i, ghost %i)", (phase, kind, status, a, p) => {
    const blocks: Block[] = [];
    if (a) blocks.push(actual(MON, 0, a));
    if (p) blocks.push(plan(FRI, 0, p));
    const st = computeStats(
      input({ goals: [goal("g", { kind })], targets: [target("g", "2026-10-05", 120)], blocks, now: NOWS[phase] }),
    );
    expect(st.phase).toBe(phase);
    expect(st.goals[0]).toMatchObject({ kind, target: 120, targetFromWeek: "2026-10-05", status });
  });

  it("no target → no_target (including a tracked-only row)", () => {
    expect(statsOf({ blocks: [actual(MON, 0, 600)] }).status).toBe("no_target");
    const s = statsOf({ targets: [target("g", "2026-10-05", 60), target("g", WEEK, null)] });
    expect(s).toMatchObject({ status: "no_target", target: null, targetFromWeek: WEEK });
  });

  it("a target from a later week does not apply", () => {
    expect(statsOf({ targets: [target("g", "2026-10-26", 60)] }).target).toBeNull();
  });
});

describe("computeStats goals list, checklist, uncorrected days", () => {
  const item = (id: string, goalId: string, weekStart: string, done: boolean): ChecklistItem => ({
    id,
    goalId,
    weekStart,
    text: id,
    done,
    sortOrder: 0,
    carriedFromId: null,
    createdAt: 0,
    updatedAt: 0,
  });

  it("lists active goals in sortOrder and archived goals only when used", () => {
    const st = computeStats(
      input({
        goals: [
          goal("c", { sortOrder: 2 }),
          goal("a", { sortOrder: 0 }),
          goal("later", { sortOrder: 1, archivedOn: "2026-10-26" }),
          goal("gone", { sortOrder: 3, archivedOn: WEEK }),
          goal("usedTime", { sortOrder: 4, archivedOn: "2026-10-01" }),
          goal("usedList", { sortOrder: 5, archivedOn: "2026-10-01" }),
        ],
        blocks: [actual(MON, 0, 30, { goalId: "usedTime" })],
        checklist: [item("i1", "usedList", WEEK, false)],
      }),
    );
    expect(st.goals.map((g) => g.goalId)).toEqual(["a", "later", "c", "usedTime", "usedList"]);
  });

  it("checklist progress counts only that goal and week", () => {
    const s = statsOf({
      goals: [goal("g"), goal("h")],
      checklist: [
        item("1", "g", WEEK, true),
        item("2", "g", WEEK, false),
        item("3", "g", "2026-10-12", true),
        item("4", "h", WEEK, true),
      ],
    });
    expect(s.checklist).toEqual({ done: 1, total: 2 });
  });

  it("uncorrectedDays are days up to today with a ghost whose end has passed", () => {
    const st = computeStats(
      input({
        now: { day: WED, minute: 720 },
        blocks: [
          plan(MON, 60, 120),
          plan("2026-10-20", 60, 120, { skipped: true }),
          plan(WED, 600, 720),
          plan(WED, 700, 800),
          plan(FRI, 0, 60),
        ],
      }),
    );
    expect(st.uncorrectedDays).toEqual([MON, WED]);
    const st2 = computeStats(input({ now: { day: WED, minute: 719 }, blocks: [plan(WED, 600, 720)] }));
    expect(st2.uncorrectedDays).toEqual([]);
  });
});

describe("computeStats pacing details", () => {
  const item = (id: string, done: boolean): ChecklistItem => ({
    id,
    goalId: "g",
    weekStart: WEEK,
    text: id,
    done,
    sortOrder: 0,
    carriedFromId: null,
    createdAt: 0,
    updatedAt: 0,
  });

  it("past unconfirmed plan never counts as progress", () => {
    const s = statsOf({ targets: [target("g", WEEK, 120)], blocks: [plan(MON, 0, 120)] });
    expect(s).toMatchObject({ unconfirmed: 120, actual: 0, status: "behind" });
  });

  it("Monday at midnight with nothing planned is on pace, not behind", () => {
    const s = statsOf({ targets: [target("g", WEEK, 900)], now: { day: MON, minute: 0 } });
    expect(s).toMatchObject({ status: "on_pace", expected: 0, paceDelta: 0, planGap: 900 });
  });

  it("a weekday goal isn't behind over the weekend", () => {
    // 5 h over Mon–Fri, 1 h logged each weekday; Sunday 18:00.
    const blocks = [MON, "2026-10-20", WED, "2026-10-22", FRI].map((d) => actual(d, 540, 600));
    const s = statsOf({
      goals: [goal("g", { activeDays: 0b0111110 })],
      targets: [target("g", WEEK, 300)],
      blocks,
      now: { day: SUN, minute: 1080 },
    });
    expect(s).toMatchObject({ status: "met" });
    const s2 = statsOf({
      goals: [goal("g", { activeDays: 0b0111110 })],
      targets: [target("g", WEEK, 600)],
      blocks,
      now: { day: SUN, minute: 1080 },
    });
    // Every weekday has passed, so the full 10 h is expected: 5 h behind.
    expect(s2).toMatchObject({ status: "behind", expected: 600, paceDelta: -300 });
  });

  it("actual time later today doesn't count toward pace yet", () => {
    const s = statsOf({ targets: [target("g", WEEK, 120)], blocks: [actual(WED, 700, 800)] });
    expect(s).toMatchObject({ actual: 100, actualSoFar: 20 });
  });

  it("a goal created mid-week gets a prorated target", () => {
    const createdAt = new Date(2026, 9, 22, 9, 0).getTime(); // Thursday
    const s = statsOf({ goals: [goal("g", { createdAt })], targets: [target("g", WEEK, 700)], now: { day: "2026-10-22", minute: 720 } });
    expect(s).toMatchObject({ prorated: true, weeklyTarget: 700, target: 400 });
  });

  it("a goal doesn't appear in weeks before it existed", () => {
    const createdAt = new Date(2026, 10, 3, 9, 0).getTime();
    expect(computeStats(input({ goals: [goal("g", { createdAt })] })).goals).toEqual([]);
  });

  it("a goal without a time target is judged by its outcomes once the week ends", () => {
    const checklist = [item("1", true), item("2", false)];
    expect(statsOf({ checklist }).status).toBe("open");
    expect(statsOf({ checklist, now: { day: "2026-11-02", minute: 0 } }).status).toBe("missed");
    expect(statsOf({ checklist: [item("1", true)] }).status).toBe("met");
  });

  it("an at-least target of 0 means no target", () => {
    expect(statsOf({ targets: [target("g", WEEK, 0)] }).status).toBe("no_target");
  });
});
