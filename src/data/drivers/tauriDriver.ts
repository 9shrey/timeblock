import { invoke } from "@tauri-apps/api/core";
import { checkParams, type SqlDriver, type SqlRow, type SqlStmt, type SqlValue } from "./SqlDriver";

/** Driver backed by the Rust `db_*` commands (one rusqlite connection). */
export function createTauriDriver(): SqlDriver {
  return {
    kind: "tauri",
    select(sql: string, params: SqlValue[] = []) {
      checkParams(params);
      return invoke<SqlRow[]>("db_select", { sql, params });
    },
    async batch(stmts: SqlStmt[]) {
      if (stmts.length === 0) return;
      for (const s of stmts) checkParams(s.params);
      await invoke("db_batch", { stmts: stmts.map((s) => ({ sql: s.sql, params: s.params ?? [] })) });
    },
    async execScript(sql: string) {
      await invoke("db_exec_script", { sql });
    },
  };
}
