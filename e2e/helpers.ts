/** Helpers for driving the Timeblock window. Times are wall-clock minutes. */
import { mkdirSync } from "node:fs";
import { browser, $, $$ } from "@wdio/globals";

export const DEMO_NOW = "2026-10-21T14:00"; // a Wednesday; the demo seed is built around it

/** Loads the app with the demo data and a frozen clock, and waits for the timeline. */
export async function openSeeded(now = DEMO_NOW): Promise<void> {
  // A right-click (context menu tests) can leave WebDriver's pointer state dirty.
  await browser.releaseActions();
  await browser.url(`tauri://localhost/?seed=demo&now=${now}`);
  await $("[data-col-key]").waitForExist();
}

/** Reloads without reseeding (keeps the frozen clock). */
export async function reload(now = DEMO_NOW): Promise<void> {
  await browser.url(`tauri://localhost/?now=${now}`);
  await $("[data-col-key]").waitForExist();
}

export async function key(...keys: string[]): Promise<void> {
  await browser.keys(keys);
  await browser.pause(150);
}

/** aria-labels of every timeline item (blocks and ghosts) currently rendered. */
export async function itemLabels(): Promise<string[]> {
  return browser.execute(() => [...document.querySelectorAll("[data-item]")].map((e) => e.getAttribute("aria-label") ?? ""));
}

/** The first timeline item whose aria-label contains every fragment. */
export async function item(...fragments: string[]) {
  const labels = await itemLabels();
  const label = labels.find((l) => fragments.every((f) => l.includes(f)));
  if (!label) throw new Error(`No item matching ${JSON.stringify(fragments)}. Have:\n${labels.join("\n")}`);
  return $(`[aria-label="${label.replace(/"/g, '\\"')}"]`);
}

/** Scrolls the timeline so `minute` is in the middle of the viewport. */
export async function scrollTo(minute: number): Promise<void> {
  await browser.execute((min) => {
    const lanes = document.querySelector<HTMLElement>("[data-col-key]")!.parentElement!;
    const scroller = lanes.closest<HTMLElement>(".overflow-y-auto")!;
    const pxPerMin = lanes.getBoundingClientRect().height / 1440;
    scroller.scrollTop = Math.max(0, min * pxPerMin - scroller.clientHeight / 2);
  }, minute);
  await browser.pause(50);
}

/** Viewport point at `minute` in column `colIndex` (no scrolling; see `scrollTo`). */
export async function pointAt(colIndex: number, minute: number, xFraction = 0.5): Promise<{ x: number; y: number }> {
  return browser.execute(
    (col, min, fx) => {
      const lanes = document.querySelector<HTMLElement>("[data-col-key]")!.parentElement!;
      const pxPerMin = lanes.getBoundingClientRect().height / 1440;
      const r = lanes.querySelectorAll<HTMLElement>("[data-col-key]")[col]!.getBoundingClientRect();
      return { x: Math.round(r.left + r.width * fx), y: Math.round(r.top + min * pxPerMin) };
    },
    colIndex,
    minute,
    xFraction,
  );
}

/** Drags within the timeline from `fromMin` in one column to `toMin` (optionally in another column). */
export async function dragMinutes(
  col: number,
  fromMin: number,
  toMin: number,
  opts: { toCol?: number; x?: number; toX?: number; ctrl?: boolean; dy?: number } = {},
): Promise<void> {
  await scrollTo((fromMin + toMin) / 2);
  const from = await pointAt(col, fromMin, opts.x ?? 0.5);
  const to = await pointAt(opts.toCol ?? col, toMin, opts.toX ?? opts.x ?? 0.5);
  await drag({ x: from.x, y: from.y + (opts.dy ?? 0) }, { x: to.x, y: to.y + (opts.dy ?? 0) }, { ctrl: opts.ctrl });
}

/** Clicks the timeline at `minute` in a column. */
export async function clickMinute(col: number, minute: number, x = 0.5): Promise<void> {
  await scrollTo(minute);
  await clickAt(await pointAt(col, minute, x));
}

/** Press at `from`, move in steps, release at `to` (real pointer events). */
export async function drag(from: { x: number; y: number }, to: { x: number; y: number }, opts: { ctrl?: boolean } = {}): Promise<void> {
  if (opts.ctrl) await browser.action("key").down("").perform(true);
  const steps = 6;
  const a = browser.action("pointer", { parameters: { pointerType: "mouse" } }).move({ x: from.x, y: from.y }).down({ button: 0 });
  for (let i = 1; i <= steps; i++) {
    a.move({ x: Math.round(from.x + ((to.x - from.x) * i) / steps), y: Math.round(from.y + ((to.y - from.y) * i) / steps), duration: 30 });
  }
  await a.up({ button: 0 }).perform();
  if (opts.ctrl) await browser.action("key").up("").perform();
  await browser.pause(250);
}

export async function clickAt(p: { x: number; y: number }): Promise<void> {
  await browser.action("pointer").move({ x: p.x, y: p.y }).down({ button: 0 }).up({ button: 0 }).perform();
  await browser.pause(200);
}

/** Text of the day summary bar, e.g. "Plan 7h · Actual 1h …". */
export async function summary(): Promise<string> {
  return (await $('[aria-label="Day summary"]').getText()).replace(/\s+/g, " ");
}

export async function gotoView(label: "Day" | "Week" | "Goals" | "Review" | "Settings"): Promise<void> {
  await $(`nav button[aria-label^="${label}"]`).click();
  await browser.pause(300);
}

export async function rowsCount(selector: string): Promise<number> {
  return (await $$(selector)).length;
}

/** Saves a screenshot under e2e/screenshots for manual review. */
export async function snap(name: string): Promise<void> {
  mkdirSync("./e2e/screenshots", { recursive: true });
  await browser.saveScreenshot(`./e2e/screenshots/${name}.png`);
}

/** Waits until some timeline item has exactly this aria-label (renders are async). */
export async function waitForLabel(label: string, timeout = 3000): Promise<void> {
  await browser.waitUntil(async () => (await itemLabels()).includes(label), {
    timeout,
    timeoutMsg: `No item labelled "${label}". Have:\n${(await itemLabels()).join("\n")}`,
  });
}
