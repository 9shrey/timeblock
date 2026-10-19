import { browser, $, $$, expect } from "@wdio/globals";
import { execSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gotoView, item, itemLabels, key, openSeeded, scrollTo, waitForLabel } from "../helpers";

describe("Block editor and menus (native)", () => {
  beforeEach(async () => {
    await openSeeded();
  });

  it("edits title, goal, times and notes; one undo reverts the whole session", async () => {
    await (await item("Plan, 14:00–16:00")).doubleClick();
    const title = $("#block-title");
    await title.waitForDisplayed();
    await title.setValue("Experiments v2");

    await $('button[aria-label="Goal"]').click();
    await $('[role="option"]*=Social').click();

    const start = $('input[aria-label="Start time"]');
    await start.setValue("1430");
    await key("Enter");
    const end = $('input[aria-label="End time"]');
    await end.setValue("17.15");
    await key("Enter");
    await $("#block-notes").setValue("Run the ablation");
    await browser.pause(200);

    expect(await itemLabels()).toContain("Plan, 14:30–17:15, Experiments v2, goal Social, upcoming");
    await key("Escape");
    await expect($("#block-title")).not.toBeDisplayed();

    await browser.keys(["Control", "z"]);
    await browser.keys(["Control"]);
    await browser.pause(200);
    expect(await itemLabels()).toContain("Plan, 14:00–16:00, Thesis: experiments, goal Thesis, upcoming");
  });

  it("rejects an end time before the start", async () => {
    await (await item("Plan, 14:00–16:00")).doubleClick();
    const end = $('input[aria-label="End time"]');
    await end.waitForDisplayed();
    await end.setValue("13:00");
    await key("Enter");
    await expect(end).toHaveAttribute("aria-invalid", "true");
    expect(await itemLabels()).toContain("Plan, 14:00–16:00, Thesis: experiments, goal Thesis, upcoming");
  });

  it("a selected ghost shows ✓/✗; ✓ confirms it", async () => {
    // Selecting reveals them (so does hover, but WebKit's automation doesn't drive CSS :hover).
    // Runs before the right-click tests: after a right-click, WebKitWebDriver stops sending
    // real pointer events for the rest of the session.
    await scrollTo(12 * 60);
    const ghost = await item("Planned, not confirmed: 12:00–13:00");
    await ghost.click();
    await ghost.$('button[aria-label="Happened as planned"]').click();
    await waitForLabel("Plan, 12:00–13:00, Lunch, no goal, done");
  });

  it("the context menu on a plan block copies it to tomorrow", async () => {
    await scrollTo(15 * 60);
    await (await item("Plan, 14:00–16:00")).click({ button: "right" });
    await $('[role="menuitem"]*=Copy to tomorrow').click();
    await $('button[aria-label="Next day"]').click();
    const labels = await itemLabels();
    expect(labels.filter((l) => l.startsWith("Plan, 14:00–16:00, Thesis: experiments"))).toHaveLength(2);
  });

  it("the context menu on a ghost confirms it", async () => {
    await scrollTo(10 * 60);
    await (await item("Planned, not confirmed: 09:00–11:00")).click({ button: "right" });
    await $('[role="menuitem"]*=Happened as planned').click();
    await waitForLabel("Plan, 09:00–11:00, Thesis: writing, goal Thesis, done");
    // The closed menu must not leave the page inert.
    await browser.waitUntil(async () => (await browser.execute(() => getComputedStyle(document.body).pointerEvents)) !== "none", {
      timeout: 2000,
      timeoutMsg: "body still has pointer-events: none after the menu closed",
    });
  });
});

describe("Desktop integration (native)", () => {
  it("follows the desktop colour scheme", async () => {
    await openSeeded();
    let scheme: string;
    try {
      scheme = execSync("gsettings get org.gnome.desktop.interface color-scheme", { encoding: "utf8" });
    } catch {
      return; // no gsettings: nothing to compare against
    }
    const dark = await browser.execute(() => document.documentElement.classList.contains("dark"));
    expect(dark).toBe(scheme.includes("dark"));
  });

  it("Back up now writes a backup file", async () => {
    await openSeeded();
    await gotoView("Settings");
    const dir = join(process.env.TIMEBLOCK_E2E_DATA!, "com.shreysingh.timeblock", "backups");
    const before = existsSync(dir) ? readdirSync(dir).filter((f) => f.includes("manual")).length : 0;
    await $("button*=Back up now").click();
    await browser.waitUntil(() => existsSync(dir) && readdirSync(dir).filter((f) => f.includes("manual")).length > before, {
      timeout: 5000,
      timeoutMsg: "no manual backup appeared",
    });
    await expect($$("li[data-sonner-toast]")[0]!).toHaveText(expect.stringContaining("Backup created"));
  });

  it("restores a backup: the deleted block comes back and the deletion is backed up", async () => {
    await openSeeded();
    await gotoView("Settings");
    await $("button*=Back up now").click();
    await $("li[data-sonner-toast]").waitForExist();
    await gotoView("Day");
    await (await item("Plan, 14:00–16:00")).click();
    await key("Delete");
    expect((await itemLabels()).some((l) => l.startsWith("Plan, 14:00–16:00"))).toBe(false);

    await gotoView("Settings");
    await $("button*=Restore a backup").click();
    const list = await $('ul[aria-label="Backups"]');
    await list.waitForExist();
    // Newest first: the manual backup made above.
    await expect(list.$("li")).toHaveText(expect.stringContaining("Manual"));
    await list.$("li").$("button*=Restore").click();
    await $("button*=Replace current data").click();
    // The window reloads on the restored file.
    await $("[data-col-key]").waitForExist({ timeout: 15000 });
    await gotoView("Day");
    await browser.waitUntil(async () => (await itemLabels()).some((l) => l.startsWith("Plan, 14:00–16:00")), {
      timeout: 5000,
      timeoutMsg: "restored block not shown",
    });
    const dir = join(process.env.TIMEBLOCK_E2E_DATA!, "com.shreysingh.timeblock", "backups");
    expect(readdirSync(dir).some((f) => f.includes("pre-restore"))).toBe(true);
  });
});
