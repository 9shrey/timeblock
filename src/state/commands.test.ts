// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const toastFn = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastFn }));

const platform = vi.hoisted(() => ({
  backupNow: vi.fn(async () => "/backups/pre-import.sqlite3"),
  openTextFile: vi.fn(),
  saveTextFile: vi.fn(async (name: string, _contents: string) => `/exports/${name}`),
  appVersion: async () => "test",
}));
vi.mock("@/platform", () => ({ getPlatform: async () => platform }));

import { put } from "@/domain/changes";
import { serializeExport, toExportFile } from "@/domain/export/format";
import type { Block, Goal } from "@/domain/types";
import { demoSeed } from "@/data/devSeed";
import { createSqlJsDriver } from "@/data/drivers/sqljsDriver";
import { SqliteRepository } from "@/data/SqliteRepository";
import { handleKey } from "@/app/shortcuts";
import {
  canEditLane,
  confirm,
  confirmRestOfDay,
  copyWeekPlan,
  createBlockAt,
  materialize,
  moveBlockTo,
  removeBlock,
  select,
  updateBlockFields,
} from "./commands";
import { applyImport, exportJson, pickImportFile } from "./dataCommands";
import {
  addChecklistItem,
  carryOverItems,
  createGoal,
  deleteGoal,
  editChecklistItem,
  moveGoal,
  setTarget,
  setWeekNote,
  toggleChecklistItem,
} from "./goalCommands";
import { goalList } from "./selectors";
import { commit, flushWrites, initStore, sealHistory, useStore } from "./store";
import { unlockPlanDay, useUi } from "./ui";

const now = { day: "2026-10-21", minute: 840 }; // Wed 14:00
let repo: SqliteRepository;

beforeEach(async () => {
  vi.clearAllMocks();
  repo = new SqliteRepository(await createSqlJsDriver());
  await repo.init();
  await repo.replaceAll(demoSeed(now));
  useUi.setState({ editing: null, unlockedPlanDays: [], menu: null });
  await initStore({ repo }, now);
});

const blocks = () => Object.values(useStore.getState().data.blocks);
const onDay = (day: string, layer: "plan" | "actual") => blocks().filter((b) => b.day === day && b.layer === layer);
const find = (day: string, layer: "plan" | "actual", start: number): Block =>
  onDay(day, layer).find((b) => b.startMinute === start)!;
const history = () => useStore.getState().history.undo;

describe("lane rules", () => {
  it("past plan lanes are locked until unlocked; future actual lanes are read-only", () => {
    expect(canEditLane("2026-10-20", "plan")).toBe(false);
    expect(canEditLane("2026-10-20", "actual")).toBe(true);
    expect(canEditLane("2026-10-22", "actual")).toBe(false);
    expect(canEditLane("2026-10-22", "plan")).toBe(true);

    expect(createBlockAt("2026-10-20", "plan", 1080, 1140)).toBeNull();
    expect(toastFn).toHaveBeenCalledWith(expect.stringContaining("locked"));
    unlockPlanDay("2026-10-20");
    expect(createBlockAt("2026-10-20", "plan", 1080, 1140, false)).not.toBeNull();
  });

  it("refuses to log time on a future day", () => {
    expect(createBlockAt("2026-10-22", "actual", 600, 660)).toBeNull();
    expect(toastFn).toHaveBeenCalledWith(expect.stringContaining("future"));
  });

  it("refuses to move a block into or out of a locked lane", () => {
    const thu = find("2026-10-22", "plan", 540);
    moveBlockTo(thu.id, "2026-10-20", 540, 660, false);
    expect(useStore.getState().data.blocks[thu.id]!.day).toBe("2026-10-22");
    const mon = find("2026-10-19", "plan", 720);
    moveBlockTo(mon.id, "2026-10-22", 720, 780, false);
    expect(useStore.getState().data.blocks[mon.id]!.day).toBe("2026-10-19");
    // Copying out of a locked lane is fine (the original is untouched).
    moveBlockTo(mon.id, "2026-10-22", 720, 780, true);
    expect(onDay("2026-10-22", "plan").filter((b) => b.title === "Lunch")).toHaveLength(2);
  });
});

describe("block commands", () => {
  it("creating selects the block and opens the editor", () => {
    const id = createBlockAt("2026-10-21", "plan", 1080, 1140)!;
    expect(useStore.getState().selection).toEqual({ kind: "block", id });
    expect(useUi.getState().editing).toMatchObject({ ref: { kind: "block", id }, isNew: true });
  });

  it("no-op edits don't add undo steps", () => {
    const b = find("2026-10-21", "plan", 840);
    const n = history().length;
    expect(updateBlockFields(b.id, { title: b.title, startMinute: b.startMinute })).toBe(true);
    expect(history()).toHaveLength(n);
  });

  it("validation stops archived goals on new blocks and keeps the store untouched", () => {
    const goal: Goal = { ...useStore.getState().data.goals["seed-goal-social"]!, archivedOn: "2026-10-19" };
    commit([put("goals", goal)]);
    const b = find("2026-10-21", "plan", 840);
    const before = useStore.getState().data.blocks;
    expect(updateBlockFields(b.id, { goalId: goal.id })).toBe(false);
    expect(toastFn.error).toHaveBeenCalledWith(expect.stringMatching(/archived/i));
    expect(useStore.getState().data.blocks).toBe(before);
  });

  it("materialize creates a linked actual and selects it; confirm on a covered ghost skips it", () => {
    const plan = find("2026-10-21", "plan", 540);
    const id = materialize(plan.id, { startMinute: 555, endMinute: 660 })!;
    expect(useStore.getState().data.blocks[id]).toMatchObject({ layer: "actual", planBlockId: plan.id, startMinute: 555 });
    expect(useStore.getState().selection).toEqual({ kind: "block", id });

    const lunch = find("2026-10-21", "plan", 720);
    createBlockAt("2026-10-21", "actual", 700, 800, false);
    confirm(lunch.id);
    expect(useStore.getState().data.blocks[lunch.id]!.skipped).toBe(true);
  });

  it("confirm rest of day says so when there is nothing to confirm", () => {
    confirmRestOfDay("2026-10-21");
    confirmRestOfDay("2026-10-21");
    expect(toastFn).toHaveBeenCalledWith("Nothing left to confirm.");
  });

  it("deleting the selected block clears selection and closes its editor", () => {
    const id = createBlockAt("2026-10-21", "plan", 1080, 1140)!;
    removeBlock(id);
    expect(useStore.getState().data.blocks[id]).toBeUndefined();
    expect(useStore.getState().selection).toBeNull();
    expect(useUi.getState().editing).toBeNull();
  });
});

describe("copyWeekPlan", () => {
  const lastWeek = "2026-10-12";
  const thisWeek = "2026-10-19";

  it("skips past target days (even if unlocked) and clears goals archived as of the target week", () => {
    // Monday/Tuesday of this week are in the past relative to `now` (Wed 2026-10-21).
    unlockPlanDay("2026-10-19");
    // Archive the Social goal before copying: a copied block referencing it must drop the link.
    const social = useStore.getState().data.goals["seed-goal-social"]!;
    commit([put("goals", { ...social, archivedOn: thisWeek })]);

    const before = new Set(Object.keys(useStore.getState().data.blocks));
    copyWeekPlan(lastWeek, thisWeek);
    const added = Object.values(useStore.getState().data.blocks).filter((b) => !before.has(b.id));

    expect(added.length).toBeGreaterThan(0);
    expect(added.every((b) => b.layer === "plan")).toBe(true);
    // Last week's Friday (2026-10-16) has a Social block; this week's Friday is 2026-10-23.
    expect(added.some((b) => b.day === "2026-10-19")).toBe(false);
    expect(added.some((b) => b.day === "2026-10-20")).toBe(false);
    const friday = added.find((b) => b.day === "2026-10-23" && b.title === "Dinner with friends");
    expect(friday).toBeDefined();
    expect(friday!.goalId).toBeNull();
  });

  it("says so when there are no eligible target days", () => {
    unlockPlanDay("2026-10-19");
    unlockPlanDay("2026-10-20");
    copyWeekPlan(lastWeek, "2026-10-05"); // every day of that week is in the past
    expect(toastFn).toHaveBeenCalledWith("No unlocked, upcoming days to copy into.");
  });

  it("is a single undo step", () => {
    const n = history().length;
    copyWeekPlan(lastWeek, thisWeek);
    expect(history()).toHaveLength(n + 1);
  });
});

describe("goal commands", () => {
  it("rejects empty names and out-of-range targets", () => {
    expect(createGoal({ name: "  ", color: "#000000", kind: "min", targetMinutes: null }, "2026-10-19")).toBeNull();
    const n = history().length;
    setTarget("seed-goal-thesis", "2026-10-19", 20_000);
    expect(history()).toHaveLength(n);
    expect(toastFn.error).toHaveBeenCalled();
  });

  it("deletes a goal only when nothing in any week uses it", async () => {
    const thesis = useStore.getState().data.goals["seed-goal-thesis"]!;
    expect(await deleteGoal(thesis)).toBe(false);
    const g = createGoal({ name: "Unused", color: "#000000", kind: "min", targetMinutes: 60 }, "2026-10-19")!;
    expect(await deleteGoal(g)).toBe(true);
    expect(useStore.getState().data.goals[g.id]).toBeUndefined();
    expect(Object.keys(useStore.getState().data.weekTargets).some((k) => k.startsWith(g.id))).toBe(false);
  });

  it("knows about usage in weeks that aren't loaded", async () => {
    const g = createGoal({ name: "Old", color: "#000000", kind: "min", targetMinutes: null }, "2026-10-19")!;
    await flushWrites();
    await repo.applyChanges([put("blocks", { ...find("2026-10-21", "plan", 540), id: "far", day: "2026-06-01", goalId: g.id })]);
    expect(await deleteGoal(g)).toBe(false);
  });
});

describe("outcomes, ordering and notes", () => {
  const items = (week: string) =>
    Object.values(useStore.getState().data.checklistItems).filter((c) => c.weekStart === week && c.goalId === "seed-goal-thesis");

  it("adds, ticks, edits and deletes-by-clearing an outcome; carry-over is idempotent", () => {
    const before = items("2026-10-19").length;
    addChecklistItem("seed-goal-thesis", "2026-10-19", "   ");
    expect(items("2026-10-19")).toHaveLength(before);
    addChecklistItem("seed-goal-thesis", "2026-10-19", "  Draft chapter 3 ");
    const added = items("2026-10-19").find((c) => c.text === "Draft chapter 3")!;
    toggleChecklistItem(added);
    expect(useStore.getState().data.checklistItems[added.id]!.done).toBe(true);
    toggleChecklistItem(useStore.getState().data.checklistItems[added.id]!);
    editChecklistItem(useStore.getState().data.checklistItems[added.id]!, "Draft chapter 4");
    expect(useStore.getState().data.checklistItems[added.id]!.text).toBe("Draft chapter 4");

    const open = items("2026-10-19").filter((c) => !c.done).length;
    expect(carryOverItems("2026-10-19", "2026-10-26", "seed-goal-thesis")).toBeGreaterThan(0);
    expect(items("2026-10-26").length).toBeGreaterThanOrEqual(open);
    expect(carryOverItems("2026-10-19", "2026-10-26", "seed-goal-thesis")).toBe(0);

    editChecklistItem(useStore.getState().data.checklistItems[added.id]!, "  ");
    expect(useStore.getState().data.checklistItems[added.id]).toBeUndefined();
  });

  it("moves goals up and down, stopping at the ends", () => {
    const names = () => goalList(useStore.getState().data.goals).map((g) => g.name);
    const first = names();
    const second = goalList(useStore.getState().data.goals)[1]!;
    moveGoal(second, -1);
    expect(names()).toEqual([first[1], first[0], ...first.slice(2)]);
    const n = history().length;
    moveGoal(goalList(useStore.getState().data.goals)[0]!, -1);
    expect(history()).toHaveLength(n);
  });

  it("typing a reflection is one undo step until sealed", () => {
    const n = history().length;
    setWeekNote("2026-10-19", "W", "note:2026-10-19");
    setWeekNote("2026-10-19", "Went", "note:2026-10-19");
    setWeekNote("2026-10-19", "Went well", "note:2026-10-19");
    expect(history()).toHaveLength(n + 1);
    sealHistory();
    setWeekNote("2026-10-19", "Went well!", "note:2026-10-19");
    expect(history()).toHaveLength(n + 2);
  });
});

describe("keyboard shortcuts", () => {
  const press = (key: string, extra: Partial<KeyboardEventInit> = {}, target?: Element) => {
    const e = new KeyboardEvent("keydown", { key, ...extra });
    if (target) Object.defineProperty(e, "target", { value: target });
    return handleKey(e);
  };

  it("digits set the selected block's goal; Delete on a ghost skips its plan", () => {
    const b = find("2026-10-21", "plan", 840);
    select({ kind: "block", id: b.id });
    expect(press("2")).toBe(true);
    expect(useStore.getState().data.blocks[b.id]!.goalId).toBe("seed-goal-exercise");

    const lunch = find("2026-10-21", "plan", 720);
    select({ kind: "ghost", planBlockId: lunch.id });
    press("Delete");
    expect(useStore.getState().data.blocks[lunch.id]!.skipped).toBe(true);
  });

  it("arrows nudge and Shift+arrows resize by the snap step", () => {
    const b = find("2026-10-21", "plan", 840);
    select({ kind: "block", id: b.id });
    press("ArrowDown");
    expect(useStore.getState().data.blocks[b.id]).toMatchObject({ startMinute: 855, endMinute: 975 });
    press("ArrowUp", { shiftKey: true });
    expect(useStore.getState().data.blocks[b.id]).toMatchObject({ startMinute: 855, endMinute: 960 });
  });

  it("Shift+A confirms the rest of the day only in Day view", () => {
    useStore.setState({ view: "goals" });
    expect(press("A", { shiftKey: true })).toBe(false);
    useStore.setState({ view: "day" });
    expect(press("A", { shiftKey: true })).toBe(true);
    expect(onDay("2026-10-21", "actual").length).toBeGreaterThan(1);
  });

  it("Enter on some other focused button keeps its own meaning", () => {
    select({ kind: "block", id: find("2026-10-21", "plan", 840).id });
    const button = document.createElement("button");
    expect(press("Enter", {}, button)).toBe(false);
    expect(useUi.getState().editing).toBeNull();
    expect(press("Enter")).toBe(true);
    expect(useUi.getState().editing?.focus).toBe(true);
  });

  it("view keys, today and week navigation", () => {
    press("w");
    expect(useStore.getState().view).toBe("week");
    press("]");
    expect(useStore.getState().cursor).toBe("2026-10-28");
    press("t");
    expect(useStore.getState().cursor).toBe("2026-10-21");
  });
});

describe("import", () => {
  it("an invalid file reports errors and changes nothing", async () => {
    platform.openTextFile.mockResolvedValueOnce({ path: "bad.json", contents: '{"format":"nope"}' });
    const picked = await pickImportFile();
    expect(picked?.result.ok).toBe(false);
    expect(Object.keys(useStore.getState().data.goals)).toHaveLength(3);
  });

  it("an export imports back to the same data", async () => {
    await exportJson();
    const contents = platform.saveTextFile.mock.calls[0]![1];
    expect(platform.saveTextFile.mock.calls[0]![0]).toMatch(/2026-10-21/);
    platform.openTextFile.mockResolvedValueOnce({ path: "round.json", contents });
    const picked = await pickImportFile();
    expect(picked?.result.ok).toBe(true);
    if (!picked?.result.ok) return;
    // exportAll has no ORDER BY, so compare each table as a set of rows.
    const sorted = async () =>
      Object.fromEntries(
        Object.entries(await repo.exportAll()).map(([t, rows]: [string, unknown[]]) => [t, rows.map((r) => JSON.stringify(r)).sort()]),
      );
    const before = await sorted();
    expect(await applyImport(picked.result.data)).toBe(true);
    expect(await sorted()).toEqual(before);
  });

  it("a valid file replaces everything after a pre-import backup", async () => {
    const file = toExportFile(
      { ...demoSeed(now), goals: [demoSeed(now).goals[0]!], blocks: [], checklistItems: [], weekTargets: [], weekNotes: [] },
      { appVersion: "test", exportedAt: 0 },
    );
    platform.openTextFile.mockResolvedValueOnce({ path: "ok.json", contents: serializeExport(file) });
    const picked = await pickImportFile();
    expect(picked?.result.ok).toBe(true);
    if (!picked?.result.ok) return;
    expect(await applyImport(picked.result.data)).toBe(true);
    expect(platform.backupNow).toHaveBeenCalledWith("pre-import");
    expect(Object.keys(useStore.getState().data.goals)).toEqual(["seed-goal-thesis"]);
    expect(blocks()).toHaveLength(0);
    expect(history()).toHaveLength(0);
    expect((await repo.exportAll()).goals).toHaveLength(1);
  });
});
