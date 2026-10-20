// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { openEditor } from "@/state/ui";
import { useStore } from "@/state/store";
import { NOW, polyfillDom, seededStore } from "@/test/harness";
import { BlockPopover } from "./BlockPopover";

polyfillDom();

const planAt = (start: number) =>
  Object.values(useStore.getState().data.blocks).find((b) => b.day === NOW.day && b.layer === "plan" && b.startMinute === start)!;

beforeEach(async () => {
  await seededStore();
});
afterEach(cleanup);

describe("BlockPopover time fields", () => {
  it("lists end-time slots with durations and commits a picked slot", async () => {
    const b = planAt(840); // 14:00–16:00
    openEditor({ kind: "block", id: b.id });
    render(<BlockPopover />);
    const end = await screen.findByRole("combobox", { name: "End time" });
    fireEvent.focus(end);
    const list = screen.getByRole("listbox", { name: "End time options" });
    const options = list.querySelectorAll('[role="option"]');
    expect(options[0]!.textContent).toBe("14:1515m");
    // The current end is highlighted.
    expect(list.querySelector('[aria-selected="true"]')!.textContent).toMatch(/^16:00/);
    fireEvent.click(screen.getByRole("option", { name: /^17:00/ }));
    expect(useStore.getState().data.blocks[b.id]).toMatchObject({ startMinute: 840, endMinute: 1020 });
  });

  it("typing a start keeps the duration; arrows walk the slots", async () => {
    const b = planAt(840);
    openEditor({ kind: "block", id: b.id });
    render(<BlockPopover />);
    const start = await screen.findByRole("combobox", { name: "Start time" });
    fireEvent.focus(start);
    fireEvent.change(start, { target: { value: "930" } });
    fireEvent.keyDown(start, { key: "Enter" });
    expect(useStore.getState().data.blocks[b.id]).toMatchObject({ startMinute: 570, endMinute: 690 });

    // The field remounts with the committed value.
    const again = screen.getByRole("combobox", { name: "Start time" }) as HTMLInputElement;
    expect(again.value).toBe("09:30");
    fireEvent.focus(again);
    fireEvent.keyDown(again, { key: "ArrowDown" });
    expect(again.value).toBe("09:45");
    fireEvent.blur(again);
    expect(useStore.getState().data.blocks[b.id]).toMatchObject({ startMinute: 585, endMinute: 705 });
  });

  it("rejects an end before the start", async () => {
    const b = planAt(840);
    openEditor({ kind: "block", id: b.id });
    render(<BlockPopover />);
    const end = await screen.findByRole("combobox", { name: "End time" });
    fireEvent.change(end, { target: { value: "13:00" } });
    fireEvent.keyDown(end, { key: "Enter" });
    expect(end.getAttribute("aria-invalid")).toBe("true");
    expect(useStore.getState().data.blocks[b.id]!.endMinute).toBe(960);
  });

  it("shows and accepts 12-hour times when that format is set", async () => {
    useStore.setState((s) => ({ settings: { ...s.settings, timeFormat: "12h" } }));
    const b = planAt(840);
    openEditor({ kind: "block", id: b.id });
    render(<BlockPopover />);
    const end = await screen.findByRole("combobox", { name: "End time" });
    expect((end as HTMLInputElement).value).toBe("4:00 PM");
    fireEvent.focus(end);
    const list = screen.getByRole("listbox", { name: "End time options" });
    expect(list.querySelector('[role="option"]')!.textContent).toBe("2:15 PM15m");
    fireEvent.change(end, { target: { value: "5:30pm" } });
    fireEvent.keyDown(end, { key: "Enter" });
    expect(useStore.getState().data.blocks[b.id]).toMatchObject({ startMinute: 840, endMinute: 1050 });

    // 24-hour input still works in 12-hour mode.
    const again = screen.getByRole("combobox", { name: "End time" }) as HTMLInputElement;
    expect(again.value).toBe("5:30 PM");
    fireEvent.change(again, { target: { value: "18:00" } });
    fireEvent.keyDown(again, { key: "Enter" });
    expect(useStore.getState().data.blocks[b.id]!.endMinute).toBe(1080);
  });
});
