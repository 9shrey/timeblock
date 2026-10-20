import { browser, $, $$, expect } from "@wdio/globals";
import { dragMinutes, gotoView, item, itemLabels, key, openSeeded, snap } from "../helpers";

/** Text of the main content area, whitespace-collapsed. */
async function mainText(): Promise<string> {
  return browser.execute(() => (document.querySelector("main")?.textContent ?? "").replace(/\s+/g, " "));
}

/** aria-labels of the items inside one timeline column, e.g. "2026-10-22:plan". */
async function labelsIn(colKey: string): Promise<string[]> {
  return browser.execute(
    (key) => [...document.querySelectorAll(`[data-col-key="${key}"] [data-item]`)].map((e) => e.getAttribute("aria-label") ?? ""),
    colKey,
  );
}

describe("Week view (native)", () => {
  beforeEach(async () => {
    await openSeeded();
    await gotoView("Week");
  });

  it("shows 7 days, split Plan|Actual up to today and plan-only after", async () => {
    // Mon–Wed split (2 columns each), Thu–Sun plan only.
    expect(await $$("[data-col-key]").length).toBe(3 * 2 + 4);
    const text = await mainText();
    for (const d of ["Mon 19", "Tue 20", "Wed 21", "Thu 22", "Fri 23", "Sat 24", "Sun 25"]) expect(text).toContain(d);
    await snap("week");
    expect(text).toContain("P 5h · A 4h"); // Tuesday: 2 h + 1 h + 2 h planned
  });

  it("moves a plan block to the next day, and Ctrl copies", async () => {
    // Columns: Mon P,A (0,1) Tue P,A (2,3) Wed P,A (4,5) Thu P (6) Fri P (7) …
    await dragMinutes(6, 12 * 60 + 30, 12 * 60 + 30, { toCol: 7 });
    expect((await labelsIn("2026-10-22:plan")).some((l) => l.includes("Lunch"))).toBe(false);
    expect((await labelsIn("2026-10-23:plan")).filter((l) => l.includes("Lunch"))).toHaveLength(2);
    // Ctrl-drag Friday's experiments block back onto Thursday: a copy, Friday keeps it.
    await dragMinutes(7, 14 * 60 + 30, 14 * 60 + 30, { toCol: 6, ctrl: true });
    expect((await labelsIn("2026-10-22:plan")).filter((l) => l.includes("Thesis: experiments"))).toHaveLength(2);
    expect((await labelsIn("2026-10-23:plan")).filter((l) => l.includes("Thesis: experiments"))).toHaveLength(1);
  });

  it("clicking a day header opens that day", async () => {
    await $('button[aria-label^="Open Thu 22"]').click();
    await expect($("h1")).toHaveText(expect.stringContaining("Thursday, 22 Oct 2026"));
  });
});

describe("Goals (native)", () => {
  beforeEach(async () => {
    await openSeeded();
    await gotoView("Goals");
  });

  it("lists goals with inherited targets and edits only the viewed week", async () => {
    let text = await mainText();
    expect(text).toContain("inherited from W42");
    await key("]"); // next week (W44)
    const thesisTarget = $('section[aria-label="Thesis"] input[aria-label="Target hours this week"]');
    await thesisTarget.setValue("16");
    await key("Enter");
    await browser.pause(200);
    expect(await thesisTarget.getValue()).toBe("16");
    await key("[");
    await expect($('section[aria-label="Thesis"] input[aria-label="Target hours this week"]')).toHaveValue("15");
    text = await mainText();
    expect(text).toContain("inherited from W42");
  });

  it("creates a goal that shows up in the block editor's goal picker", async () => {
    await $("button=New goal").click();
    await $("#goal-name").setValue("Reading");
    await $("#goal-target").setValue("2.5");
    await $("button=Create goal").click();
    await expect($('section[aria-label="Reading"]')).toBeDisplayed();
    await expect($('section[aria-label="Reading"] input[aria-label="Target hours this week"]')).toHaveValue("2.5");
    await gotoView("Day");
    await (await item("Plan, 14:00–16:00")).click();
    await key("5"); // fifth goal (after the seed's Thesis, Exercise, Social, Errands)
    expect(await itemLabels()).toContain("Plan, 14:00–16:00, Thesis: experiments, goal Reading, upcoming");
  });

  it("carries unfinished outcomes over once", async () => {
    const carry = $("button*=Carry over");
    await expect(carry).toHaveText(expect.stringContaining("3 unfinished"));
    await carry.click();
    await expect($("button*=Carry over")).not.toBeExisting();
    const outcomes = await $$('[role="checkbox"]').map((c) => c.getAttribute("aria-label"));
    expect(outcomes).toContain("Done: Run baseline experiments");
    expect(outcomes).toContain("Done: Three gym sessions");
    expect(outcomes).toContain("Done: Dentist appointment");
  });

  it("adds, ticks and deletes an outcome", async () => {
    const add = $('section[aria-label="Exercise"] input[aria-label="Add outcome"]');
    await add.setValue("Stretch daily");
    await key("Enter");
    const box = $('[aria-label="Done: Stretch daily"]');
    await expect(box).toBeDisplayed();
    await box.click();
    await expect(box).toHaveAttribute("aria-checked", "true");
    await $('[aria-label="Delete outcome: Stretch daily"]').click();
    await expect($('[aria-label="Done: Stretch daily"]')).not.toBeExisting();
  });
});

describe("Weekly review (native)", () => {
  beforeEach(async () => {
    await openSeeded();
    await gotoView("Review");
  });

  it("shows statuses; confirming a day updates the numbers and the badge", async () => {
    let text = await mainText();
    expect(text).toContain("2 days have planned blocks that aren't confirmed yet");
    expect(text).toContain("Actual 8h 30m");
    expect(await $$('[data-testid="status"]').map((s) => s.getText())).toEqual(["On track", "On track", "At risk", "Behind"]);
    await expect($('nav button[aria-label^="Review"]')).toHaveAttribute("aria-label", "Review (2 days to review)");

    await $$("button=Confirm as planned")[0]!.click();
    await browser.pause(300);
    text = await mainText();
    expect(text).toContain("1 day has planned blocks");
    expect(text).toContain("Actual 10h 30m");
    await expect($('nav button[aria-label^="Review"]')).toHaveAttribute("aria-label", "Review (1 day to review)");
    await snap("review");
  });

  it("last week shows met / missed / over", async () => {
    await key("[");
    expect(await $$('[data-testid="status"]').map((s) => s.getText())).toEqual(["Met", "Missed", "Over", "Missed"]);
  });

  it("the reflection note persists across a reload", async () => {
    await $('textarea[aria-label="Reflection"]').setValue("Mornings work best.");
    await browser.pause(400);
    await browser.url("tauri://localhost/?now=2026-10-21T14:00");
    await gotoView("Review");
    await expect($('textarea[aria-label="Reflection"]')).toHaveValue("Mornings work best.");
  });
});

describe("Settings (native)", () => {
  beforeEach(async () => {
    await openSeeded();
    await gotoView("Settings");
  });

  it("shows the desktop data folder and version", async () => {
    const text = await mainText();
    expect(text).toMatch(/com\.shreysingh\.timeblock/);
    expect(text).toContain("Timeblock 0.1.0");
    await expect($("button=Open data folder")).toBeDisplayed();
  });

  it("switching the week start to Sunday keeps outcomes on their week", async () => {
    await $('button[aria-label="Week starts on"]').click();
    await $('[role="option"]*=Sunday').click();
    await browser.pause(800);
    await gotoView("Goals");
    expect(await mainText()).toContain("from 18 Oct 2026");
    const outcomes = await $$('[role="checkbox"]').map((c) => c.getAttribute("aria-label"));
    expect(outcomes).toEqual([
      "Done: Write related-work section",
      "Done: Send draft to advisor",
      "Done: Long run on Saturday",
      "Done: Book flights",
      "Done: Return library books",
    ]);
    await gotoView("Week");
    expect(await mainText()).toContain("Sun 18");
  });

  it("snap setting changes drag snapping", async () => {
    await $('button[aria-label="Snap to"]').click();
    await $('[role="option"]*=30 minutes').click();
    await gotoView("Day");
    await dragMinutes(0, 17 * 60, 17 * 60 + 40);
    await key("Escape"); // closes the editor; keep the block? Esc cancels an untouched create
    await dragMinutes(0, 17 * 60, 17 * 60 + 40);
    await $("#block-title").setValue("Snapped");
    await key("Enter");
    expect(await itemLabels()).toContain("Plan, 17:00–17:30, Snapped, no goal, upcoming");
  });
});
