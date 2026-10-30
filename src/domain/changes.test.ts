import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { applyChanges, compactChanges, del, emptyState, invertChanges, put, stateFrom } from "./changes";
import type { Block, Change, Goal } from "./types";
import { parseSettings, settingRow, DEFAULT_SETTINGS } from "./settings";

const block = (id: string, start: number, title = ""): Block => ({
  id,
  day: "2026-10-19",
  layer: "plan",
  startMinute: start,
  endMinute: start + 60,
  title,
  goalId: null,
  notes: "",
  planBlockId: null,
  skipped: false,
  routineId: null,
  createdAt: 0,
  updatedAt: 0,
});

const goal = (id: string): Goal => ({
  id,
  name: id,
  color: "#000000",
  kind: "min",
  trackBy: "time", activeDays: 127,
  sortOrder: 0,
  archivedOn: null,
  createdAt: 0,
  updatedAt: 0,
});

describe("applyChanges", () => {
  it("puts and deletes, without mutating the input", () => {
    const s0 = stateFrom({ blocks: [block("a", 60)] });
    const s1 = applyChanges(s0, [put("blocks", block("b", 120)), del("blocks", "a")]);
    expect(Object.keys(s1.blocks)).toEqual(["b"]);
    expect(Object.keys(s0.blocks)).toEqual(["a"]);
    expect(s1.goals).toBe(s0.goals);
  });

  it("keys week targets by goal and week", () => {
    const s = applyChanges(emptyState(), [
      put("weekTargets", { goalId: "g", weekStart: "2026-10-19", targetMinutes: 60, targetCount: null, updatedAt: 0 }),
    ]);
    expect(Object.keys(s.weekTargets)).toEqual(["g|2026-10-19"]);
  });
});

const arbChange: fc.Arbitrary<Change> = fc.oneof(
  fc
    .tuple(fc.constantFrom("a", "b", "c", "d"), fc.integer({ min: 0, max: 1000 }), fc.string())
    .map(([id, s, t]) => put("blocks", block(id, s, t))),
  fc.constantFrom("a", "b", "c", "d").map((id) => del("blocks", id)),
  fc.constantFrom("g1", "g2").map((id) => put("goals", goal(id))),
  fc.constantFrom("g1", "g2", "zz").map((id) => del("goals", id)),
);

describe("invertChanges", () => {
  it("apply(apply(s, cs), invert(s, cs)) == s", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom("a", "b", "c")),
        fc.array(arbChange, { maxLength: 15 }),
        (ids, cs) => {
          const s = stateFrom({ blocks: [...new Set(ids)].map((id, i) => block(id, i * 60)), goals: [goal("g1")] });
          const after = applyChanges(s, cs);
          expect(applyChanges(after, invertChanges(s, cs))).toEqual(s);
        },
      ),
    );
  });

  it("compactChanges has the same net effect", () => {
    fc.assert(
      fc.property(fc.array(arbChange, { maxLength: 15 }), (cs) => {
        const s = stateFrom({ blocks: [block("a", 0)] });
        expect(applyChanges(s, compactChanges(cs))).toEqual(applyChanges(s, cs));
      }),
    );
  });
});

describe("settings", () => {
  it("defaults, parses and ignores bad values", () => {
    expect(parseSettings([])).toEqual(DEFAULT_SETTINGS);
    const s = parseSettings([
      settingRow("weekStartDay", 0),
      { key: "snapMinutes", value: "7" },
      { key: "theme", value: "not json" },
      { key: "unknown", value: "1" },
    ]);
    expect(s.weekStartDay).toBe(0);
    expect(s.snapMinutes).toBe(15);
    expect(s.theme).toBe("system");
  });
});
