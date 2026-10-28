/**
 * Sync engine: signs in, pushes the outbox, pulls what other devices changed, and keeps
 * doing that in the background (on start, focus, shortly after edits, and every minute).
 * Conflicts resolve as "last push wins" per row; unpushed local edits are never overwritten.
 */
import { create } from "zustand";
import type { SyncChange, SyncLocal } from "@/data/syncLocal";
import { systemEnv } from "@/domain/env";
import { getPlatform } from "@/platform";
import { flushWrites, reloadFromDb, useStore } from "@/state/store";
import { api, ApiError, normalizeServer } from "./api";

export type SyncStatus = "off" | "synced" | "syncing" | "offline" | "error";

/** First sign-in on a device with data, to an account that has data too. */
export type FirstSyncChoice = "merge" | "server" | "device";

export interface SyncState {
  status: SyncStatus;
  /** Signed-in username, or null. */
  username: string | null;
  server: string;
  /** Epoch ms of the last successful sync. */
  lastSyncedAt: number | null;
  error: string | null;
  /** Set while a first-sync choice is waiting for the user. */
  needsChoice: boolean;
}

/** Build-time default server (the web app build always sets it). */
export const DEFAULT_SERVER = normalizeServer(import.meta.env.VITE_SYNC_URL ?? "");

export const useSync = create<SyncState>(() => ({
  status: "off",
  username: null,
  server: DEFAULT_SERVER,
  lastSyncedAt: null,
  error: null,
  needsChoice: false,
}));

const set = useSync.setState;

const DEBOUNCE_MS = 3000;
const INTERVAL_MS = 60_000;
const PAGE = 2000;

let local: SyncLocal | null = null;
let token: string | null = null;
/** Changes pulled during sign-in, held until the user makes the first-sync choice. */
let pendingFirst: { changes: SyncChange[]; seq: number } | null = null;
let running: Promise<void> | null = null;
let again = false;
let debounce: ReturnType<typeof setTimeout> | null = null;
let applyingRemote = false;
let started = false;

function requireLocal(): SyncLocal {
  if (!local) throw new Error("Sync used before initSync()");
  return local;
}

function deviceName(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Device";
  const kind = "__TAURI_INTERNALS__" in globalThis ? "desktop app" : "browser";
  return `${os} ${kind}`;
}

/** Loads saved sign-in state and starts background sync if signed in. */
export async function initSync(syncLocal: SyncLocal): Promise<void> {
  local = syncLocal;
  const [savedToken, username, server, lastSynced] = await Promise.all([
    local.getMeta("token"),
    local.getMeta("username"),
    local.getMeta("server"),
    local.getMeta("lastSyncedAt"),
  ]);
  token = savedToken;
  set({
    username: token ? username : null,
    server: server ?? DEFAULT_SERVER,
    lastSyncedAt: lastSynced ? Number(lastSynced) : null,
    status: token ? "synced" : "off",
  });
  if (!token) return;
  if ((await local.getMeta("firstSync")) === "1") {
    // The app closed while the first-sync choice was open; ask again.
    set({ status: "syncing" });
    pullAll(useSync.getState().server, token).then(
      (pulled) => {
        pendingFirst = pulled;
        set({ needsChoice: true });
      },
      (e: unknown) => fail(e),
    );
    return;
  }
  startBackground();
}

export function isSignedIn(): boolean {
  return token !== null;
}

/**
 * Signs in (or creates an account) and runs the first sync. If both this device and the
 * account already have data, stops with `needsChoice` set; call `resolveFirstSync`.
 */
export async function signIn(mode: "login" | "signup", server: string, username: string, password: string): Promise<void> {
  const l = requireLocal();
  const base = normalizeServer(server);
  if (!/^https?:\/\//.test(base)) throw new ApiError("bad_request", "Enter the server address, starting with https://.");
  const res = await (mode === "signup" ? api.signup : api.login)(base, username.trim(), password, deviceName());
  token = res.token;
  await l.setMeta({ token: res.token, username: res.username, server: base, seq: "0", lastSyncedAt: null });
  set({ username: res.username, server: base, status: "syncing", error: null, lastSyncedAt: null });

  await flushWrites();
  const pulled = await pullAll(base, res.token);
  const localHasData = await l.hasData();
  const remoteHasData = pulled.changes.some((c) => c.row != null && c.table !== "settings");
  if (localHasData && remoteHasData) {
    pendingFirst = pulled;
    await l.setMeta({ firstSync: "1" });
    set({ needsChoice: true });
    return;
  }
  // Only one side (or neither) has data: take the server's rows, then upload ours.
  await finishFirstSync(localHasData ? "merge" : "server", pulled);
}

export async function resolveFirstSync(choice: FirstSyncChoice): Promise<void> {
  const pulled = pendingFirst;
  if (!pulled) return;
  pendingFirst = null;
  set({ needsChoice: false, status: "syncing" });
  try {
    // Desktop keeps a copy of this device's data before mixing in the account's.
    await (await getPlatform()).backupNow("pre-sync");
  } catch (e) {
    console.warn("Pre-sync backup failed", e);
  }
  await finishFirstSync(choice, pulled);
}

async function finishFirstSync(choice: FirstSyncChoice, pulled: { changes: SyncChange[]; seq: number }): Promise<void> {
  const l = requireLocal();
  const { server } = useSync.getState();
  try {
    await flushWrites();
    if (choice === "server") {
      await applyPulled(() => l.applyRemote(pulled.changes, { replace: true }));
      await l.setMeta({ seq: String(pulled.seq) });
    } else if (choice === "merge") {
      await l.clearOutbox();
      await applyPulled(() => l.applyRemote(pulled.changes));
      await l.enqueueAll();
      await l.setMeta({ seq: String(pulled.seq) });
    } else {
      // Upload this device and drop everything else on the server.
      await l.enqueueAll();
      const entries = await l.readOutbox(Number.MAX_SAFE_INTEGER);
      const res = await api.sync(server, requireToken(), {
        since: pulled.seq,
        changes: entries.map(({ table, key, row }) => ({ table, key, row })),
        replace: true,
      });
      await l.markPushed(entries);
      await l.setMeta({ seq: String(res.seq) });
    }
    await l.setMeta({ firstSync: null });
    startBackground();
    await syncNow();
  } catch (e) {
    fail(e);
    throw e;
  }
}

/** Pulls every row of the account without pushing anything. */
async function pullAll(server: string, tok: string): Promise<{ changes: SyncChange[]; seq: number }> {
  const res = await api.sync(server, tok, { since: 0, changes: [] });
  return { changes: res.changes, seq: res.seq };
}

function requireToken(): string {
  if (!token) throw new ApiError("unauthorized", "You were signed out. Sign in again.");
  return token;
}

/** Applies pulled rows and refreshes the in-memory store if anything changed. */
async function applyPulled(apply: () => Promise<number>): Promise<void> {
  applyingRemote = true;
  try {
    const n = await apply();
    if (n > 0) await reloadFromDb();
  } finally {
    applyingRemote = false;
  }
}

/** One push + pull round. Concurrent calls coalesce into one extra round. */
export function syncNow(): Promise<void> {
  if (!token || useSync.getState().needsChoice) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await round();
      } while (again);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function round(): Promise<void> {
  const l = requireLocal();
  const { server } = useSync.getState();
  set({ status: "syncing" });
  try {
    await flushWrites();
    let more = true;
    while (more) {
      const since = Number((await l.getMeta("seq")) ?? 0);
      const entries = await l.readOutbox(PAGE);
      more = entries.length === PAGE;
      const res = await api.sync(server, requireToken(), {
        since,
        changes: entries.map(({ table, key, row }) => ({ table, key, row })),
      });
      await l.markPushed(entries);
      // The server's answer includes what we just pushed; skip those echoes.
      const pushed = new Set(entries.map((e) => `${e.table}\u0000${e.key}`));
      const incoming = res.changes.filter((c) => !pushed.has(`${c.table}\u0000${c.key}`));
      if (incoming.length) await applyPulled(() => l.applyRemote(incoming));
      await l.setMeta({ seq: String(res.seq) });
    }
    const now = systemEnv.nowMs();
    await l.setMeta({ lastSyncedAt: String(now) });
    set({ status: "synced", lastSyncedAt: now, error: null });
  } catch (e) {
    fail(e);
  }
}

function fail(e: unknown): void {
  if (e instanceof ApiError && e.code === "unauthorized") {
    void forgetSession();
    set({ error: e.message });
    return;
  }
  const offline = e instanceof ApiError && e.code === "network";
  set({ status: offline ? "offline" : "error", error: e instanceof Error ? e.message : String(e) });
}

/** Schedules a sync shortly after local edits settle. */
function scheduleSoon(): void {
  if (!token) return;
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => {
    debounce = null;
    void syncNow();
  }, DEBOUNCE_MS);
}

function startBackground(): void {
  if (started) return;
  started = true;
  useStore.subscribe((s, prev) => {
    if (s.data !== prev.data && !applyingRemote) scheduleSoon();
  });
  if (typeof window !== "undefined") {
    window.addEventListener("focus", () => void syncNow());
    window.addEventListener("online", () => void syncNow());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void syncNow();
    });
  }
  setInterval(() => void syncNow(), INTERVAL_MS);
}

/** Drops the local session (token) but keeps this device's data. */
async function forgetSession(): Promise<void> {
  token = null;
  pendingFirst = null;
  if (debounce) clearTimeout(debounce);
  await requireLocal().setMeta({ token: null, username: null, seq: null, lastSyncedAt: null, firstSync: null });
  // Changes made while signed out are pushed by enqueueAll on the next sign-in.
  await requireLocal().clearOutbox();
  set({ status: "off", username: null, lastSyncedAt: null, needsChoice: false });
}

/** Signs this device out. Pending changes are pushed first when possible. */
export async function signOut(): Promise<void> {
  const { server } = useSync.getState();
  if (token) {
    await syncNow().catch(() => {});
    await api.logout(server, token).catch(() => {});
  }
  await forgetSession();
  set({ error: null });
}

export async function signOutEverywhere(): Promise<void> {
  const { server } = useSync.getState();
  await api.logoutAll(server, requireToken());
  await forgetSession();
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  const { server } = useSync.getState();
  const res = await api.changePassword(server, requireToken(), oldPassword, newPassword);
  token = res.token;
  await requireLocal().setMeta({ token: res.token });
}

/** Deletes the account and everything stored on the server. Local data stays. */
export async function deleteAccount(password: string): Promise<void> {
  const { server } = useSync.getState();
  await api.deleteAccount(server, requireToken(), password);
  await forgetSession();
}
