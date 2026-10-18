/**
 * Minimal SQL surface shared by the Tauri (rusqlite) and browser/test (sql.js) drivers.
 * Values are restricted to what both sides map identically: NULL, numbers, text.
 */
export type SqlValue = null | number | string;
export type SqlRow = Record<string, SqlValue>;

export interface SqlStmt {
  sql: string;
  params?: SqlValue[];
}

export interface SqlDriver {
  readonly kind: "tauri" | "sqljs";
  select(sql: string, params?: SqlValue[]): Promise<SqlRow[]>;
  /** Runs all statements in one transaction with deferred foreign keys. All or nothing. */
  batch(stmts: SqlStmt[]): Promise<void>;
  /** Runs a multi-statement script in one transaction (migrations). */
  execScript(sql: string): Promise<void>;
}

/** Rejects values the Rust side would reject, so both drivers fail identically. */
export function checkParams(params: readonly unknown[] | undefined): void {
  for (const p of params ?? []) {
    if (p === null || typeof p === "string" || (typeof p === "number" && Number.isFinite(p))) continue;
    throw new Error(`Unsupported SQL parameter: ${typeof p === "boolean" ? "boolean (send 0/1)" : String(p)}`);
  }
}
