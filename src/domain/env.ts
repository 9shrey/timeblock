import type { Env } from "./types";

/** Production env: random UUIDs and the real clock. */
export const systemEnv: Env = {
  newId: () => crypto.randomUUID(),
  // eslint-disable-next-line no-restricted-syntax -- the single sanctioned epoch-ms source
  nowMs: () => Date.now(),
};

/** Deterministic env for tests: ids `id1, id2, …`, a fixed (or advancing) clock. */
export function testEnv(startMs = 1_760_000_000_000, stepMs = 0): Env & { reset(): void } {
  let n = 0;
  let t = startMs;
  return {
    newId: () => `id${++n}`,
    nowMs: () => {
      const v = t;
      t += stepMs;
      return v;
    },
    reset() {
      n = 0;
      t = startMs;
    },
  };
}
