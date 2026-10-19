/** Shared setup for component tests: a seeded sql.js store at a fixed "now". */
import { demoSeed } from "@/data/devSeed";
import { createSqlJsDriver } from "@/data/drivers/sqljsDriver";
import { SqliteRepository } from "@/data/SqliteRepository";
import type { Now } from "@/domain/types";
import { initStore } from "@/state/store";
import { useUi } from "@/state/ui";

export const NOW: Now = { day: "2026-10-21", minute: 840 }; // Wed 14:00

export async function seededStore(now: Now = NOW): Promise<SqliteRepository> {
  const repo = new SqliteRepository(await createSqlJsDriver());
  await repo.init();
  await repo.replaceAll(demoSeed(now));
  useUi.setState({ editing: null, unlockedPlanDays: [], menu: null });
  await initStore({ repo }, now);
  return repo;
}

/** jsdom lacks these; Radix popovers and selects need them. */
export function polyfillDom(): void {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= function () {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= function () {};
}
