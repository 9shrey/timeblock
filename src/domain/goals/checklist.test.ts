import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { applyChanges, stateFrom } from "../changes";
import { testEnv } from "../env";
import type { ChecklistItem } from "../types";
import { addItem, carryableCount, carryOver, deleteItem, progress, reorderItemsChanges, updateItem } from "./checklist";

const W1 = "2026-10-12";
const W2 = "2026-10-19";

const item = (id: string, goalId: string, weekStart: string, done: boolean, sortOrder = 0): ChecklistItem => ({
  id,
  goalId,
  weekStart,
  text: `text ${id}`,
  done,
  sortOrder,
  carriedFromId: null,
  createdAt: 0,
  updatedAt: 0,
});

describe("progress", () => {
  it("counts done and total", () => {
    expect(progress([])).toEqual({ done: 0, total: 0 });
    expect(progress([item("a", "g", W1, true), item("b", "g", W1, false)])).toEqual({ done: 1, total: 2 });
  });
});

describe("addItem / updateItem / deleteItem", () => {
  it("appends a trimmed item within its goal and week", () => {
    const existing = [item("a", "g", W1, false, 4), item("b", "g", W2, false, 9), item("c", "h", W1, false, 7)];
    const { item: it1, changes } = addItem("g", W1, "  read ch. 3 ", existing, testEnv(7));
    expect(it1).toEqual({
      id: "id1",
      goalId: "g",
      weekStart: W1,
      text: "read ch. 3",
      done: false,
      sortOrder: 5,
      carriedFromId: null,
      createdAt: 7,
      updatedAt: 7,
    });
    expect(changes).toEqual([{ op: "put", table: "checklistItems", row: it1 }]);
    expect(addItem("z", W1, "x", existing, testEnv()).item.sortOrder).toBe(0);
  });

  it("updates and deletes", () => {
    const a = item("a", "g", W1, false);
    expect(updateItem(a, { done: true, text: " t " }, testEnv(3))).toEqual([
      { op: "put", table: "checklistItems", row: { ...a, done: true, text: "t", updatedAt: 3 } },
    ]);
    expect(a.done).toBe(false);
    expect(deleteItem(a)).toEqual([{ op: "del", table: "checklistItems", key: "a" }]);
  });
});

describe("carryOver", () => {
  const items = [
    item("a", "g", W1, false, 0),
    item("b", "g", W1, true, 1),
    item("c", "h", W1, false, 0),
    item("d", "g", W2, false, 3),
  ];

  it("copies unfinished items with carriedFromId, appended per goal", () => {
    const changes = carryOver(items, W1, W2, testEnv(5));
    const rows = changes.map((c) => (c.op === "put" ? c.row : null));
    expect(rows).toEqual([
      { ...item("id1", "g", W2, false, 4), text: "text a", carriedFromId: "a", createdAt: 5, updatedAt: 5 },
      { ...item("id2", "h", W2, false, 0), text: "text c", carriedFromId: "c", createdAt: 5, updatedAt: 5 },
    ]);
    expect(carryableCount(items, W1, W2)).toBe(2);
  });

  it("carrying over twice adds items once", () => {
    const env = testEnv();
    let state = stateFrom({ checklistItems: items });
    state = applyChanges(state, carryOver(Object.values(state.checklistItems), W1, W2, env));
    const once = Object.keys(state.checklistItems).length;
    const second = carryOver(Object.values(state.checklistItems), W1, W2, env);
    expect(second).toEqual([]);
    expect(once).toBe(items.length + 2);
    expect(carryableCount(Object.values(state.checklistItems), W1, W2)).toBe(0);
  });

  it("can be limited to one goal", () => {
    expect(carryableCount(items, W1, W2, "h")).toBe(1);
    const changes = carryOver(items, W1, W2, testEnv(), "h");
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ row: { goalId: "h", carriedFromId: "c" } });
  });

  it("carrying into the same week copies nothing, and the count agrees", () => {
    expect(carryOver(items, W1, W1, testEnv())).toEqual([]);
    expect(carryableCount(items, W1, W1)).toBe(0);
  });

  it("is idempotent for arbitrary item sets", () => {
    const arbItem = fc.record({ g: fc.constantFrom("g", "h"), w: fc.constantFrom(W1, W2), done: fc.boolean() });
    fc.assert(
      fc.property(fc.array(arbItem, { maxLength: 10 }), (specs) => {
        const list = specs.map((s, i) => item(`s${i}`, s.g, s.w, s.done, i));
        const env = testEnv();
        const s1 = applyChanges(stateFrom({ checklistItems: list }), carryOver(list, W1, W2, env));
        expect(carryOver(Object.values(s1.checklistItems), W1, W2, env)).toEqual([]);
      }),
    );
  });
});

describe("reorderItemsChanges", () => {
  it("writes sortOrder for the new order, skipping items already at that index", () => {
    const items = [item("a", "g", W1, false, 0), item("b", "g", W1, false, 1), item("c", "g", W1, false, 2)];
    const changes = reorderItemsChanges(items, ["c", "a", "b"], testEnv(5));
    expect(changes).toHaveLength(3);
    expect(changes).toContainEqual({ op: "put", table: "checklistItems", row: { ...items[0], sortOrder: 1, updatedAt: 5 } });
    expect(changes).toContainEqual({ op: "put", table: "checklistItems", row: { ...items[1], sortOrder: 2, updatedAt: 5 } });
    expect(changes).toContainEqual({ op: "put", table: "checklistItems", row: { ...items[2], sortOrder: 0, updatedAt: 5 } });
  });

  it("is a no-op when the order is unchanged", () => {
    const items = [item("a", "g", W1, false, 0), item("b", "g", W1, false, 1)];
    expect(reorderItemsChanges(items, ["a", "b"], testEnv())).toEqual([]);
  });
});
