/**
 * Row ↔ entity mapping and per-table upsert/delete SQL. The only place that knows
 * column names; everything above works with camelCase domain types.
 */
import type { EntityMap, Table, Template } from "@/domain/types";
import type { SqlRow, SqlStmt, SqlValue } from "./drivers/SqlDriver";

interface TableSpec<T extends Table> {
  name: string;
  /** Column order for inserts. */
  columns: readonly string[];
  pk: readonly string[];
  toRow(e: EntityMap[T]): SqlValue[];
  fromRow(r: SqlRow): EntityMap[T];
  /** Splits a `keyOf` key into primary-key values. */
  keyParams(key: string): SqlValue[];
}

const str = (v: SqlValue | undefined): string => (v == null ? "" : String(v));
const strOrNull = (v: SqlValue | undefined): string | null => (v == null ? null : String(v));
const num = (v: SqlValue | undefined): number => Number(v ?? 0);
const numOrNull = (v: SqlValue | undefined): number | null => (v == null ? null : Number(v));
const bool = (v: SqlValue | undefined): boolean => Number(v ?? 0) !== 0;
const bit = (b: boolean): number => (b ? 1 : 0);
const single = (key: string): SqlValue[] => [key];
const parseJsonArray = (v: SqlValue | undefined): unknown[] => {
  try {
    const parsed: unknown = JSON.parse(str(v) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const TABLE_SPECS: { [T in Table]: TableSpec<T> } = {
  settings: {
    name: "settings",
    columns: ["key", "value"],
    pk: ["key"],
    toRow: (e) => [e.key, e.value],
    fromRow: (r) => ({ key: str(r.key), value: str(r.value) }),
    keyParams: single,
  },
  goals: {
    name: "goals",
    columns: ["id", "name", "color", "kind", "track_by", "sort_order", "archived_on", "created_at", "updated_at"],
    pk: ["id"],
    toRow: (e) => [e.id, e.name, e.color, e.kind, e.trackBy, e.sortOrder, e.archivedOn, e.createdAt, e.updatedAt],
    fromRow: (r) => ({
      id: str(r.id),
      name: str(r.name),
      color: str(r.color),
      kind: r.kind === "max" ? "max" : "min",
      trackBy: r.track_by === "tasks" ? "tasks" : "time",
      sortOrder: num(r.sort_order),
      archivedOn: strOrNull(r.archived_on),
      createdAt: num(r.created_at),
      updatedAt: num(r.updated_at),
    }),
    keyParams: single,
  },
  weekTargets: {
    name: "week_targets",
    columns: ["goal_id", "week_start", "target_minutes", "target_count", "updated_at"],
    pk: ["goal_id", "week_start"],
    toRow: (e) => [e.goalId, e.weekStart, e.targetMinutes, e.targetCount, e.updatedAt],
    fromRow: (r) => ({
      goalId: str(r.goal_id),
      weekStart: str(r.week_start),
      targetMinutes: numOrNull(r.target_minutes),
      targetCount: numOrNull(r.target_count),
      updatedAt: num(r.updated_at),
    }),
    keyParams: (key) => {
      const i = key.lastIndexOf("|");
      return [key.slice(0, i), key.slice(i + 1)];
    },
  },
  checklistItems: {
    name: "checklist_items",
    columns: [
      "id",
      "goal_id",
      "week_start",
      "text",
      "done",
      "sort_order",
      "carried_from_id",
      "created_at",
      "updated_at",
    ],
    pk: ["id"],
    toRow: (e) => [
      e.id,
      e.goalId,
      e.weekStart,
      e.text,
      bit(e.done),
      e.sortOrder,
      e.carriedFromId,
      e.createdAt,
      e.updatedAt,
    ],
    fromRow: (r) => ({
      id: str(r.id),
      goalId: str(r.goal_id),
      weekStart: str(r.week_start),
      text: str(r.text),
      done: bool(r.done),
      sortOrder: num(r.sort_order),
      carriedFromId: strOrNull(r.carried_from_id),
      createdAt: num(r.created_at),
      updatedAt: num(r.updated_at),
    }),
    keyParams: single,
  },
  templates: {
    name: "templates",
    columns: ["id", "name", "span_days", "blocks", "created_at", "updated_at"],
    pk: ["id"],
    toRow: (e) => [e.id, e.name, e.spanDays, JSON.stringify(e.blocks), e.createdAt, e.updatedAt],
    fromRow: (r) => ({
      id: str(r.id),
      name: str(r.name),
      spanDays: num(r.span_days) === 7 ? 7 : 1,
      blocks: parseJsonArray(r.blocks) as Template["blocks"],
      createdAt: num(r.created_at),
      updatedAt: num(r.updated_at),
    }),
    keyParams: single,
  },
  routines: {
    name: "routines",
    columns: [
      "id",
      "title",
      "goal_id",
      "notes",
      "start_minute",
      "end_minute",
      "weekdays",
      "starts_on",
      "ends_on",
      "materialized_through",
      "created_at",
      "updated_at",
    ],
    pk: ["id"],
    toRow: (e) => [
      e.id,
      e.title,
      e.goalId,
      e.notes,
      e.startMinute,
      e.endMinute,
      e.weekdays,
      e.startsOn,
      e.endsOn,
      e.materializedThrough,
      e.createdAt,
      e.updatedAt,
    ],
    fromRow: (r) => ({
      id: str(r.id),
      title: str(r.title),
      goalId: strOrNull(r.goal_id),
      notes: str(r.notes),
      startMinute: num(r.start_minute),
      endMinute: num(r.end_minute),
      weekdays: num(r.weekdays),
      startsOn: str(r.starts_on),
      endsOn: strOrNull(r.ends_on),
      materializedThrough: strOrNull(r.materialized_through),
      createdAt: num(r.created_at),
      updatedAt: num(r.updated_at),
    }),
    keyParams: single,
  },
  blocks: {
    name: "blocks",
    columns: [
      "id",
      "day",
      "layer",
      "start_minute",
      "end_minute",
      "title",
      "goal_id",
      "notes",
      "plan_block_id",
      "skipped",
      "routine_id",
      "created_at",
      "updated_at",
    ],
    pk: ["id"],
    toRow: (e) => [
      e.id,
      e.day,
      e.layer,
      e.startMinute,
      e.endMinute,
      e.title,
      e.goalId,
      e.notes,
      e.planBlockId,
      bit(e.skipped),
      e.routineId,
      e.createdAt,
      e.updatedAt,
    ],
    fromRow: (r) => ({
      id: str(r.id),
      day: str(r.day),
      layer: r.layer === "actual" ? "actual" : "plan",
      startMinute: num(r.start_minute),
      endMinute: num(r.end_minute),
      title: str(r.title),
      goalId: strOrNull(r.goal_id),
      notes: str(r.notes),
      planBlockId: strOrNull(r.plan_block_id),
      skipped: bool(r.skipped),
      routineId: strOrNull(r.routine_id),
      createdAt: num(r.created_at),
      updatedAt: num(r.updated_at),
    }),
    keyParams: single,
  },
  calendarSubscriptions: {
    name: "calendar_subscriptions",
    columns: ["id", "name", "url", "created_at", "updated_at"],
    pk: ["id"],
    toRow: (e) => [e.id, e.name, e.url, e.createdAt, e.updatedAt],
    fromRow: (r) => ({ id: str(r.id), name: str(r.name), url: str(r.url), createdAt: num(r.created_at), updatedAt: num(r.updated_at) }),
    keyParams: single,
  },
  weekNotes: {
    name: "week_notes",
    columns: ["week_start", "text", "updated_at"],
    pk: ["week_start"],
    toRow: (e) => [e.weekStart, e.text, e.updatedAt],
    fromRow: (r) => ({ weekStart: str(r.week_start), text: str(r.text), updatedAt: num(r.updated_at) }),
    keyParams: single,
  },
};

const upsertSql = new Map<Table, string>();

/** `INSERT … ON CONFLICT(pk) DO UPDATE SET …` for a full row. */
export function upsertStmt<T extends Table>(table: T, row: EntityMap[T]): SqlStmt {
  const spec = TABLE_SPECS[table];
  let sql = upsertSql.get(table);
  if (!sql) {
    const nonPk = spec.columns.filter((c) => !spec.pk.includes(c));
    sql =
      `INSERT INTO ${spec.name} (${spec.columns.join(", ")}) VALUES (${spec.columns.map(() => "?").join(", ")}) ` +
      `ON CONFLICT (${spec.pk.join(", ")}) DO UPDATE SET ${nonPk.map((c) => `${c} = excluded.${c}`).join(", ")}`;
    upsertSql.set(table, sql);
  }
  return { sql, params: spec.toRow(row) };
}

export function deleteStmt(table: Table, key: string): SqlStmt {
  const spec = TABLE_SPECS[table];
  return {
    sql: `DELETE FROM ${spec.name} WHERE ${spec.pk.map((c) => `${c} = ?`).join(" AND ")}`,
    params: spec.keyParams(key),
  };
}

export function fromRows<T extends Table>(table: T, rows: readonly SqlRow[]): EntityMap[T][] {
  const spec = TABLE_SPECS[table];
  return rows.map((r) => spec.fromRow(r));
}
