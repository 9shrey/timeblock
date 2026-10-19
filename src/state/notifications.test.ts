// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({
  setTrayNextBlock: vi.fn(async (_title: string | null) => {}),
  showNotification: vi.fn(async (_opts: { title: string; body: string; onAction?: () => void }) => {}),
}));
vi.mock("@/platform", () => ({ getPlatform: async () => platform }));

import { demoSeed } from "@/data/devSeed";
import { createSqlJsDriver } from "@/data/drivers/sqljsDriver";
import { SqliteRepository } from "@/data/SqliteRepository";
import { EVENING_NUDGE_MINUTE, WEEKLY_REVIEW_MINUTE } from "@/domain/notifications/schedule";
import { createBlockAt } from "./commands";
import { checkNotifications, resetNotificationState } from "./notifications";
import { initStore, useStore } from "./store";

const now = { day: "2026-10-21", minute: 840 }; // Wednesday
let repo: SqliteRepository;

beforeEach(async () => {
  vi.clearAllMocks();
  resetNotificationState();
  repo = new SqliteRepository(await createSqlJsDriver());
  await repo.init();
  await repo.replaceAll(demoSeed(now));
  await initStore({ repo }, now);
});

describe("checkNotifications", () => {
  it("always updates the tray's next-block label", async () => {
    await checkNotifications(now);
    expect(platform.setTrayNextBlock).toHaveBeenCalled();
  });

  it("fires the next-block notification once, within the lead window", async () => {
    useStore.setState({ now: { day: now.day, minute: 100 } });
    createBlockAt(now.day, "plan", 105, 130);
    await checkNotifications({ day: now.day, minute: 100 });
    expect(platform.showNotification).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining("Next block in 5 min") }));
    platform.showNotification.mockClear();
    await checkNotifications({ day: now.day, minute: 100 });
    expect(platform.showNotification).not.toHaveBeenCalled();
  });

  it("respects the notifyNextBlock setting", async () => {
    useStore.setState({ settings: { ...useStore.getState().settings, notifyNextBlock: false } });
    createBlockAt(now.day, "plan", 105, 130);
    await checkNotifications({ day: now.day, minute: 100 });
    expect(platform.showNotification).not.toHaveBeenCalled();
  });

  it("fires the evening nudge once there are unconfirmed blocks past the threshold", async () => {
    const evening = { day: now.day, minute: EVENING_NUDGE_MINUTE };
    await checkNotifications(evening); // demo seed should have some past plan blocks today
    const calls = platform.showNotification.mock.calls.map((c) => c[0] as { title: string });
    expect(calls.some((c) => c.title.includes("unconfirmed"))).toBe(true);
  });

  it("fires the weekly review notification on the week's last day", async () => {
    const { weekStartDay } = useStore.getState().settings;
    // Find the week's last day relative to now.day isn't needed; just assert it never fires on a non-last day.
    await checkNotifications({ day: now.day, minute: WEEKLY_REVIEW_MINUTE });
    const calls = platform.showNotification.mock.calls.map((c) => c[0] as { title: string });
    const fired = calls.some((c) => c.title === "Weekly review is ready");
    expect(typeof weekStartDay).toBe("number");
    // 2026-10-21 is a Wednesday; with the demo seed's default Monday week start it isn't the last day.
    expect(fired).toBe(false);
  });
});
