import type { ChangeSet } from "@/domain/types";

export interface WriteQueue {
  /** Enqueues a write; writes run strictly one after another in order. */
  push(changes: ChangeSet): Promise<void>;
  /** Resolves when every queued write has settled. */
  flush(): Promise<void>;
  readonly pending: number;
}

/**
 * Serial write queue. A failed write calls `onError` (which reloads state from the DB).
 * Writes queued behind the failed one are dropped: they were built on optimistic state
 * the reload throws away. Writes pushed after the failure run normally.
 */
export function createWriteQueue(
  apply: (changes: ChangeSet) => Promise<void>,
  onError: (error: unknown, changes: ChangeSet) => void,
): WriteQueue {
  let tail: Promise<void> = Promise.resolve();
  let pending = 0;
  // Bumped on every failure; a write only runs if no failure happened since it was pushed.
  let generation = 0;
  return {
    push(changes) {
      if (changes.length === 0) return tail;
      pending++;
      const pushedAt = generation;
      tail = tail
        .then(async () => {
          if (pushedAt !== generation) return;
          try {
            await apply(changes);
          } catch (e) {
            generation++;
            onError(e, changes);
          }
        })
        .finally(() => {
          pending--;
        });
      return tail;
    },
    flush: () => tail,
    get pending() {
      return pending;
    },
  };
}
