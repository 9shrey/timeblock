import { describe, expect, it } from "vitest";
import { createRoutineChanges, deleteRoutineChanges, materializeRoutines, occursOn, updateRoutineChanges } from "./routines";
import { testEnv } from "./env";
import type { Block, Routine } from "./types";

const WEEKDAYS = 0b0111110; // Mon-Fri

const routine = (over: Partial<Routine> = {}): Routine => ({
  id: "r1",
  title: "Gym",
  goalId: "g1",
  notes: "",
  startMinute: 420,
  endMinute: 480,
  weekdays: WEEKDAYS,
  startsOn: "2026-10-01",
  endsOn: null,
  materializedThrough: null,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const block = (over: Partial<Block> = {}): Block => ({
  id: "b1",
  day: "2026-10-19",
  layer: "plan",
  startMinute: 420,
  endMinute: 480,
  title: "Gym",
  goalId: "g1",
  notes: "",
  planBlockId: null,
  skipped: false,
  routineId: "r1",
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe("occursOn", () => {
  it("checks the date range and the weekday bitmask", () => {
    const r = routine({ startsOn: "2026-10-19", endsOn: "2026-10-23" });
    expect(occursOn(r, "2026-10-18")).toBe(false); // before startsOn
    expect(occursOn(r, "2026-10-19")).toBe(true); // Monday
    expect(occursOn(r, "2026-10-24")).toBe(false); // Saturday, not in bitmask
    expect(occursOn(r, "2026-10-26")).toBe(false); // after endsOn (if it were a weekday)
  });

  it("with no endsOn, runs indefinitely", () => {
    const r = routine({ endsOn: null });
    expect(occursOn(r, "2027-01-04")).toBe(true); // a Monday, far in the future
  });
});

describe("materializeRoutines", () => {
  it("creates occurrences from startsOn (or today, whichever is later) up to the horizon", () => {
    const r = routine({ startsOn: "2026-10-19", materializedThrough: null });
    const now = { day: "2026-10-19", minute: 0 };
    const changes = materializeRoutines([r], [], "2026-10-25", now, testEnv());
    const created = changes.filter((c) => c.op === "put" && c.table === "blocks");
    // Mon 19, Tue 20, Wed 21, Thu 22, Fri 23 (5 weekdays in that range).
    expect(created).toHaveLength(5);
    expect(created.every((c) => c.op === "put" && c.row.routineId === "r1")).toBe(true);
    const routineUpdate = changes.find((c) => c.table === "routines");
    expect(routineUpdate).toMatchObject({ op: "put", row: { materializedThrough: "2026-10-25" } });
  });

  it("never materializes before today, even if startsOn is in the past", () => {
    const r = routine({ startsOn: "2026-01-01", materializedThrough: null });
    const now = { day: "2026-10-19", minute: 0 };
    const changes = materializeRoutines([r], [], "2026-10-25", now, testEnv());
    const days = changes.filter((c) => c.op === "put" && c.table === "blocks").map((c) => (c as { row: Block }).row.day);
    expect(days.every((d) => d >= "2026-10-19")).toBe(true);
  });

  it("resumes from the day after materializedThrough and skips existing occurrences", () => {
    const r = routine({ startsOn: "2026-10-19", materializedThrough: "2026-10-21" });
    const now = { day: "2026-10-19", minute: 0 };
    const existing = [block({ id: "x", day: "2026-10-22" })];
    const changes = materializeRoutines([r], existing, "2026-10-25", now, testEnv());
    const created = changes.filter((c) => c.op === "put" && c.table === "blocks");
    // Only Fri 23 is new (Thu 22 already exists; Mon-Wed already materialized).
    expect(created).toHaveLength(1);
    expect((created[0] as { row: Block }).row.day).toBe("2026-10-23");
  });

  it("stops at endsOn even if it's before the horizon, and never looks past it again", () => {
    const r = routine({ startsOn: "2026-10-19", endsOn: "2026-10-20", materializedThrough: null });
    const now = { day: "2026-10-19", minute: 0 };
    const changes = materializeRoutines([r], [], "2026-10-25", now, testEnv());
    expect(changes.filter((c) => c.op === "put" && c.table === "blocks")).toHaveLength(2); // Mon 19 and Tue 20
    expect(changes.find((c) => c.table === "routines")).toMatchObject({ row: { materializedThrough: "2026-10-20" } });
  });

  it("is a no-op once materializedThrough reaches the horizon", () => {
    const r = routine({ startsOn: "2026-10-19", materializedThrough: "2026-10-25" });
    const now = { day: "2026-10-19", minute: 0 };
    expect(materializeRoutines([r], [], "2026-10-25", now, testEnv())).toEqual([]);
  });
});

describe("createRoutineChanges", () => {
  it("trims the title and starts with no materialized occurrences", () => {
    const { routine: r } = createRoutineChanges(
      { title: "  Gym  ", goalId: null, notes: "", startMinute: 0, endMinute: 60, weekdays: WEEKDAYS, startsOn: "2026-10-19", endsOn: null },
      testEnv(),
    );
    expect(r.title).toBe("Gym");
    expect(r.materializedThrough).toBeNull();
  });
});

describe("updateRoutineChanges", () => {
  it("updates future unedited occurrences to match the patched fields", () => {
    const r = routine();
    const now = { day: "2026-10-19", minute: 0 };
    const unedited = block({ id: "a", day: "2026-10-20" }); // matches routine exactly
    const changes = updateRoutineChanges(r, { title: "Morning gym", startMinute: 360, endMinute: 420 }, [unedited], now, testEnv(9000));
    const updated = changes.find((c) => c.op === "put" && c.table === "blocks") as { row: Block };
    expect(updated.row).toMatchObject({ id: "a", title: "Morning gym", startMinute: 360, endMinute: 420 });
  });

  it("leaves a customized occurrence alone", () => {
    const r = routine();
    const now = { day: "2026-10-19", minute: 0 };
    const customized = block({ id: "a", day: "2026-10-20", title: "Gym (custom time)", startMinute: 500 });
    const changes = updateRoutineChanges(r, { title: "Morning gym" }, [customized], now, testEnv());
    expect(changes.some((c) => c.op === "put" && c.table === "blocks")).toBe(false);
  });

  it("never touches a past occurrence", () => {
    const r = routine();
    const now = { day: "2026-10-19", minute: 0 };
    const past = block({ id: "a", day: "2026-10-01" });
    const changes = updateRoutineChanges(r, { title: "Morning gym" }, [past], now, testEnv());
    expect(changes.some((c) => c.op === "put" && c.table === "blocks")).toBe(false);
  });

  it("removes an unedited occurrence that no longer occurs under the new schedule", () => {
    const r = routine();
    const now = { day: "2026-10-19", minute: 0 };
    // 2026-10-24 is a Saturday: valid now (if it happened to be created some other way)
    // but not once the weekdays are narrowed to Mon/Tue only.
    const sat = block({ id: "a", day: "2026-10-24" });
    const changes = updateRoutineChanges(r, { weekdays: 0b0000110 }, [sat], now, testEnv());
    expect(changes).toContainEqual({ op: "del", table: "blocks", key: "a" });
  });
});

describe("deleteRoutineChanges", () => {
  it("clears routineId on linked blocks and deletes the routine row", () => {
    const r = routine();
    const linked = block({ id: "a" });
    const unrelated = block({ id: "b", routineId: "other" });
    const changes = deleteRoutineChanges(r, [linked, unrelated], testEnv());
    expect(changes).toContainEqual({ op: "del", table: "routines", key: "r1" });
    const blockPut = changes.find((c) => c.op === "put" && c.table === "blocks") as { row: Block };
    expect(blockPut.row).toMatchObject({ id: "a", routineId: null });
    expect(changes.filter((c) => c.op === "put" && c.table === "blocks")).toHaveLength(1);
  });
});
