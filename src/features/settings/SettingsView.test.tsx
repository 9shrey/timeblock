// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const platform = vi.hoisted(() => ({
  kind: "tauri" as const,
  appVersion: async () => "9.9.9",
  dataDir: async () => "/data",
  revealDataDir: vi.fn(async () => {}),
  listBackups: vi.fn(async () => [
    { name: "data-1760900000-auto.sqlite3", createdAt: 1760900000, sizeBytes: 40960 },
    { name: "data-1760800000-pre-import.sqlite3", createdAt: 1760800000, sizeBytes: 2 * 1024 * 1024 },
  ]),
  restoreBackup: vi.fn(async (_name: string) => {}),
  checkForUpdate: vi.fn(async () => ({ version: "10.0.0", notes: "### Added\n- **Faster** sync", needsPassword: true })),
  installUpdate: vi.fn(async (_onProgress?: unknown) => {}),
  openUrl: vi.fn(async (_url: string) => {}),
}));
vi.mock("@/platform", () => ({
  getPlatform: async () => platform,
  RELEASES_URL: "https://github.com/9shrey/timeblock/releases/latest",
}));

import { polyfillDom, seededStore } from "@/test/harness";
import { useStore } from "@/state/store";
import { resetUpdatesForTest } from "@/state/updates";
import { SettingsView } from "./SettingsView";

polyfillDom();

const reload = vi.fn();
beforeEach(async () => {
  vi.clearAllMocks();
  Object.defineProperty(window, "location", { value: { ...window.location, reload }, configurable: true });
  await seededStore();
  resetUpdatesForTest();
});
afterEach(cleanup);

describe("SettingsView backups", () => {
  it("shows the last backup and restores one after a confirm step", async () => {
    render(<SettingsView />);
    expect(await screen.findByText(/Last backup:/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Restore a backup/ }));
    const list = await screen.findByRole("list", { name: "Backups" });
    expect(list.textContent).toContain("Daily · 40 KB");
    expect(list.textContent).toContain("Before import · 2.0 MB");

    fireEvent.click(screen.getAllByRole("button", { name: "Restore" })[1]!);
    expect(platform.restoreBackup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Replace current data" }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(platform.restoreBackup).toHaveBeenCalledWith("data-1760800000-pre-import.sqlite3");
  });

  it("shows a restore failure instead of reloading", async () => {
    platform.restoreBackup.mockRejectedValueOnce(new Error("disk full"));
    render(<SettingsView />);
    fireEvent.click(await screen.findByRole("button", { name: /Restore a backup/ }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Restore" }))[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Replace current data" }));
    expect(await screen.findByText("disk full")).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("SettingsView updates", () => {
  it("finds an update, shows its notes and the password hint, and installs it", async () => {
    render(<SettingsView />);
    fireEvent.click(await screen.findByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText("Version 10.0.0 is available. You have 9.9.9.")).toBeTruthy();
    expect(screen.getByText(/asks for your system password/)).toBeTruthy();
    expect(screen.getByText("What's new in 10.0.0")).toBeTruthy();
    expect(screen.getByText(/Faster sync/).textContent).not.toContain("**");

    fireEvent.click(screen.getByRole("button", { name: "Install and restart" }));
    await waitFor(() => expect(platform.installUpdate).toHaveBeenCalled());
  });

  it("explains a failed install and links to the Releases page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    platform.installUpdate.mockRejectedValueOnce(new Error("Authentication was dismissed"));
    render(<SettingsView />);
    fireEvent.click(await screen.findByRole("button", { name: "Check for updates" }));
    fireEvent.click(await screen.findByRole("button", { name: "Install and restart" }));
    expect(await screen.findByText("Couldn't install 10.0.0: Authentication was dismissed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open the Releases page" }));
    await waitFor(() => expect(platform.openUrl).toHaveBeenCalledWith("https://github.com/9shrey/timeblock/releases/latest"));
  });

  it("turns automatic checks off", async () => {
    render(<SettingsView />);
    const box = await screen.findByRole("checkbox", { name: "Check automatically" });
    expect(box.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(box);
    await waitFor(() => expect(useStore.getState().settings.autoCheckUpdates).toBe(false));
  });
});
