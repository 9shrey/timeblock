/**
 * Desktop sync against a real sync server (server/), started on a spare port with a
 * throwaway database. Builds the server first if needed.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { browser, $, expect } from "@wdio/globals";
import { gotoView, openSeeded } from "../helpers";

const root = resolve(import.meta.dirname, "../..");
const PORT = 18787;
const URL = `http://127.0.0.1:${PORT}`;
const USER = "e2e-user";
const PASSWORD = "e2e-password";

type Change = { table: string; key: string; row: Record<string, unknown> | null };

let server: ChildProcess | undefined;
let dbDir = "";
let token = "";

async function api<T>(path: string, body: unknown, auth = true): Promise<T> {
  const res = await fetch(URL + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

const serverChanges = async () => (await api<{ changes: Change[] }>("/api/sync", { since: 0, changes: [] })).changes;

const goal = (id: string, name: string) => ({
  table: "goals",
  key: id,
  row: { id, name, color: "#0ea5e9", kind: "min", trackBy: "time", sortOrder: 99, archivedOn: null, createdAt: 1, updatedAt: 1 },
});

async function mainText(): Promise<string> {
  return browser.execute(() => (document.querySelector("main")?.textContent ?? "").replace(/\s+/g, " "));
}

describe("Sync (native)", () => {
  before(async () => {
    const build = spawnSync("cargo", ["build", "--manifest-path", join(root, "server/Cargo.toml")], { stdio: "inherit" });
    if (build.status !== 0) throw new Error("couldn't build the sync server");
    dbDir = mkdtempSync(join(tmpdir(), "timeblock-sync-e2e-"));
    server = spawn(join(root, "server/target/debug/timeblock-sync"), [], {
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, TIMEBLOCK_DB: join(dbDir, "sync.db"), TIMEBLOCK_BIND: `127.0.0.1:${PORT}` },
    });
    await browser.waitUntil(async () => (await fetch(`${URL}/health`).catch(() => null))?.ok === true, { timeout: 10_000 });

    // The account already holds a goal from "another device".
    token = (await api<{ token: string }>("/api/signup", { username: USER, password: PASSWORD }, false)).token;
    await api("/api/sync", { since: 0, changes: [goal("from-server", "Goal from the web")] });
  });

  after(async () => {
    // Leave the app signed out for the specs that follow.
    if ((await $("button=Sign out").isExisting().catch(() => false)) === true) await $("button=Sign out").click();
    server?.kill();
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("signs in from Settings, merges, and syncs both ways", async () => {
    await openSeeded();
    await gotoView("Settings");
    await $("#sync-server").setValue(URL);
    await $("#sync-username").setValue(USER);
    await $("#sync-password").setValue(PASSWORD);
    await $("button=Sign in").click();

    // Both sides have data, so the app asks how to combine them.
    const merge = $("button*=Merge both");
    await browser.waitUntil(async () => (await merge.isDisplayed()) || (await $('[role="alert"]').isExisting()));
    if (!(await merge.isDisplayed())) throw new Error(`sign-in failed: ${await $('[role="alert"]').getText()}`);
    await merge.click();
    await $('[data-sync-status="synced"]').waitForExist();
    expect(await mainText()).toContain(`Signed in as ${USER} on ${URL}`);

    // Server → desktop.
    await gotoView("Goals");
    expect(await mainText()).toContain("Goal from the web");

    // Desktop → server: the demo data was uploaded.
    const names = (await serverChanges()).filter((c) => c.table === "goals").map((c) => c.row?.name);
    expect(names).toContain("Goal from the web");
    expect(names.length).toBeGreaterThan(1);

    // A later change on the server shows up after clicking the sync icon.
    await api("/api/sync", { since: 0, changes: [goal("later", "Added later on the phone")] });
    await $("[data-sync-status]").click();
    await browser.waitUntil(async () => (await mainText()).includes("Added later on the phone"), { timeout: 10_000 });

    // An edit on the desktop reaches the server on its own (auto-sync).
    await gotoView("Settings");
    await $('button[aria-label="Week starts on"]').click();
    await $('[role="option"]*=Sunday').click();
    await browser.waitUntil(
      async () => (await serverChanges()).some((c) => c.table === "settings" && JSON.stringify(c.row).includes("weekStart")),
      { timeout: 15_000, timeoutMsg: "week start change never reached the server" },
    );
  });

  it("keeps the desktop data after signing out", async () => {
    await gotoView("Settings");
    await $("button=Sign out").click();
    await $("#sync-username").waitForDisplayed();
    await expect($("[data-sync-status]")).not.toExist();
    await gotoView("Goals");
    expect(await mainText()).toContain("Goal from the web");
  });
});
