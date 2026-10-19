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
}));
vi.mock("@/platform", () => ({ getPlatform: async () => platform }));

import { polyfillDom, seededStore } from "@/test/harness";
import { SettingsView } from "./SettingsView";

polyfillDom();

const reload = vi.fn();
beforeEach(async () => {
  vi.clearAllMocks();
  Object.defineProperty(window, "location", { value: { ...window.location, reload }, configurable: true });
  await seededStore();
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
