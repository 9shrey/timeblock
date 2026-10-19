import { browser, $, expect } from "@wdio/globals";
import { clickMinute, dragMinutes, item, itemLabels, key, openSeeded, reload, snap, summary } from "../helpers";

// Day view columns: 0 = Plan, 1 = Actual. Demo "now" is Wed 21 Oct 14:00.
const PLAN = 0;
const ACTUAL = 1;

describe("Day view (native)", () => {
  beforeEach(async () => {
    await openSeeded();
  });

  it("shows today's demo plan with plan states and ghosts", async () => {
    const labels = await itemLabels();
    expect(labels).toContain("Plan, 07:00–08:00, Gym, goal Exercise, done");
    expect(labels).toContain("Plan, 09:00–11:00, Thesis: writing, goal Thesis, not yet confirmed");
    expect(labels).toContain("Planned, not confirmed: 09:00–11:00, Thesis: writing");
    expect(labels).toContain("Plan, 14:00–16:00, Thesis: experiments, goal Thesis, upcoming");
    expect(await summary()).toContain("Plan 6h");
    await snap("day-seeded");
  });

  it("drag-create opens the editor; the title is saved", async () => {
    await dragMinutes(PLAN, 17 * 60, 18 * 60);
    const title = $("#block-title");
    await title.waitForDisplayed();
    await expect(title).toBeFocused();
    await title.setValue("Write e2e tests");
    await key("Enter");
    await expect($("#block-title")).not.toBeDisplayed();
    expect(await itemLabels()).toContain("Plan, 17:00–18:00, Write e2e tests, no goal, upcoming");
  });

  it("Esc on an untouched new block cancels it", async () => {
    const before = (await itemLabels()).length;
    await dragMinutes(PLAN, 19 * 60, 20 * 60);
    await $("#block-title").waitForDisplayed();
    await key("Escape");
    expect((await itemLabels()).length).toBe(before);
  });

  it("dragging a ghost logs a linked actual and marks the plan adjusted; undo restores", async () => {
    // Grab the ghost near its left edge (ghosts leave the right of the lane free).
    await dragMinutes(ACTUAL, 10 * 60, 10 * 60 + 15, { x: 0.15 });
    const labels = await itemLabels();
    expect(labels).toContain("Actual, 09:15–11:15, Thesis: writing, goal Thesis, +15m late");
    expect(labels).toContain("Plan, 09:00–11:00, Thesis: writing, goal Thesis, adjusted");
    await key("", "z"); // Ctrl+Z
    await browser.action("key").up("").perform();
    const after = await itemLabels();
    expect(after).toContain("Planned, not confirmed: 09:00–11:00, Thesis: writing");
    expect(after).not.toContain("Actual, 09:15–11:15, Thesis: writing, goal Thesis, +15m late");
  });

  it("confirm rest of day splits a ghost around an unplanned block", async () => {
    await dragMinutes(ACTUAL, 10 * 60, 10 * 60 + 30, { x: 0.9 });
    await $("#block-title").waitForDisplayed();
    await clickMinute(PLAN, 20 * 60); // click away keeps the new block
    expect(await itemLabels()).toContain("Actual, 10:00–10:30, Untitled, no goal, unplanned");

    await $("button=Confirm rest").click();
    await browser.pause(300);
    const labels = await itemLabels();
    expect(labels).toContain("Actual, 09:00–10:00, Thesis: writing, goal Thesis");
    expect(labels).toContain("Actual, 10:30–11:00, Thesis: writing, goal Thesis, +1h 30m late");
    expect(labels).toContain("Plan, 12:00–13:00, Lunch, no goal, done");
    // The 14:00 block hasn't happened yet and stays a ghost.
    expect(labels).toContain("Planned, not confirmed: 14:00–16:00, Thesis: experiments");
    await snap("day-confirmed");
  });

  it("Delete on a selected ghost skips the plan block", async () => {
    await (await item("Planned, not confirmed: 12:00–13:00")).click();
    await key("Delete");
    expect(await itemLabels()).toContain("Plan, 12:00–13:00, Lunch, no goal, skipped");
    expect(await summary()).toContain("Skipped 1h");
  });

  it("keyboard: nudge, set goal, delete", async () => {
    await (await item("Plan, 14:00–16:00")).click();
    await key("ArrowDown");
    expect(await itemLabels()).toContain("Plan, 14:15–16:15, Thesis: experiments, goal Thesis, upcoming");
    await key("2");
    expect(await itemLabels()).toContain("Plan, 14:15–16:15, Thesis: experiments, goal Exercise, upcoming");
    await key("Delete");
    expect((await itemLabels()).some((l) => l.includes("Thesis: experiments") && l.startsWith("Plan"))).toBe(false);
  });

  it("moving and resizing blocks snaps to 15 minutes", async () => {
    // Short drags stay clear of the viewport edges, where autoscroll would kick in.
    await dragMinutes(PLAN, 12 * 60 + 30, 14 * 60 + 30); // grabbed 30 min in → starts 14:00
    expect(await itemLabels()).toContain("Plan, 14:00–15:00, Lunch, no goal, upcoming");
    // Bottom edge: 2px above the block's end; 15:00 → 15:25 snaps to 15:30.
    await dragMinutes(PLAN, 15 * 60, 15 * 60 + 25, { dy: -2, x: 0.8 }); // Lunch is in the right lane (Thesis is longer)
    expect(await itemLabels()).toContainEqual(expect.stringMatching(/^Plan, 14:00–15:30, Lunch/));
  });

  it("a past day's plan is locked until unlocked", async () => {
    await key("[");
    await expect($('button[aria-label="Unlock past plan to edit"]')).toBeDisplayed();
    const before = await itemLabels();
    await dragMinutes(PLAN, 18 * 60, 19 * 60);
    expect(await itemLabels()).toEqual(before);
    await $('button[aria-label="Unlock past plan to edit"]').click();
    await dragMinutes(PLAN, 18 * 60, 19 * 60);
    await $("#block-title").waitForDisplayed();
    await key("Escape");
  });

  it("data survives an app restart", async () => {
    await dragMinutes(PLAN, 21 * 60, 22 * 60);
    await $("#block-title").setValue("Persist me");
    await key("Enter");
    await browser.pause(500); // let the write queue flush
    await browser.reloadSession(); // quits and relaunches the app
    await reload();
    expect(await itemLabels()).toContain("Plan, 21:00–22:00, Persist me, no goal, upcoming");
  });
});
