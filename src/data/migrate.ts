import init0001 from "./migrations/0001_init.sql?raw";
import integrity0002 from "./migrations/0002_integrity.sql?raw";
import templates0003 from "./migrations/0003_templates_routines.sql?raw";
import taskGoals0004 from "./migrations/0004_task_goals.sql?raw";
import type { SqlDriver } from "./drivers/SqlDriver";

/** Migration N (1-based) brings the DB from user_version N-1 to N. */
export const MIGRATIONS: readonly string[] = [init0001, integrity0002, templates0003, taskGoals0004];
export const SCHEMA_VERSION = MIGRATIONS.length;

export class NewerDatabaseError extends Error {
  constructor(public readonly version: number) {
    super(
      `This database was created by a newer version of Timeblock (schema v${version}, this app knows v${SCHEMA_VERSION}). Please update the app.`,
    );
    this.name = "NewerDatabaseError";
  }
}

export async function userVersion(driver: SqlDriver): Promise<number> {
  const rows = await driver.select("SELECT user_version FROM pragma_user_version");
  return Number(rows[0]?.user_version ?? 0);
}

/**
 * Runs pending migrations, each in its own transaction together with the user_version bump.
 * Refuses to touch a DB from a newer app. Backs up first when an existing schema is upgraded.
 */
export async function migrate(
  driver: SqlDriver,
  opts: { backup?: (reason: string) => Promise<unknown> } = {},
): Promise<{ from: number; to: number }> {
  const from = await userVersion(driver);
  if (from > SCHEMA_VERSION) throw new NewerDatabaseError(from);
  if (from < SCHEMA_VERSION && from > 0 && opts.backup) await opts.backup("pre-migration");
  for (let v = from; v < SCHEMA_VERSION; v++) {
    await driver.execScript(`${MIGRATIONS[v]}\nPRAGMA user_version = ${v + 1};`);
  }
  return { from, to: SCHEMA_VERSION };
}
