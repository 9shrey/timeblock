import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Goal } from "@/domain/types";
import { createFakeServer, type FakeServer } from "./fakeServer";

let server: FakeServer;

vi.mock("@/platform", () => ({ getPlatform: async () => ({ request: (url: string, init: RequestInit) => server.request(url, init) }) }));

const goal = (id: string, extra: Partial<Goal> = {}): Goal => ({
  id,
  name: id,
  color: "#3b82f6",
  kind: "min",
  trackBy: "time", activeDays: 127,
  sortOrder: 0,
  archivedOn: null,
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

const NOW = { day: "2026-10-21", minute: 840 };
const URL = "http://sync.test";

/** A separate app instance (own DB, store and engine), like a second device. */
async function device() {
  vi.resetModules();
  const { createSqlJsDriver } = await import("@/data/drivers/sqljsDriver");
  const { SqliteRepository } = await import("@/data/SqliteRepository");
  const { SyncLocal } = await import("@/data/syncLocal");
  const store = await import("@/state/store");
  const changes = await import("@/domain/changes");
  const engine = await import("./engine");
  const driver = await createSqlJsDriver();
  const repo = new SqliteRepository(driver);
  await repo.init();
  await store.initStore({ repo }, NOW);
  await engine.initSync(new SyncLocal(driver));
  const goals = () =>
    Object.values(store.useStore.getState().data.goals)
      .map((g) => g.name)
      .sort();
  const addGoal = async (g: Goal) => {
    store.commit([changes.put("goals", g)]);
    await store.flushWrites();
  };
  const removeGoal = async (id: string) => {
    store.commit([changes.del("goals", id)]);
    await store.flushWrites();
  };
  return { engine, store, repo, goals, addGoal, removeGoal };
}

beforeEach(() => {
  server = createFakeServer();
  vi.useFakeTimers({ toFake: ["setTimeout", "setInterval"] });
});

describe("sync engine", () => {
  it("syncs edits and deletes between two devices", async () => {
    const a = await device();
    await a.engine.signIn("signup", URL, "shrey", "password1");
    await a.addGoal(goal("g1", { name: "Deep work" }));
    await a.engine.syncNow();

    const b = await device();
    await b.engine.signIn("login", URL, "shrey", "password1");
    expect(b.goals()).toEqual(["Deep work"]);

    await b.addGoal(goal("g2", { name: "Exercise" }));
    await b.removeGoal("g1");
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect(a.goals()).toEqual(["Exercise"]);
    expect(a.engine.useSync.getState().status).toBe("synced");
  });

  it("keeps undo history when only its own changes come back", async () => {
    const a = await device();
    await a.engine.signIn("signup", URL, "shrey", "password1");
    await a.addGoal(goal("g1"));
    await a.engine.syncNow();
    expect(a.store.useStore.getState().history.undo).toHaveLength(1);
  });

  it("asks before mixing data when both sides have some", async () => {
    const a = await device();
    await a.engine.signIn("signup", URL, "shrey", "password1");
    await a.addGoal(goal("g1", { name: "Server goal" }));
    await a.engine.syncNow();

    const b = await device();
    await b.addGoal(goal("g2", { name: "Local goal" }));
    await b.engine.signIn("login", URL, "shrey", "password1");
    expect(b.engine.useSync.getState().needsChoice).toBe(true);
    await b.engine.resolveFirstSync("merge");
    expect(b.goals()).toEqual(["Local goal", "Server goal"]);
    await a.engine.syncNow();
    expect(a.goals()).toEqual(["Local goal", "Server goal"]);
  });

  it("'use server data' replaces this device; 'upload this device' replaces the server", async () => {
    const a = await device();
    await a.engine.signIn("signup", URL, "shrey", "password1");
    await a.addGoal(goal("g1", { name: "Server goal" }));
    await a.engine.syncNow();

    const b = await device();
    await b.addGoal(goal("g2", { name: "Local goal" }));
    await b.engine.signIn("login", URL, "shrey", "password1");
    await b.engine.resolveFirstSync("server");
    expect(b.goals()).toEqual(["Server goal"]);

    const c = await device();
    await c.addGoal(goal("g3", { name: "Laptop goal" }));
    await c.engine.signIn("login", URL, "shrey", "password1");
    await c.engine.resolveFirstSync("device");
    await a.engine.syncNow();
    expect(a.goals()).toEqual(["Laptop goal"]);
  });

  it("goes offline and recovers", async () => {
    const a = await device();
    await a.engine.signIn("signup", URL, "shrey", "password1");
    server.setDown(true);
    await a.addGoal(goal("g1"));
    await a.engine.syncNow();
    expect(a.engine.useSync.getState().status).toBe("offline");
    server.setDown(false);
    await a.engine.syncNow();
    expect(a.engine.useSync.getState().status).toBe("synced");
    expect(server.users.get("shrey")?.rows.size).toBeGreaterThan(0);
  });

  it("signs out on an invalid token, keeping local data", async () => {
    const a = await device();
    await a.engine.signIn("signup", URL, "shrey", "password1");
    await a.addGoal(goal("g1"));
    await a.engine.signOut();
    expect(a.engine.useSync.getState().status).toBe("off");
    expect(a.engine.isSignedIn()).toBe(false);
    expect(a.goals()).toEqual(["g1"]);
  });

  it("reports a wrong password", async () => {
    const a = await device();
    await a.engine.signIn("signup", URL, "shrey", "password1");
    const b = await device();
    await expect(b.engine.signIn("login", URL, "shrey", "nope")).rejects.toThrow("Wrong username or password.");
  });
});
