// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { IcsEvent } from "@/domain/ics/parse";
import { polyfillDom, seededStore } from "@/test/harness";
import { useIcsOverlay } from "@/state/ics";
import { IcsOverlay } from "./IcsOverlay";

polyfillDom();

const DAY = "2026-10-21";

const event = (over: Partial<IcsEvent> = {}): IcsEvent => ({ id: "e1", title: "Standup", day: DAY, startMinute: 540, endMinute: 570, allDay: false, ...over });

beforeEach(async () => {
  await seededStore();
  useIcsOverlay.setState({ events: [], fileName: null });
});
afterEach(cleanup);

describe("IcsOverlay", () => {
  it("renders nothing when there are no imported events for the day", () => {
    const { container } = render(<IcsOverlay day={DAY} />);
    expect(container.innerHTML).toBe("");
  });

  // A selector that returns a new array identity on every call breaks useSyncExternalStore
  // (React throws "Maximum update depth exceeded" and the whole app fails to render).
  it("renders imported events without an infinite update loop", () => {
    useIcsOverlay.setState({ events: [event()], fileName: "test.ics" });
    render(<IcsOverlay day={DAY} />);
    expect(screen.getByText("Standup")).toBeTruthy();
  });

  it("shows only events for the given day", () => {
    useIcsOverlay.setState({ events: [event(), event({ id: "e2", title: "Other day", day: "2026-10-22" })], fileName: "test.ics" });
    render(<IcsOverlay day={DAY} />);
    expect(screen.getByText("Standup")).toBeTruthy();
    expect(screen.queryByText("Other day")).toBeNull();
  });
});
