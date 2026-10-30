import { describe, expect, it } from "vitest";
import { stateFrom } from "@/domain/changes";
import { validateBlock } from "@/domain/blocks/validate";
import { planStates } from "@/domain/blocks/reconcile";
import { computeStats } from "@/domain/stats/stats";
import { weekDays } from "@/domain/time/localDate";
import { createSqlJsDriver } from "./drivers/sqljsDriver";
import { demoSeed } from "./devSeed";
import { SqliteRepository } from "./SqliteRepository";

const now = { day: "2026-10-21", minute: 840 };
const seed = demoSeed(now);

describe("demoSeed", () => {
  it("is valid and loads into the DB", async () => {
    const s = stateFrom(seed);
    for (const b of seed.blocks) expect(validateBlock(b, { goals: s.goals, blocks: s.blocks })).toEqual([]);
    const repo = new SqliteRepository(await createSqlJsDriver());
    await repo.init();
    await repo.replaceAll(seed);
    expect((await repo.exportAll()).blocks).toHaveLength(seed.blocks.length);
  });

  it("covers every plan state", () => {
    const states = new Set(planStates(seed.blocks, now).values());
    expect([...states].sort()).toEqual(["adjusted", "done", "pending", "skipped", "unconfirmed"]);
  });

  it("has met/missed/over last week and watch / behind this week", () => {
    const stats = (weekStart: string) =>
      computeStats({
        weekStart,
        days: weekDays(weekStart),
        blocks: seed.blocks,
        goals: seed.goals,
        targets: seed.weekTargets,
        checklist: seed.checklistItems,
        now,
      });
    const status = (weekStart: string) => Object.fromEntries(stats(weekStart).goals.map((g) => [g.goal?.name, g.status]));
    expect(status("2026-10-12")).toEqual({ Thesis: "met", Exercise: "missed", Social: "over", Errands: "missed" });
    expect(status("2026-10-19")).toMatchObject({ Social: "watch", Errands: "open" });
    // Today's 9–11 thesis block is an unconfirmed ghost (used by the confirm-rest-of-day demo).
    expect(stats("2026-10-19").uncorrectedDays).toEqual(["2026-10-20", "2026-10-21"]);
  });
});
