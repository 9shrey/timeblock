import { describe, expect, it } from "vitest";
import { put } from "@/domain/changes";
import type { SettingRow } from "@/domain/types";
import { emptyHistory, HISTORY_LIMIT, popRedo, popUndo, record } from "./history";

const row = (value: string): SettingRow => ({ key: "k", value });
const entry = (from: string, to: string, coalesceKey?: string) => ({
  forward: [put("settings", row(to))],
  inverse: [put("settings", row(from))],
  label: `${from}→${to}`,
  coalesceKey,
});

describe("history", () => {
  it("coalesces same-key entries: forward keeps the newest value, inverse the oldest", () => {
    let h = record(emptyHistory(), entry("a", "b", "k"));
    h = record(h, entry("b", "c", "k"));
    expect(h.undo).toHaveLength(1);
    expect(h.undo[0]!.forward).toEqual([put("settings", row("c"))]);
    expect(h.undo[0]!.inverse).toEqual([put("settings", row("a"))]);
    h = record(h, entry("c", "d", "other"));
    expect(h.undo).toHaveLength(2);
  });

  it("undo/redo move entries between stacks; a new entry clears redo", () => {
    let h = record(record(emptyHistory(), entry("a", "b")), entry("b", "c"));
    const u = popUndo(h)!;
    expect(u.entry.label).toBe("b→c");
    h = u.history;
    expect(popRedo(h)!.entry.label).toBe("b→c");
    h = record(h, entry("b", "x"));
    expect(h.redo).toEqual([]);
    expect(popRedo(h)).toBeNull();
    expect(popUndo(emptyHistory())).toBeNull();
  });

  it("keeps at most HISTORY_LIMIT entries", () => {
    let h = emptyHistory();
    for (let i = 0; i < HISTORY_LIMIT + 3; i++) h = record(h, entry(String(i), String(i + 1)));
    expect(h.undo).toHaveLength(HISTORY_LIMIT);
    expect(h.undo[0]!.label).toBe("3→4");
  });
});
