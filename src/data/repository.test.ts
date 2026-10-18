import { beforeEach, describe, expect, it } from "vitest";
import { del, put } from "@/domain/changes";
import { parseSettings } from "@/domain/settings";
import type { Block, ChecklistItem, ExportData, Goal } from "@/domain/types";
import { createSqlJsDriver, type SqlJsDriver } from "./drivers/sqljsDriver";
import { migrate, NewerDatabaseError, SCHEMA_VERSION, userVersion } from "./migrate";
import { SqliteRepository } from "./SqliteRepository";

const goal = (id: string, extra: Partial<Goal> = {}): Goal => ({
  id,
  name: id,
  color: "#3b82f6",
  kind: "min",
  sortOrder: 0,
  archivedOn: null,
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

const block = (id: string, extra: Partial<Block> = {}): Block => ({
  id,
  day: "2026-10-19",
  layer: "plan",
  startMinute: 540,
  endMinute: 660,
  title: id,
  goalId: null,
  notes: "",
  planBlockId: null,
  skipped: false,
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

const item = (id: string, goalId: string, weekStart: string, extra: Partial<ChecklistItem> = {}): ChecklistItem => ({
  id,
  goalId,
  weekStart,
  text: id,
  done: false,
  sortOrder: 0,
  carriedFromId: null,
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

let driver: SqlJsDriver;
let repo: SqliteRepository;
let backups: string[];

beforeEach(async () => {
  driver = await createSqlJsDriver();
  backups = [];
  repo = new SqliteRepository(driver, async (r) => backups.push(r));
  await repo.init();
});

describe("migrations", () => {
  it("migrating twice is a no-op", async () => {
    expect(await userVersion(driver)).toBe(SCHEMA_VERSION);
    expect(await migrate(driver)).toEqual({ from: SCHEMA_VERSION, to: SCHEMA_VERSION });
    expect(backups).toEqual([]);
  });

  it("refuses a newer database", async () => {
    await driver.execScript("PRAGMA user_version = 99;");
    await expect(migrate(driver)).rejects.toBeInstanceOf(NewerDatabaseError);
  });
});

describe("SqliteRepository", () => {
  it("round-trips entities through applyChanges / load", async () => {
    await repo.applyChanges([
      put("goals", goal("g1")),
      put("weekTargets", { goalId: "g1", weekStart: "2026-10-19", targetMinutes: 600, updatedAt: 1 }),
      put("blocks", block("p1", { goalId: "g1" })),
      put("blocks", block("a1", { layer: "actual", planBlockId: "p1", goalId: "g1" })),
      put("checklistItems", item("c1", "g1", "2026-10-19", { done: true })),
      put("weekNotes", { weekStart: "2026-10-19", text: "hi", updatedAt: 1 }),
    ]);
    const base = await repo.loadBase();
    expect(base.goals).toEqual([goal("g1")]);
    expect(base.weekTargets).toEqual([{ goalId: "g1", weekStart: "2026-10-19", targetMinutes: 600, updatedAt: 1 }]);
    const week = await repo.loadWeek("2026-10-19");
    expect(week.blocks.map((b) => b.id).sort()).toEqual(["a1", "p1"]);
    expect(week.blocks.find((b) => b.id === "a1")?.planBlockId).toBe("p1");
    expect(week.checklistItems[0]?.done).toBe(true);
    expect(week.weekNote?.text).toBe("hi");
  });

  it("upserts and deletes", async () => {
    await repo.applyChanges([put("blocks", block("b"))]);
    await repo.applyChanges([put("blocks", block("b", { title: "renamed", skipped: true }))]);
    let week = await repo.loadWeek("2026-10-19");
    expect(week.blocks).toHaveLength(1);
    expect(week.blocks[0]).toMatchObject({ title: "renamed", skipped: true });
    await repo.applyChanges([
      put("goals", goal("g")),
      put("weekTargets", { goalId: "g", weekStart: "2026-10-19", targetMinutes: null, updatedAt: 1 }),
    ]);
    await repo.applyChanges([del("blocks", "b"), del("weekTargets", "g|2026-10-19")]);
    week = await repo.loadWeek("2026-10-19");
    expect(week.blocks).toEqual([]);
    expect((await repo.loadBase()).weekTargets).toEqual([]);
  });

  it("a batch is atomic", async () => {
    await expect(
      repo.applyChanges([
        put("blocks", block("ok")),
        put("blocks", block("bad", { startMinute: 600, endMinute: 600 })), // CHECK end > start
      ]),
    ).rejects.toThrow();
    expect((await repo.loadWeek("2026-10-19")).blocks).toEqual([]);
  });

  it("a failed batch rolls back with the SQLite error and later batches still work", async () => {
    const bad = repo.applyChanges([
      put("blocks", block("ok")),
      put("blocks", block("bad", { startMinute: 600, endMinute: 600 })),
    ]);
    await expect(bad).rejects.toThrow(/CHECK constraint/);
    await repo.applyChanges([put("blocks", block("next"))]);
    expect((await repo.loadWeek("2026-10-19")).blocks.map((b) => b.id)).toEqual(["next"]);
  });

  it("rejects a dangling foreign key at commit", async () => {
    await expect(repo.applyChanges([put("blocks", block("b", { goalId: "missing" }))])).rejects.toThrow();
  });

  it("allows children before parents in one batch (deferred FKs)", async () => {
    await repo.applyChanges([
      put("blocks", block("a1", { layer: "actual", planBlockId: "p1" })),
      put("blocks", block("p1")),
    ]);
    expect((await repo.loadWeek("2026-10-19")).blocks).toHaveLength(2);
  });

  it("FK ON DELETE SET NULL / CASCADE", async () => {
    await repo.applyChanges([
      put("goals", goal("g1")),
      put("weekTargets", { goalId: "g1", weekStart: "2026-10-19", targetMinutes: 60, updatedAt: 1 }),
      put("checklistItems", item("c1", "g1", "2026-10-19")),
      put("blocks", block("p1", { goalId: "g1" })),
      put("blocks", block("a1", { layer: "actual", planBlockId: "p1" })),
    ]);
    await repo.applyChanges([del("blocks", "p1"), del("goals", "g1")]);
    const week = await repo.loadWeek("2026-10-19");
    expect(week.blocks).toEqual([expect.objectContaining({ id: "a1", planBlockId: null })]);
    expect(week.checklistItems).toEqual([]);
    expect((await repo.loadBase()).weekTargets).toEqual([]);
  });

  it("loadWeek returns 7 days and only that week's blocks", async () => {
    await repo.applyChanges([
      put("blocks", block("before", { day: "2026-10-18" })),
      put("blocks", block("mon", { day: "2026-10-19" })),
      put("blocks", block("sun", { day: "2026-10-25" })),
      put("blocks", block("after", { day: "2026-10-26" })),
    ]);
    const week = await repo.loadWeek("2026-10-19");
    expect(week.days).toHaveLength(7);
    expect(week.days[6]).toBe("2026-10-25");
    expect(week.blocks.map((b) => b.id)).toEqual(["mon", "sun"]);
  });

  it("changeWeekStart remaps week keys and saves the setting", async () => {
    await repo.applyChanges([
      put("goals", goal("g1")),
      put("weekTargets", { goalId: "g1", weekStart: "2026-10-12", targetMinutes: 60, updatedAt: 1 }),
      put("weekTargets", { goalId: "g1", weekStart: "2026-10-19", targetMinutes: 90, updatedAt: 1 }),
      put("checklistItems", item("c1", "g1", "2026-10-19")),
      put("weekNotes", { weekStart: "2026-10-19", text: "n", updatedAt: 1 }),
    ]);
    await repo.changeWeekStart(-1, 0); // Mon → Sun
    const base = await repo.loadBase();
    expect(base.weekTargets.map((t) => t.weekStart)).toEqual(["2026-10-11", "2026-10-18"]);
    expect(parseSettings(base.settings).weekStartDay).toBe(0);
    const week = await repo.loadWeek("2026-10-18");
    expect(week.checklistItems.map((c) => c.id)).toEqual(["c1"]);
    expect(week.weekNote?.text).toBe("n");
    await expect(repo.changeWeekStart(4, 1)).rejects.toThrow();
  });

  it("goalUsage counts references", async () => {
    await repo.applyChanges([
      put("goals", goal("g1")),
      put("blocks", block("b1", { goalId: "g1" })),
      put("blocks", block("b2", { goalId: "g1", layer: "actual" })),
      put("checklistItems", item("c1", "g1", "2026-10-19")),
    ]);
    expect(await repo.goalUsage("g1")).toEqual({ blocks: 2, checklistItems: 1 });
    expect(await repo.goalUsage("nope")).toEqual({ blocks: 0, checklistItems: 0 });
  });

  it("export → replaceAll round-trips", async () => {
    const data: ExportData = {
      settings: [{ key: "snapMinutes", value: "10" }],
      goals: [goal("g1"), goal("g2", { kind: "max", archivedOn: "2026-10-01" })],
      weekTargets: [{ goalId: "g1", weekStart: "2026-10-19", targetMinutes: 600, updatedAt: 2 }],
      checklistItems: [item("c1", "g1", "2026-10-19", { carriedFromId: "x" })],
      blocks: [block("p1", { goalId: "g1" }), block("a1", { layer: "actual", planBlockId: "p1" })],
      weekNotes: [{ weekStart: "2026-10-19", text: "reflection", updatedAt: 3 }],
    };
    await repo.applyChanges([put("blocks", block("stale"))]);
    await repo.replaceAll(data);
    const out = await repo.exportAll();
    const sortById = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));
    expect(out.settings).toEqual(data.settings);
    expect(sortById(out.goals)).toEqual(sortById(data.goals));
    expect(out.weekTargets).toEqual(data.weekTargets);
    expect(out.checklistItems).toEqual(data.checklistItems);
    expect(sortById(out.blocks)).toEqual(sortById(data.blocks));
    expect(out.weekNotes).toEqual(data.weekNotes);
  });

  it("rejects boolean params like the Rust driver", async () => {
    await expect(driver.select("SELECT ?", [true as never])).rejects.toThrow(/boolean/);
  });

  it("persists across a reopen from the exported image", async () => {
    await repo.applyChanges([put("blocks", block("keep"))]);
    const image = driver.export();
    const reopened = new SqliteRepository(await createSqlJsDriver({ data: image }));
    await reopened.init();
    expect((await reopened.loadWeek("2026-10-19")).blocks.map((b) => b.id)).toEqual(["keep"]);
    // Foreign keys are still enforced after export() reopened the DB.
    await expect(repo.applyChanges([put("blocks", block("b", { goalId: "missing" }))])).rejects.toThrow();
  });
});
