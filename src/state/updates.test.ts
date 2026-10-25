// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastFn = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastFn }));

import type { InstallProgress, Platform, UpdateInfo } from "@/platform";
import { seededStore } from "@/test/harness";
import { useStore } from "./store";
import {
  AUTO_CHECK_INTERVAL_MS,
  checkForUpdate,
  installUpdate,
  plainReleaseNotes,
  resetUpdatesForTest,
  startUpdateChecks,
  useUpdates,
} from "./updates";

const UPDATE: UpdateInfo = { version: "0.3.0", notes: "### Added\n- **Thing**", needsPassword: false };

function fakePlatform(overrides: Partial<Platform> = {}) {
  return {
    kind: "tauri",
    checkForUpdate: vi.fn(async () => UPDATE),
    installUpdate: vi.fn(async (_onProgress?: (p: InstallProgress) => void) => {}),
    ...overrides,
  } as unknown as Platform & { checkForUpdate: ReturnType<typeof vi.fn>; installUpdate: ReturnType<typeof vi.fn> };
}

const state = () => useUpdates.getState().state;

beforeEach(async () => {
  vi.clearAllMocks();
  resetUpdatesForTest();
  await seededStore();
});
afterEach(() => vi.useRealTimers());

describe("checkForUpdate", () => {
  it("shows a newer release, or that the app is current", async () => {
    await checkForUpdate(fakePlatform());
    expect(state()).toEqual({ kind: "available", update: UPDATE });
    await checkForUpdate(fakePlatform({ checkForUpdate: async () => null }));
    expect(state()).toEqual({ kind: "current" });
    expect(toastFn).not.toHaveBeenCalled();
  });

  it("shows a failed manual check", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await checkForUpdate(fakePlatform({ checkForUpdate: () => Promise.reject(new Error("offline")) }));
    expect(state()).toEqual({ kind: "checkFailed" });
  });

  it("keeps the current state when a quiet check fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await checkForUpdate(fakePlatform({ checkForUpdate: async () => null }));
    await checkForUpdate(fakePlatform({ checkForUpdate: () => Promise.reject(new Error("offline")) }), { quiet: true });
    expect(state()).toEqual({ kind: "current" });
  });

  it("announces a version found by a quiet check once", async () => {
    await checkForUpdate(fakePlatform(), { quiet: true });
    await checkForUpdate(fakePlatform(), { quiet: true });
    expect(toastFn).toHaveBeenCalledTimes(1);
    expect(toastFn.mock.calls[0]![0]).toBe("Timeblock 0.3.0 is available");
    const options = toastFn.mock.calls[0]![1] as { action: { onClick: () => void } };
    options.action.onClick();
    expect(useStore.getState().view).toBe("settings");
  });

  it("doesn't interrupt a download", async () => {
    const p = fakePlatform();
    useUpdates.setState({ state: { kind: "downloading", update: UPDATE, percent: 40 } });
    await checkForUpdate(p);
    expect(p.checkForUpdate).not.toHaveBeenCalled();
    expect(state()).toEqual({ kind: "downloading", update: UPDATE, percent: 40 });
  });
});

describe("installUpdate", () => {
  it("reports download progress, then installing", async () => {
    const p = fakePlatform({
      installUpdate: async (onProgress) => {
        onProgress?.({ phase: "downloading", downloaded: 0, total: null });
        onProgress?.({ phase: "downloading", downloaded: 10, total: 200 });
        onProgress?.({ phase: "downloading", downloaded: 11, total: 200 }); // still 5%: no re-render
        onProgress?.({ phase: "downloading", downloaded: 200, total: 200 });
        onProgress?.({ phase: "installing" });
      },
    });
    useUpdates.setState({ state: { kind: "available", update: UPDATE } });
    const seen: unknown[] = [];
    const unsubscribe = useUpdates.subscribe((s) => seen.push(s.state));
    await installUpdate(p);
    unsubscribe();
    expect(seen).toEqual([
      { kind: "downloading", update: UPDATE, percent: null },
      { kind: "downloading", update: UPDATE, percent: 5 },
      { kind: "downloading", update: UPDATE, percent: 100 },
      { kind: "installing", update: UPDATE },
    ]);
  });

  it("shows why an install failed and allows a retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const p = fakePlatform({ installUpdate: () => Promise.reject(new Error("pkexec was dismissed")) });
    useUpdates.setState({ state: { kind: "available", update: UPDATE } });
    await installUpdate(p);
    expect(state()).toEqual({ kind: "installFailed", update: UPDATE, message: "pkexec was dismissed" });
    const retry = fakePlatform();
    await installUpdate(retry);
    expect(retry.installUpdate).toHaveBeenCalled();
  });

  it("does nothing without an update", async () => {
    const p = fakePlatform();
    await installUpdate(p);
    expect(p.installUpdate).not.toHaveBeenCalled();
  });
});

describe("startUpdateChecks", () => {
  it("checks shortly after launch, then once a day", async () => {
    vi.useFakeTimers();
    const p = fakePlatform({ checkForUpdate: vi.fn(async () => null) });
    const stop = startUpdateChecks(p);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(p.checkForUpdate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(AUTO_CHECK_INTERVAL_MS - 2 * 60 * 60 * 1000);
    expect(p.checkForUpdate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000);
    expect(p.checkForUpdate).toHaveBeenCalledTimes(2);
    stop();
  });

  it("respects the setting and skips the web build", async () => {
    vi.useFakeTimers();
    useStore.setState({ settings: { ...useStore.getState().settings, autoCheckUpdates: false } });
    const desktop = fakePlatform();
    const web = fakePlatform({ kind: "web" } as Partial<Platform>);
    const stops = [startUpdateChecks(desktop), startUpdateChecks(web)];
    await vi.advanceTimersByTimeAsync(AUTO_CHECK_INTERVAL_MS * 2);
    expect(desktop.checkForUpdate).not.toHaveBeenCalled();
    expect(web.checkForUpdate).not.toHaveBeenCalled();
    stops.forEach((stop) => stop());
  });
});

describe("plainReleaseNotes", () => {
  it("strips Markdown marks but keeps the structure", () => {
    const md = "### Added\r\n- **In-app updates**: see `Settings` and [the docs](https://x.y).\n\n\n\n### Fixed\n- A bug.\n";
    expect(plainReleaseNotes(md)).toBe("Added\n- In-app updates: see Settings and the docs.\n\nFixed\n- A bug.");
  });
});
