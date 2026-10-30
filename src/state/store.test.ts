import { beforeEach, describe, expect, it, vi } from "vitest";
import { put } from "@/domain/changes";
import { settingRow } from "@/domain/settings";
import type { Block } from "@/domain/types";
import { createSqlJsDriver } from "@/data/drivers/sqljsDriver";
import { SqliteRepository } from "@/data/SqliteRepository";
import { HISTORY_LIMIT } from "./history";
import { commit, ensureWeek, flushWrites, initStore, redo, sealHistory, undo, useStore } from "./store";

const block = (id: string, extra: Partial<Block> = {}): Block => ({
  id,
  day: "2026-10-21",
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

let repo: SqliteRepository;
const onWriteError = vi.fn();
const now = { day: "2026-10-21", minute: 840 };

beforeEach(async () => {
  repo = new SqliteRepository(await createSqlJsDriver());
  await repo.init();
  onWriteError.mockReset();
  await initStore({ repo, onWriteError }, now);
});

const blocks = () => useStore.getState().data.blocks;
const dbBlocks = async () => (await repo.loadWeek("2026-10-19")).blocks;

describe("store", () => {
  it("loads the current week and its neighbours", () => {
    const s = useStore.getState();
    expect(s.ready).toBe(true);
    expect(s.cursor).toBe("2026-10-21");
    expect([...s.loadedWeeks].sort()).toEqual(["2026-10-12", "2026-10-19", "2026-10-26"]);
  });

  it("commits optimistically and persists", async () => {
    commit([put("blocks", block("a"))]);
    expect(blocks().a?.title).toBe("a");
    await flushWrites();
    expect((await dbBlocks()).map((b) => b.id)).toEqual(["a"]);
  });

  it("undo and redo restore exactly, in memory and in the DB", async () => {
    commit([put("blocks", block("a"))]);
    commit([put("blocks", block("a", { title: "renamed" })), put("blocks", block("b"))]);
    const after = blocks();
    expect(undo()).toBe("Edit");
    expect(blocks()).toEqual({ a: block("a") });
    await flushWrites();
    expect(await dbBlocks()).toEqual([block("a")]);
    redo();
    expect(blocks()).toEqual(after);
    undo();
    undo();
    expect(blocks()).toEqual({});
    expect(undo()).toBeNull();
    await flushWrites();
    expect(await dbBlocks()).toEqual([]);
  });

  it("a new commit clears redo", () => {
    commit([put("blocks", block("a"))]);
    undo();
    commit([put("blocks", block("b"))]);
    expect(redo()).toBeNull();
  });

  it("coalesces commits with the same key into one undo step", () => {
    commit([put("blocks", block("a"))], { label: "Create" });
    commit([put("blocks", block("a", { title: "x" }))], { coalesceKey: "edit:a" });
    commit([put("blocks", block("a", { title: "xy" }))], { coalesceKey: "edit:a" });
    commit([put("blocks", block("a", { title: "xyz", notes: "n" }))], { coalesceKey: "edit:a" });
    expect(useStore.getState().history.undo).toHaveLength(2);
    undo();
    expect(blocks().a).toEqual(block("a"));
    redo();
    expect(blocks().a?.title).toBe("xyz");
    sealHistory();
    commit([put("blocks", block("a", { title: "new session" }))], { coalesceKey: "edit:a" });
    expect(useStore.getState().history.undo).toHaveLength(3);
  });

  it("caps history", () => {
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) commit([put("blocks", block("a", { title: String(i) }))]);
    expect(useStore.getState().history.undo).toHaveLength(HISTORY_LIMIT);
  });

  it("updates parsed settings on commit", () => {
    commit([put("settings", settingRow("snapMinutes", 30))], { noHistory: true });
    expect(useStore.getState().settings.snapMinutes).toBe(30);
    expect(useStore.getState().history.undo).toHaveLength(0);
  });

  it("a failed write reloads from the DB and clears history", async () => {
    commit([put("blocks", block("ok"))]);
    commit([put("blocks", block("bad", { goalId: "missing-goal" }))]);
    expect(blocks().bad).toBeDefined();
    await flushWrites();
    await vi.waitFor(() => expect(onWriteError).toHaveBeenCalledOnce());
    expect(Object.keys(blocks())).toEqual(["ok"]);
    expect(useStore.getState().history.undo).toHaveLength(0);
  });

  it("drops writes queued behind a failed one", async () => {
    commit([put("blocks", block("bad", { goalId: "missing-goal" }))]);
    commit([put("blocks", block("after"))]);
    await flushWrites();
    await vi.waitFor(() => expect(onWriteError).toHaveBeenCalledOnce());
    expect(await dbBlocks()).toEqual([]);
    expect(blocks()).toEqual({});
    // Writes made after the failure are saved normally.
    commit([put("blocks", block("later"))]);
    await flushWrites();
    expect((await dbBlocks()).map((b) => b.id)).toEqual(["later"]);
  });

  it("a failed week load is retried by the next call", async () => {
    const loadWeek = vi.spyOn(repo, "loadWeek").mockRejectedValueOnce(new Error("disk"));
    await expect(ensureWeek("2026-11-02")).rejects.toThrow("disk");
    expect(useStore.getState().loadedWeeks).not.toContain("2026-11-02");
    await ensureWeek("2026-11-02");
    expect(useStore.getState().loadedWeeks).toContain("2026-11-02");
    expect(loadWeek).toHaveBeenCalledTimes(2);
  });

  it("concurrent ensureWeek calls share one read", async () => {
    const loadWeek = vi.spyOn(repo, "loadWeek");
    await Promise.all([ensureWeek("2026-11-02"), ensureWeek("2026-11-02")]);
    expect(loadWeek).toHaveBeenCalledOnce();
  });

  it("ensureWeek loads a week once and keeps in-memory rows", async () => {
    await repo.applyChanges([put("blocks", block("far", { day: "2026-11-04" }))]);
    await ensureWeek("2026-11-02");
    expect(blocks().far).toBeDefined();
    commit([put("blocks", block("far", { day: "2026-11-04", title: "edited" }))]);
    await ensureWeek("2026-11-02");
    expect(blocks().far?.title).toBe("edited");
  });
});

describe("bulk changes", () => {
  it("changeWeekStartDay remaps keys, reloads and clears history", async () => {
    const { changeWeekStartDay } = await import("./store");
    commit([
      put("goals", { id: "g", name: "G", color: "#000000", kind: "min", trackBy: "time", activeDays: 127, sortOrder: 0, archivedOn: null, createdAt: 1, updatedAt: 1 }),
      put("weekTargets", { goalId: "g", weekStart: "2026-10-19", targetMinutes: 60, targetCount: null, updatedAt: 1 }),
    ]);
    await changeWeekStartDay(0);
    const s = useStore.getState();
    expect(s.settings.weekStartDay).toBe(0);
    expect(Object.keys(s.data.weekTargets)).toEqual(["g|2026-10-18"]);
    expect(s.history.undo).toHaveLength(0);
    expect(s.loadedWeeks).toContain("2026-10-18");
  });
});
