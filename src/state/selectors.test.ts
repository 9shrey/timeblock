import { describe, expect, it } from "vitest";
import { applyChanges, emptyState, put } from "@/domain/changes";
import type { Block } from "@/domain/types";
import { activeGoals, blocksOn } from "./selectors";

const block = (id: string, day: string, start = 540): Block => ({
  id,
  day,
  layer: "plan",
  startMinute: start,
  endMinute: start + 60,
  title: id,
  goalId: null,
  notes: "",
  planBlockId: null,
  skipped: false,
  routineId: null,
  createdAt: 1,
  updatedAt: 1,
});

describe("blocksOn", () => {
  it("sorts by start and keeps unchanged days' arrays across commits", () => {
    let data = applyChanges(emptyState(), [
      put("blocks", block("late", "2026-10-19", 600)),
      put("blocks", block("early", "2026-10-19", 480)),
      put("blocks", block("tue", "2026-10-20")),
    ]);
    const mon = blocksOn(data, "2026-10-19");
    const tue = blocksOn(data, "2026-10-20");
    expect(mon.map((b) => b.id)).toEqual(["early", "late"]);

    data = applyChanges(data, [put("blocks", { ...block("tue", "2026-10-20"), title: "edited" })]);
    expect(blocksOn(data, "2026-10-19")).toBe(mon);
    expect(blocksOn(data, "2026-10-20")).not.toBe(tue);
    expect(blocksOn(data, "2026-10-20")[0]?.title).toBe("edited");
    expect(blocksOn(data, "2026-10-25")).toEqual([]);
  });
});

describe("activeGoals", () => {
  it("hides goals archived on or before the week", () => {
    const goal = (id: string, archivedOn: string | null) => ({ id, name: id, color: "#000000", kind: "min" as const, sortOrder: 0, archivedOn, createdAt: 1, updatedAt: 1 });
    const data = applyChanges(emptyState(), [put("goals", goal("live", null)), put("goals", goal("old", "2026-10-19")), put("goals", goal("later", "2026-10-26"))]);
    expect(activeGoals(data, "2026-10-19").map((g) => g.id)).toEqual(["live", "later"]);
  });
});
