// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useStore } from "@/state/store";
import { polyfillDom, seededStore } from "@/test/harness";
import { WeekView } from "./WeekView";

polyfillDom();

beforeEach(async () => {
  await seededStore();
  useStore.setState({ view: "week" });
});
afterEach(cleanup);

describe("WeekView", () => {
  it("has one header per day, past days locked, and opens a day on click", () => {
    render(<WeekView />);
    const headers = screen.getAllByRole("button", { name: /in Day view$/ });
    expect(headers.map((h) => h.getAttribute("aria-label"))).toEqual([
      "Open Mon 19 in Day view",
      "Open Tue 20 in Day view",
      "Open Wed 21 in Day view",
      "Open Thu 22 in Day view",
      "Open Fri 23 in Day view",
      "Open Sat 24 in Day view",
      "Open Sun 25 in Day view",
    ]);
    // Mon and Tue are past: their plans are locked.
    expect(screen.getAllByRole("button", { name: "Unlock past plan" })).toHaveLength(2);
    fireEvent.click(headers[4]!);
    expect(useStore.getState()).toMatchObject({ view: "day", cursor: "2026-10-23" });
  });

  it("shows an Actual lane only up to today", () => {
    const { container } = render(<WeekView />);
    const lanes = [...container.querySelectorAll("[data-col-key]")].map((e) => e.getAttribute("data-col-key"));
    expect(lanes.filter((k) => k!.endsWith(":actual"))).toEqual(["2026-10-19:actual", "2026-10-20:actual", "2026-10-21:actual"]);
    expect(lanes.filter((k) => k!.endsWith(":plan"))).toHaveLength(7);
  });
});
