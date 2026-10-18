import type { ChangeSet } from "@/domain/types";

export interface WriteQueue {
  /** Enqueues a write; writes run strictly one after another in order. */
  push(changes: ChangeSet): Promise<void>;
  /** Resolves when every queued write has settled. */
  flush(): Promise<void>;
  readonly pending: number;
}

/**
 * Serial write queue. A failed write calls `onError` (which reloads state from the DB)
 * and the queue keeps going with the next write.
 */
export function createWriteQueue(
  apply: (changes: ChangeSet) => Promise<void>,
  onError: (error: unknown, changes: ChangeSet) => void,
): WriteQueue {
  let tail: Promise<void> = Promise.resolve();
  let pending = 0;
  return {
    push(changes) {
      if (changes.length === 0) return tail;
      pending++;
      tail = tail
        .then(() => apply(changes))
        .catch((e: unknown) => onError(e, changes))
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
