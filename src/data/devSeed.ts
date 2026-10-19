/**
 * Deterministic demo data for development (`?seed=demo`): the previous and current week
 * relative to `now`, with goals Thesis ≥15h, Exercise ≥5h, Social ≤3h and every plan
 * state (done, adjusted, skipped, unconfirmed, pending) represented.
 */
import { addDays, weekDays, weekStartOf } from "@/domain/time/localDate";
import type { Block, ChecklistItem, ExportData, Goal, LocalDate, Now, WeekTarget } from "@/domain/types";

const T0 = 1_760_000_000_000;
const h = (hours: number) => Math.round(hours * 60);

export function demoSeed(now: Now): ExportData {
  let n = 0;
  const id = (p: string) => `seed-${p}-${++n}`;

  const goal = (key: string, name: string, color: string, kind: Goal["kind"], sortOrder: number): Goal => ({
    id: `seed-goal-${key}`,
    name,
    color,
    kind,
    sortOrder,
    archivedOn: null,
    createdAt: T0,
    updatedAt: T0,
  });
  const thesis = goal("thesis", "Thesis", "#2563eb", "min", 0);
  const exercise = goal("exercise", "Exercise", "#059669", "min", 1);
  const social = goal("social", "Social", "#e11d48", "max", 2);

  const thisWeek = weekStartOf(now.day, 1);
  const lastWeek = addDays(thisWeek, -7);

  const targets: WeekTarget[] = [
    { goalId: thesis.id, weekStart: lastWeek, targetMinutes: h(15), updatedAt: T0 },
    { goalId: exercise.id, weekStart: lastWeek, targetMinutes: h(5), updatedAt: T0 },
    { goalId: social.id, weekStart: lastWeek, targetMinutes: h(3), updatedAt: T0 },
  ];

  const blocks: Block[] = [];
  const plan = (day: LocalDate, start: number, end: number, g: Goal | null, title: string): Block => {
    const b: Block = {
      id: id("p"),
      day,
      layer: "plan",
      startMinute: start,
      endMinute: end,
      title,
      goalId: g?.id ?? null,
      notes: "",
      planBlockId: null,
      skipped: false,
      routineId: null,
      createdAt: T0,
      updatedAt: T0,
    };
    blocks.push(b);
    return b;
  };
  const actual = (p: Block | null, patch: Partial<Block> & { day?: LocalDate } = {}): Block => {
    const b: Block = {
      id: id("a"),
      day: p?.day ?? patch.day!,
      layer: "actual",
      startMinute: p?.startMinute ?? 0,
      endMinute: p?.endMinute ?? 60,
      title: p?.title ?? "",
      goalId: p?.goalId ?? null,
      notes: "",
      planBlockId: p?.id ?? null,
      skipped: false,
      routineId: null,
      createdAt: T0,
      updatedAt: T0,
      ...patch,
    };
    blocks.push(b);
    return b;
  };
  const skip = (p: Block) => {
    p.skipped = true;
  };

  /** A typical weekday plan. Returns the plan blocks by role. */
  const weekday = (day: LocalDate, i: number) => ({
    gym: i % 2 === 0 ? plan(day, h(7), h(8), exercise, "Gym") : null,
    deep1: plan(day, h(9), h(11), thesis, "Thesis: writing"),
    lunch: plan(day, h(12), h(13), null, "Lunch"),
    deep2: plan(day, h(14), h(16), thesis, "Thesis: experiments"),
    social: i === 4 ? plan(day, h(19), h(22), social, "Dinner with friends") : null,
  });

  // Last week (past): Thesis met, Exercise missed, Social over.
  weekDays(lastWeek).forEach((day, i) => {
    if (i < 5) {
      const p = weekday(day, i);
      if (p.gym && i === 2) skip(p.gym);
      else if (p.gym) actual(p.gym, i === 4 ? { endMinute: h(7.5) } : {});
      actual(p.deep1, i === 1 ? { startMinute: h(9.25) } : {});
      actual(p.lunch);
      actual(p.deep2, i === 3 ? { endMinute: h(17) } : {});
      if (p.social) actual(p.social, { endMinute: h(23) });
    } else if (i === 5) {
      const run = plan(day, h(10), h(11), exercise, "Long run");
      actual(run, { endMinute: h(11.5) });
      actual(null, { day, startMinute: h(18), endMinute: h(20), title: "Board games", goalId: social.id });
      actual(null, { day, startMinute: h(13), endMinute: h(16), title: "Thesis catch-up", goalId: thesis.id });
    }
  });

  // This week: past days corrected (one left unconfirmed), today partly done, future planned.
  const yesterday = addDays(now.day, -1);
  weekDays(thisWeek).forEach((day, i) => {
    if (i >= 5) {
      if (i === 5) {
        plan(day, h(10), h(12), exercise, "Long run");
        plan(day, h(18), h(20), social, "Party");
      }
      return;
    }
    const p = weekday(day, i);
    if (day < now.day) {
      if (p.gym) actual(p.gym);
      actual(p.deep1, i === 0 ? { endMinute: h(10.5) } : {}); // adjusted
      actual(p.lunch);
      if (day === yesterday) {
        // deep2 left unconfirmed; an unplanned call instead
        actual(null, { day, startMinute: h(16.5), endMinute: h(17.5), title: "Call with advisor", goalId: thesis.id });
      } else {
        skip(p.deep2);
      }
    } else if (day === now.day) {
      if (p.gym) actual(p.gym); // done; 9–11 stays an unconfirmed ghost for the confirm demo
    }
  });

  const item = (g: Goal, week: LocalDate, text: string, done: boolean, sortOrder: number): ChecklistItem => ({
    id: id("c"),
    goalId: g.id,
    weekStart: week,
    text,
    done,
    sortOrder,
    carriedFromId: null,
    createdAt: T0,
    updatedAt: T0,
  });
  const checklistItems = [
    item(thesis, lastWeek, "Draft chapter 3 outline", true, 0),
    item(thesis, lastWeek, "Run baseline experiments", false, 1),
    item(exercise, lastWeek, "Three gym sessions", false, 0),
    item(thesis, thisWeek, "Write related-work section", false, 0),
    item(thesis, thisWeek, "Send draft to advisor", false, 1),
    item(exercise, thisWeek, "Long run on Saturday", false, 0),
  ];

  return {
    settings: [],
    goals: [thesis, exercise, social],
    weekTargets: targets,
    checklistItems,
    templates: [],
    routines: [],
    blocks,
    weekNotes: [{ weekStart: lastWeek, text: "Good focus week; gym slipped midweek.", updatedAt: T0 }],
  };
}

export const EMPTY_DATA: ExportData = {
  settings: [],
  goals: [],
  weekTargets: [],
  checklistItems: [],
  templates: [],
  routines: [],
  blocks: [],
  weekNotes: [],
};
