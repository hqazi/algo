/**
 * Runs and records are exclusive per problem: a chat tool and a UI button
 * never run the same problem's tests at once (ported from `dsa-tutor`'s
 * `SlugGuard`, `server/locks.py`). Other problems run in parallel; state
 * writes are serialised separately by `Storage`.
 */
export class SlugBusyError extends Error {
  constructor(readonly key: string) {
    super(`${key} is busy`);
    this.name = 'SlugBusyError';
  }
}

export class SlugGuard {
  private readonly held = new Set<string>();

  isBusy(key: string): boolean {
    return this.held.has(key);
  }

  /** Runs `task` holding `key`; throws `SlugBusyError` at once if `key` is already held. */
  async hold<T>(key: string, task: () => Promise<T>): Promise<T> {
    if (this.held.has(key)) throw new SlugBusyError(key);
    this.held.add(key);
    try {
      return await task();
    } finally {
      this.held.delete(key);
    }
  }
}
