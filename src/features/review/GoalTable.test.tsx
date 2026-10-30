// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { demoSeed } from "@/data/devSeed";
import { computeStats } from "@/domain/stats/stats";
import { weekDays } from "@/domain/time/localDate";
import { GoalTable } from "./GoalTable";

const now = { day: "2026-10-21", minute: 840 };
const seed = demoSeed(now);

function renderWeek(weekStart: string) {
  const stats = computeStats({
    weekStart,
    days: weekDays(weekStart),
    blocks: seed.blocks,
    goals: seed.goals,
    targets: seed.weekTargets,
    checklist: seed.checklistItems,
    now,
  });
  render(<GoalTable goals={stats.goals} unassigned={stats.unassigned} />);
  return Object.fromEntries(
    screen.getAllByTestId("goal-row").map((row) => [
      within(row).getAllByRole("cell")[0]!.textContent,
      within(row).queryByTestId("status")?.textContent ?? null,
    ]),
  );
}

afterEach(cleanup);

describe("GoalTable", () => {
  it("shows met / missed / over for the finished week", () => {
    expect(renderWeek("2026-10-12")).toMatchObject({ Thesis: "Met", Exercise: "Missed", Social: "Over", Errands: "Missed" });
  });

  it("warns about an over-planned max goal in the current week", () => {
    const statuses = renderWeek("2026-10-19");
    expect(statuses.Social).toBe("Watch");
    expect(statuses["No goal"]).toBeNull(); // unassigned bucket has no status
  });
});
