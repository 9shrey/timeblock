import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { exportFileName, serializeExport, toExportFile } from "./format";
import { parseImportFile, type ImportResult } from "./schema";
import { settingRow } from "../settings";
import type { Block, ChecklistItem, ExportData, Goal, Routine, Template, WeekNote, WeekTarget } from "../types";

const meta = { appVersion: "0.1.0", exportedAt: 1_760_000_000_000 };

const goal = (id: string, over: Partial<Goal> = {}): Goal => ({
  id,
  name: `Goal ${id}`,
  color: "#3366cc",
  kind: "min",
  trackBy: "time",
  sortOrder: 0,
  archivedOn: null,
  createdAt: 1,
  updatedAt: 2,
  ...over,
});

const block = (id: string, over: Partial<Block> = {}): Block => ({
  id,
  day: "2026-10-19",
  layer: "plan",
  startMinute: 540,
  endMinute: 600,
  title: "",
  goalId: null,
  notes: "",
  planBlockId: null,
  skipped: false,
  routineId: null,
  createdAt: 1,
  updatedAt: 2,
  ...over,
});

const target = (goalId: string, weekStart: string, over: Partial<WeekTarget> = {}): WeekTarget => ({
  goalId,
  weekStart,
  targetMinutes: 600,
  targetCount: null,
  updatedAt: 2,
  ...over,
});

const item = (id: string, goalId: string, over: Partial<ChecklistItem> = {}): ChecklistItem => ({
  id,
  goalId,
  weekStart: "2026-10-19",
  text: `Item ${id}`,
  done: false,
  sortOrder: 0,
  carriedFromId: null,
  createdAt: 1,
  updatedAt: 2,
  ...over,
});

const note = (weekStart: string, over: Partial<WeekNote> = {}): WeekNote => ({
  weekStart,
  text: "note",
  updatedAt: 2,
  ...over,
});

const template = (id: string, over: Partial<Template> = {}): Template => ({
  id,
  name: `Template ${id}`,
  spanDays: 1,
  blocks: [{ dayOffset: 0, startMinute: 540, endMinute: 600, title: "Block", goalId: null, notes: "" }],
  createdAt: 1,
  updatedAt: 2,
  ...over,
});

const routine = (id: string, over: Partial<Routine> = {}): Routine => ({
  id,
  title: `Routine ${id}`,
  goalId: null,
  notes: "",
  startMinute: 540,
  endMinute: 600,
  weekdays: 0b0111110,
  startsOn: "2026-10-19",
  endsOn: null,
  materializedThrough: null,
  createdAt: 1,
  updatedAt: 2,
  ...over,
});

const empty = (): ExportData => ({
  settings: [],
  goals: [],
  weekTargets: [],
  checklistItems: [],
  templates: [],
  routines: [],
  blocks: [],
  weekNotes: [],
});

/** A realistic data set with Monday weeks. */
const sample = (): ExportData => ({
  settings: [settingRow("weekStartDay", 1), settingRow("snapMinutes", 15)],
  goals: [goal("g2", { kind: "max", archivedOn: "2026-10-01" }), goal("g1", { name: "Deep work 🚀" })],
  weekTargets: [target("g1", "2026-10-19"), target("g1", "2026-10-12", { targetMinutes: null })],
  checklistItems: [item("c2", "g1", { done: true, carriedFromId: "c1" }), item("c1", "g2", { weekStart: "2026-10-12" })],
  templates: [template("t1"), template("t2", { spanDays: 7, name: "Week template" })],
  routines: [routine("r1", { goalId: "g1" })],
  blocks: [
    block("b3", { layer: "actual", planBlockId: "b1", goalId: "g1", notes: "went well" }),
    block("b1", { goalId: "g1", title: "Write", routineId: "r1" }),
    block("b2", { skipped: true, startMinute: 0, endMinute: 1440 }),
  ],
  weekNotes: [note("2026-10-19"), note("2026-10-12", { text: "" })],
});

const fileText = (data: ExportData) => serializeExport(toExportFile(data, meta));

function expectOk(r: ImportResult): Extract<ImportResult, { ok: true }> {
  if (!r.ok) throw new Error(`expected ok, got: ${r.errors.join("; ")}`);
  return r;
}

function expectErr(r: ImportResult): string[] {
  if (r.ok) throw new Error("expected an error");
  return r.errors;
}

/** Serializes a raw (possibly invalid) envelope. */
const rawFile = (data: unknown, over: Record<string, unknown> = {}) =>
  JSON.stringify({ format: "timeblock.export", version: 1, exportedAt: 1, appVersion: "x", ...(data as object), ...over });

describe("toExportFile / serializeExport", () => {
  it("builds a v3 envelope with sorted arrays", () => {
    const f = toExportFile(sample(), meta);
    expect(f.format).toBe("timeblock.export");
    expect(f.version).toBe(3);
    expect(f.exportedAt).toBe(meta.exportedAt);
    expect(f.appVersion).toBe("0.1.0");
    expect(f.goals.map((g) => g.id)).toEqual(["g1", "g2"]);
    expect(f.blocks.map((b) => b.id)).toEqual(["b1", "b2", "b3"]);
    expect(f.templates.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(f.routines.map((r) => r.id)).toEqual(["r1"]);
    expect(f.weekTargets.map((t) => t.weekStart)).toEqual(["2026-10-12", "2026-10-19"]);
    expect(f.weekNotes.map((n) => n.weekStart)).toEqual(["2026-10-12", "2026-10-19"]);
    expect(f.settings.map((s) => s.key)).toEqual(["snapMinutes", "weekStartDay"]);
  });

  it("uses a stable key order regardless of input key order", () => {
    const g = goal("g1");
    const shuffled = Object.fromEntries(Object.entries(g).reverse()) as unknown as Goal;
    const a = fileText({ ...empty(), goals: [g] });
    const b = fileText({ ...empty(), goals: [shuffled] });
    expect(a).toBe(b);
    expect(Object.keys(toExportFile(empty(), meta))).toEqual([
      "format",
      "version",
      "exportedAt",
      "appVersion",
      "settings",
      "goals",
      "weekTargets",
      "checklistItems",
      "templates",
      "routines",
      "blocks",
      "weekNotes",
    ]);
  });

  it("does not mutate its input", () => {
    const data = sample();
    const before = structuredClone(data);
    toExportFile(data, meta);
    expect(data).toEqual(before);
  });

  it("is deterministic under any input order", () => {
    const base = sample();
    const expected = fileText(base);
    fc.assert(
      fc.property(
        fc.shuffledSubarray(base.blocks, { minLength: 3, maxLength: 3 }),
        fc.shuffledSubarray(base.goals, { minLength: 2, maxLength: 2 }),
        fc.shuffledSubarray(base.weekTargets, { minLength: 2, maxLength: 2 }),
        (blocks, goals, weekTargets) => {
          expect(fileText({ ...base, blocks, goals, weekTargets })).toBe(expected);
        },
      ),
    );
  });

  it("serializes with 2-space indent and a trailing newline", () => {
    const s = fileText(empty());
    expect(s.endsWith("}\n")).toBe(true);
    expect(s).toContain('\n  "format": "timeblock.export"');
  });

  it("names files by day", () => {
    expect(exportFileName("2026-10-19")).toBe("timeblock-export-2026-10-19.json");
  });
});

describe("parseImportFile", () => {
  it("round-trips exactly with no warnings", () => {
    const r = expectOk(parseImportFile(fileText(sample())));
    const { format: _f, version: _v, exportedAt: _e, appVersion: _a, ...data } = toExportFile(sample(), meta);
    expect(r.data).toEqual(data);
    expect(r.warnings).toEqual([]);
    expect(r.counts).toEqual({
      settings: 2,
      goals: 2,
      weekTargets: 2,
      checklistItems: 2,
      templates: 2,
      routines: 1,
      blocks: 3,
      weekNotes: 2,
    });
    // And re-exporting the parsed data gives the same bytes.
    expect(fileText(r.data)).toBe(fileText(sample()));
  });

  it("round-trips an empty export", () => {
    const r = expectOk(parseImportFile(fileText(empty())));
    expect(r.data).toEqual(empty());
    expect(r.warnings).toEqual([]);
  });

  it("rejects files from a newer version", () => {
    const errors = expectErr(parseImportFile(rawFile(empty(), { version: 4 })));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/newer version of Timeblock/);
  });

  it("rejects other versions", () => {
    expect(expectErr(parseImportFile(rawFile(empty(), { version: 0 })))[0]).toMatch(/Unsupported export version/);
    expect(expectErr(parseImportFile(rawFile(empty(), { version: "1" })))[0]).toMatch(/Unsupported export version/);
    expect(expectErr(parseImportFile(rawFile(empty(), { version: undefined })))[0]).toMatch(/missing/);
  });

  it("rejects bad JSON and non-exports", () => {
    expect(expectErr(parseImportFile("{not json"))[0]).toMatch(/not valid JSON/);
    expect(expectErr(parseImportFile(""))[0]).toMatch(/not valid JSON/);
    expect(expectErr(parseImportFile("[]"))[0]).toMatch(/not a Timeblock export/);
    expect(expectErr(parseImportFile("null"))[0]).toMatch(/not a Timeblock export/);
    expect(expectErr(parseImportFile(rawFile(empty(), { format: "other" })))[0]).toMatch(/not a Timeblock export/);
  });

  it("rejects invalid rows with readable paths", () => {
    const cases: [Partial<ExportData> | Record<string, unknown>, RegExp][] = [
      [{ goals: [goal("g1", { name: "" })] }, /^goals\[0\]\.name: /],
      [{ goals: [goal("g1", { name: "x".repeat(81) })] }, /^goals\[0\]\.name: /],
      [{ goals: [goal("g1", { color: "red" })] }, /^goals\[0\]\.color: /],
      [{ goals: [goal("g1", { kind: "most" as never })] }, /^goals\[0\]\.kind: /],
      [{ goals: [goal("g1", { archivedOn: "2026-02-30" })] }, /^goals\[0\]\.archivedOn: /],
      [{ goals: [goal("g1", { createdAt: 1.5 })] }, /^goals\[0\]\.createdAt: /],
      [{ blocks: [block("b1", { endMinute: 540 })] }, /^blocks\[0\]\.endMinute: /],
      [{ blocks: [block("b1", { startMinute: 1440, endMinute: 1441 })] }, /^blocks\[0\]\.startMinute: /],
      [{ blocks: [block("b1", { layer: "both" as never })] }, /^blocks\[0\]\.layer: /],
      [{ blocks: [block("b1", { day: "19/10/2026" })] }, /^blocks\[0\]\.day: /],
      [{ blocks: [block("b1", { skipped: 0 as never })] }, /^blocks\[0\]\.skipped: /],
      [{ goals: [goal("g1")], weekTargets: [target("g1", "2026-10-19", { targetMinutes: 10081 })] }, /^weekTargets\[0\]\.targetMinutes: /],
      [{ goals: [goal("g1")], checklistItems: [item("c1", "g1", { text: "" })] }, /^checklistItems\[0\]\.text: /],
      [{ goals: [goal("g1")], checklistItems: [item("c1", "g1", { done: 1 as never })] }, /^checklistItems\[0\]\.done: /],
      [{ weekNotes: "nope" }, /^weekNotes: /],
      [{ exportedAt: "today" }, /^exportedAt: /],
    ];
    for (const [over, re] of cases) {
      const errors = expectErr(parseImportFile(rawFile({ ...empty(), ...over })));
      expect(errors.some((e) => re.test(e)), `${JSON.stringify(over)} → ${errors.join("; ")}`).toBe(true);
    }
  });

  it("accepts names counted in code points (80 emoji)", () => {
    expectOk(parseImportFile(fileText({ ...empty(), goals: [goal("g1", { name: "🚀".repeat(80) })] })));
  });

  it("rejects a missing table", () => {
    const { weekNotes: _w, ...rest } = empty();
    expect(expectErr(parseImportFile(rawFile(rest)))[0]).toMatch(/^weekNotes: /);
  });

  it("caps the number of error messages", () => {
    const goals = Array.from({ length: 50 }, (_, i) => goal(`g${i}`, { color: "bad" }));
    const errors = expectErr(parseImportFile(rawFile({ ...empty(), goals })));
    expect(errors).toHaveLength(21);
    expect(errors[20]).toMatch(/and 30 more/);
  });

  it("rejects duplicate primary keys", () => {
    const dupes: Partial<ExportData>[] = [
      { goals: [goal("g1"), goal("g1")] },
      { blocks: [block("b1"), block("b1")] },
      { goals: [goal("g1")], weekTargets: [target("g1", "2026-10-19"), target("g1", "2026-10-19")] },
      { weekNotes: [note("2026-10-19"), note("2026-10-19")] },
      { settings: [settingRow("theme", "dark"), settingRow("theme", "light")] },
      { goals: [goal("g1")], checklistItems: [item("c1", "g1"), item("c1", "g1")] },
    ];
    for (const over of dupes) {
      const errors = expectErr(parseImportFile(rawFile({ ...empty(), ...over })));
      expect(errors[0]).toMatch(/duplicate key/);
    }
  });

  describe("repairs", () => {
    const parse = (over: Partial<ExportData>) => expectOk(parseImportFile(rawFile({ ...empty(), ...over })));

    it("clears a dangling goalId", () => {
      const r = parse({ blocks: [block("b1", { goalId: "ghost" })] });
      expect(r.data.blocks[0]?.goalId).toBeNull();
      expect(r.warnings).toEqual([expect.stringMatching(/1 block referenced a missing goal/)]);
    });

    it("clears a dangling planBlockId", () => {
      const r = parse({ blocks: [block("a1", { layer: "actual", planBlockId: "nope" })] });
      expect(r.data.blocks[0]?.planBlockId).toBeNull();
      expect(r.warnings).toHaveLength(1);
    });

    it("clears a planBlockId pointing at an actual block", () => {
      const r = parse({
        blocks: [block("a1", { layer: "actual" }), block("a2", { layer: "actual", planBlockId: "a1" })],
      });
      expect(r.data.blocks.find((b) => b.id === "a2")?.planBlockId).toBeNull();
      expect(r.warnings).toHaveLength(1);
    });

    it("clears a planBlockId pointing at another day's plan block", () => {
      const r = parse({
        blocks: [block("p1", { day: "2026-10-18" }), block("a1", { layer: "actual", planBlockId: "p1" })],
      });
      expect(r.data.blocks.find((b) => b.id === "a1")?.planBlockId).toBeNull();
      expect(r.warnings).toHaveLength(1);
    });

    it("keeps a valid same-day link", () => {
      const r = parse({ blocks: [block("p1"), block("a1", { layer: "actual", planBlockId: "p1" })] });
      expect(r.data.blocks.find((b) => b.id === "a1")?.planBlockId).toBe("p1");
      expect(r.warnings).toEqual([]);
    });

    it("clears planBlockId on a plan block", () => {
      const r = parse({ blocks: [block("p1"), block("p2", { planBlockId: "p1" })] });
      expect(r.data.blocks.find((b) => b.id === "p2")?.planBlockId).toBeNull();
      expect(r.warnings).toEqual([expect.stringMatching(/plan block had a plan link/)]);
    });

    it("clears skipped on an actual block", () => {
      const r = parse({ blocks: [block("a1", { layer: "actual", skipped: true })] });
      expect(r.data.blocks[0]?.skipped).toBe(false);
      expect(r.warnings).toEqual([expect.stringMatching(/skipped/)]);
    });

    it("drops week targets and checklist items of missing goals", () => {
      const r = parse({
        goals: [goal("g1")],
        weekTargets: [target("g1", "2026-10-19"), target("gone", "2026-10-19")],
        checklistItems: [item("c1", "g1"), item("c2", "gone"), item("c3", "gone")],
      });
      expect(r.data.weekTargets.map((t) => t.goalId)).toEqual(["g1"]);
      expect(r.data.checklistItems.map((c) => c.id)).toEqual(["c1"]);
      expect(r.counts.weekTargets).toBe(1);
      expect(r.counts.checklistItems).toBe(1);
      expect(r.warnings).toEqual([
        expect.stringMatching(/1 week target referenced a missing goal and was dropped/),
        expect.stringMatching(/2 checklist items referenced a missing goal and were dropped/),
      ]);
    });

    it("reports several repairs at once", () => {
      const r = parse({
        blocks: [block("p1", { goalId: "x", planBlockId: "y" }), block("a1", { layer: "actual", skipped: true })],
      });
      expect(r.warnings).toHaveLength(3);
      expect(r.data.blocks).toEqual([block("a1", { layer: "actual" }), block("p1")]);
    });
  });

  describe("week-key normalization", () => {
    const parse = (over: Partial<ExportData>) => expectOk(parseImportFile(rawFile({ ...empty(), ...over })));

    it("maps keys to the configured week start (Sunday)", () => {
      // 2026-10-19 is a Monday; Sunday weeks start on 2026-10-18.
      const r = parse({
        settings: [settingRow("weekStartDay", 0)],
        goals: [goal("g1")],
        weekTargets: [target("g1", "2026-10-19")],
        checklistItems: [item("c1", "g1", { weekStart: "2026-10-21" })],
        weekNotes: [note("2026-10-24")],
      });
      expect(r.data.weekTargets[0]?.weekStart).toBe("2026-10-18");
      expect(r.data.checklistItems[0]?.weekStart).toBe("2026-10-18");
      expect(r.data.weekNotes[0]?.weekStart).toBe("2026-10-18");
      expect(r.warnings).toEqual([expect.stringMatching(/3 week entries .* realigned/)]);
    });

    it("defaults to Monday weeks when settings are missing or invalid", () => {
      const r = parse({
        settings: [{ key: "weekStartDay", value: "\"tuesday\"" }],
        weekNotes: [note("2026-10-18")],
      });
      expect(r.data.weekNotes[0]?.weekStart).toBe("2026-10-12");
    });

    it("keeps already-aligned keys untouched without warnings", () => {
      const r = parse({ settings: [settingRow("weekStartDay", 6)], weekNotes: [note("2026-10-17")] });
      expect(r.data.weekNotes[0]?.weekStart).toBe("2026-10-17");
      expect(r.warnings).toEqual([]);
    });

    it("keeps the newest target when two collide", () => {
      const r = parse({
        goals: [goal("g1"), goal("g2")],
        weekTargets: [
          target("g1", "2026-10-19", { targetMinutes: 100, updatedAt: 5 }),
          target("g1", "2026-10-21", { targetMinutes: 200, updatedAt: 9 }),
          target("g1", "2026-10-22", { targetMinutes: 300, updatedAt: 7 }),
          target("g2", "2026-10-21", { targetMinutes: 400 }),
        ],
      });
      expect(r.data.weekTargets).toEqual([
        target("g1", "2026-10-19", { targetMinutes: 200, updatedAt: 9 }),
        target("g2", "2026-10-19", { targetMinutes: 400 }),
      ]);
      expect(r.warnings.some((w) => /2 week targets collided/.test(w))).toBe(true);
    });

    it("keeps the newest note when two collide", () => {
      const r = parse({
        weekNotes: [note("2026-10-20", { text: "new", updatedAt: 10 }), note("2026-10-19", { text: "old", updatedAt: 3 })],
      });
      expect(r.data.weekNotes).toEqual([note("2026-10-19", { text: "new", updatedAt: 10 })]);
      expect(r.warnings.some((w) => /1 week note collided/.test(w))).toBe(true);
    });

    it("returns sorted data even from an unsorted file", () => {
      const r = parse({ goals: [goal("b"), goal("a"), goal("c")], blocks: [block("z"), block("y")] });
      expect(r.data.goals.map((g) => g.id)).toEqual(["a", "b", "c"]);
      expect(r.data.blocks.map((b) => b.id)).toEqual(["y", "z"]);
    });
  });

  describe("version compatibility", () => {
    it("imports a genuine v1 file (no templates/routines/routineId), defaulting them", () => {
      // A hand-built v1 envelope: no `templates`, `routines`, or `blocks[].routineId`.
      const v1 = {
        format: "timeblock.export",
        version: 1,
        exportedAt: 1,
        appVersion: "0.1.0",
        settings: [],
        goals: [{ id: "g1", name: "Thesis", color: "#2563eb", kind: "min", sortOrder: 0, archivedOn: null, createdAt: 1, updatedAt: 1 }],
        weekTargets: [{ goalId: "g1", weekStart: "2026-10-19", targetMinutes: 600, updatedAt: 1 }],
        checklistItems: [],
        blocks: [
          {
            id: "b1",
            day: "2026-10-19",
            layer: "plan",
            startMinute: 540,
            endMinute: 600,
            title: "Write",
            goalId: "g1",
            notes: "",
            planBlockId: null,
            skipped: false,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        weekNotes: [],
      };
      const r = expectOk(parseImportFile(JSON.stringify(v1)));
      expect(r.data.templates).toEqual([]);
      expect(r.data.routines).toEqual([]);
      expect(r.data.blocks).toEqual([block("b1", { goalId: "g1", title: "Write", createdAt: 1, updatedAt: 1 })]);
      expect(r.data.goals[0]?.trackBy).toBe("time");
      expect(r.data.weekTargets[0]?.targetCount).toBeNull();
      expect(r.warnings).toEqual([]);
      expect(r.counts.templates).toBe(0);
      expect(r.counts.routines).toBe(0);
    });

    it("imports a genuine v2 file (no trackBy/targetCount), defaulting them", () => {
      // A hand-built v2 envelope: templates/routines/routineId exist, but goals/weekTargets
      // predate trackBy/targetCount.
      const v2 = {
        format: "timeblock.export",
        version: 2,
        exportedAt: 1,
        appVersion: "0.1.0",
        settings: [],
        goals: [{ id: "g1", name: "Thesis", color: "#2563eb", kind: "min", sortOrder: 0, archivedOn: null, createdAt: 1, updatedAt: 1 }],
        weekTargets: [{ goalId: "g1", weekStart: "2026-10-19", targetMinutes: 600, updatedAt: 1 }],
        checklistItems: [],
        templates: [],
        routines: [],
        blocks: [
          {
            id: "b1",
            day: "2026-10-19",
            layer: "plan",
            startMinute: 540,
            endMinute: 600,
            title: "Write",
            goalId: "g1",
            notes: "",
            planBlockId: null,
            skipped: false,
            routineId: null,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        weekNotes: [],
      };
      const r = expectOk(parseImportFile(JSON.stringify(v2)));
      expect(r.data.goals[0]?.trackBy).toBe("time");
      expect(r.data.weekTargets[0]?.targetCount).toBeNull();
      expect(r.warnings).toEqual([]);
    });

    it("round-trips a v3 export with templates, routines and routineId", () => {
      const data = sample();
      const file = toExportFile(data, meta);
      expect(file.version).toBe(3);
      const r = expectOk(parseImportFile(serializeExport(file)));
      const { format: _f, version: _v, exportedAt: _e, appVersion: _a, ...expected } = file;
      expect(r.data).toEqual(expected);
      expect(r.warnings).toEqual([]);
      expect(r.data.blocks.find((b) => b.id === "b1")?.routineId).toBe("r1");
      expect(serializeExport(toExportFile(r.data, meta))).toBe(serializeExport(file));
    });

    it("clears a dangling routineId and a routine's dangling goalId on import", () => {
      const r = expectOk(
        parseImportFile(
          rawFile(
            {
              ...empty(),
              routines: [routine("r1", { goalId: "ghost" })],
              blocks: [block("b1", { routineId: "nope" }), block("b2", { layer: "actual", routineId: "r1" })],
            },
            { version: 2 },
          ),
        ),
      );
      expect(r.data.routines[0]?.goalId).toBeNull();
      expect(r.data.blocks.find((b) => b.id === "b1")?.routineId).toBeNull();
      expect(r.data.blocks.find((b) => b.id === "b2")?.routineId).toBeNull();
      expect(r.warnings.some((w) => /routine referenced a missing goal/.test(w))).toBe(true);
      expect(r.warnings.some((w) => /referenced a missing routine or was not a plan block/.test(w))).toBe(true);
    });

    it("clears a dangling goalId in a template block", () => {
      const r = expectOk(
        parseImportFile(
          rawFile(
            { ...empty(), templates: [template("t1", { blocks: [{ dayOffset: 0, startMinute: 0, endMinute: 60, title: "x", goalId: "ghost", notes: "" }] })] },
            { version: 2 },
          ),
        ),
      );
      expect(r.data.templates[0]?.blocks[0]?.goalId).toBeNull();
      expect(r.warnings).toEqual([expect.stringMatching(/1 template block referenced a missing goal/)]);
    });
  });
});
