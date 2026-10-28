import { beforeEach, describe, expect, it } from "vitest";
import { del, put } from "@/domain/changes";
import { settingRow } from "@/domain/settings";
import type { Block, Goal } from "@/domain/types";
import { createSqlJsDriver, type SqlJsDriver } from "./drivers/sqljsDriver";
import { SqliteRepository } from "./SqliteRepository";
import { SyncLocal } from "./syncLocal";

const goal = (id: string, extra: Partial<Goal> = {}): Goal => ({
  id,
  name: id,
  color: "#3b82f6",
  kind: "min",
  trackBy: "time",
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
  routineId: null,
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

let driver: SqlJsDriver;
let repo: SqliteRepository;
let sync: SyncLocal;

const keys = async () => (await sync.readOutbox()).map((e) => `${e.table}:${e.key}:${e.row ? "put" : "del"}`).sort();

beforeEach(async () => {
  driver = await createSqlJsDriver();
  repo = new SqliteRepository(driver);
  await repo.init();
  sync = new SyncLocal(driver);
});

describe("capture triggers", () => {
  it("records puts and deletes with the current row", async () => {
    await repo.applyChanges([put("goals", goal("g1")), put("blocks", block("b1", { goalId: "g1" }))]);
    expect(await keys()).toEqual(["blocks:b1:put", "goals:g1:put"]);
    const entries = await sync.readOutbox();
    expect(entries.find((e) => e.key === "b1")?.row).toMatchObject({ id: "b1", goalId: "g1" });
    await sync.markPushed(entries);
    await repo.applyChanges([del("blocks", "b1")]);
    expect(await keys()).toEqual(["blocks:b1:del"]);
  });

  it("captures cascades and SET NULL side effects", async () => {
    await repo.applyChanges([put("goals", goal("g1")), put("blocks", block("b1", { goalId: "g1" }))]);
    await sync.markPushed(await sync.readOutbox());
    await repo.applyChanges([del("goals", "g1")]);
    expect(await keys()).toEqual(["blocks:b1:put", "goals:g1:del"]);
    expect((await sync.readOutbox()).find((e) => e.key === "b1")?.row).toMatchObject({ goalId: null });
  });

  it("skips device-only settings", async () => {
    await repo.applyChanges([put("settings", settingRow("theme", "dark")), put("settings", settingRow("snapMinutes", 5))]);
    expect(await keys()).toEqual(["settings:snapMinutes:put"]);
  });

  it("captures week-start shifts as delete + put", async () => {
    await repo.applyChanges([put("weekNotes", { weekStart: "2026-10-19", text: "hi", updatedAt: 1 })]);
    await sync.markPushed(await sync.readOutbox());
    await repo.changeWeekStart(-1, 0);
    expect(await keys()).toEqual(["settings:weekStartDay:put", "weekNotes:2026-10-18:put", "weekNotes:2026-10-19:del"]);
  });

  it("keeps an entry that changed again after it was read", async () => {
    await repo.applyChanges([put("goals", goal("g1"))]);
    const read = await sync.readOutbox();
    await repo.applyChanges([put("goals", goal("g1", { name: "renamed" }))]);
    await sync.markPushed(read);
    expect((await sync.readOutbox())[0]?.row).toMatchObject({ name: "renamed" });
  });

  it("enqueueAll queues every synced row", async () => {
    await repo.applyChanges([put("goals", goal("g1")), put("settings", settingRow("theme", "dark"))]);
    await sync.clearOutbox();
    await sync.enqueueAll();
    expect(await keys()).toEqual(["goals:g1:put"]);
  });
});

describe("applyRemote", () => {
  it("applies pulled changes without echoing them", async () => {
    await sync.applyRemote([
      { table: "blocks", key: "b1", row: block("b1", { goalId: "g1" }) },
      { table: "goals", key: "g1", row: goal("g1") },
    ]);
    expect(await keys()).toEqual([]);
    expect((await repo.exportAll()).blocks).toHaveLength(1);
    await sync.applyRemote([{ table: "goals", key: "g1", row: null }]);
    expect(await keys()).toEqual([]);
    expect((await repo.exportAll()).blocks[0]?.goalId).toBeNull();
  });

  it("doesn't overwrite rows with unpushed local edits", async () => {
    await repo.applyChanges([put("goals", goal("g1", { name: "local" }))]);
    await sync.applyRemote([{ table: "goals", key: "g1", row: goal("g1", { name: "remote" }) }]);
    expect((await repo.exportAll()).goals[0]?.name).toBe("local");
    await sync.applyRemote([{ table: "goals", key: "g1", row: null }]);
    expect((await repo.exportAll()).goals).toHaveLength(1);
  });

  it("repairs references to parents that no longer exist", async () => {
    await sync.applyRemote([{ table: "blocks", key: "b1", row: block("b1", { goalId: "gone" }) }]);
    expect((await repo.exportAll()).blocks[0]?.goalId).toBeNull();
  });

  it("ignores unknown tables and device-only settings", async () => {
    await repo.applyChanges([put("settings", settingRow("theme", "dark"))]);
    const n = await sync.applyRemote([
      { table: "future_table", key: "x", row: {} },
      { table: "settings", key: "theme", row: settingRow("theme", "light") },
    ]);
    expect(n).toBe(0);
    expect((await repo.exportAll()).settings.find((s) => s.key === "theme")?.value).toBe('"dark"');
  });

  it("replace wipes synced data but keeps device-only settings", async () => {
    await repo.applyChanges([put("goals", goal("g1")), put("settings", settingRow("theme", "dark"))]);
    await sync.applyRemote([{ table: "goals", key: "g2", row: goal("g2") }], { replace: true });
    const data = await repo.exportAll();
    expect(data.goals.map((g) => g.id)).toEqual(["g2"]);
    expect(data.settings.map((s) => s.key)).toEqual(["theme"]);
    expect(await keys()).toEqual([]);
  });
});
