/**
 * Spacing for every automatic messaging retry (link recovery, handshake step
 * errors, outbox flushes, silent session resume, receiver marker publish).
 * The surfaces poll every couple of seconds; a failing operation must not
 * follow that cadence. The n-th consecutive failure waits a random delay in
 * [cap/2, cap], where cap = min(maxMs, baseMs * 2^(n-1)), so retries never
 * come closer than baseMs/2 and never further apart than maxMs.
 */
export const MESSAGING_RETRY_POLICY = { baseMs: 5_000, maxMs: 600_000 } as const;

export type RetryBackoffPolicy = { baseMs: number; maxMs: number };

type RetryEntry<T> = { failures: number; nextAttemptAt: number; value: T };

/**
 * Per-key failure schedule held in memory. `value` is what callers report
 * while an attempt is not yet due, so a waiting key costs no network.
 */
export class RetryBackoff<T> {
  private readonly entries = new Map<string, RetryEntry<T>>();

  constructor(
    private readonly policy: RetryBackoffPolicy = MESSAGING_RETRY_POLICY,
    private readonly random: () => number = () => Math.random(),
  ) {}

  /** `none` — no recorded failure; `waiting` — failed, retry not due; `due` — failed, retry may run. */
  status(key: string, now: number = Date.now()): 'none' | 'waiting' | 'due' {
    const entry = this.entries.get(key);
    if (!entry) return 'none';
    return now < entry.nextAttemptAt ? 'waiting' : 'due';
  }

  /** Records one more consecutive failure and returns the delay until the next attempt. */
  fail(key: string, value: T, now: number = Date.now()): number {
    const failures = (this.entries.get(key)?.failures ?? 0) + 1;
    const cap = Math.min(this.policy.maxMs, this.policy.baseMs * 2 ** (failures - 1));
    const delay = Math.round(cap / 2 + this.random() * (cap / 2));
    this.entries.set(key, { failures, nextAttemptAt: now + delay, value });
    return delay;
  }

  succeed(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}
