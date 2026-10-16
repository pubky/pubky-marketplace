import {
  IMPORT_IMAGE_GLOBAL_RATE_LIMIT_BYTES,
  IMPORT_IMAGE_GLOBAL_RATE_LIMIT_REQUESTS,
  IMPORT_IMAGE_RATE_LIMIT_BYTES,
  IMPORT_IMAGE_RATE_LIMIT_BYTES_WINDOW_MS,
  IMPORT_IMAGE_RATE_LIMIT_MAX_KEYS,
  IMPORT_IMAGE_RATE_LIMIT_REQUESTS,
  IMPORT_IMAGE_RATE_LIMIT_WINDOW_MS,
} from '@/config/import-image';

export type TRateLimitDecision = { ok: true } | { ok: false; retryAfterSeconds: number };

type TWindow = { startedAt: number; used: number };

/**
 * Fixed-window limiter, held in process memory. Keys are caller-chosen
 * (session digest or IP). One instance per server process: a deployment with
 * several instances multiplies the effective limit by the instance count.
 */
export class WindowCounter {
  private readonly windows = new Map<string, TWindow>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  consume(key: string, amount: number): TRateLimitDecision {
    const now = Date.now();
    const current = this.current(key, now);
    if (!current) return this.tableFull();
    if (current.used >= this.limit) return { ok: false, retryAfterSeconds: this.retryAfter(current, now) };
    current.used += amount;
    return { ok: true };
  }

  /** Reads a key's state without opening a window, so refused or failed fetches never occupy a slot. */
  peek(key: string): TRateLimitDecision {
    const now = Date.now();
    const existing = this.windows.get(key);
    if (!existing || now - existing.startedAt >= this.windowMs) return { ok: true };
    if (existing.used >= this.limit) return { ok: false, retryAfterSeconds: this.retryAfter(existing, now) };
    return { ok: true };
  }

  clear(): void {
    this.windows.clear();
  }

  /**
   * Returns the key's live window, opening one if needed. When the table is full
   * of live windows it returns null instead of evicting one: evicting would let a
   * flood of forged keys reset another key's window. Callers refuse in that case.
   */
  private current(key: string, now: number): TWindow | null {
    const existing = this.windows.get(key);
    if (existing && now - existing.startedAt < this.windowMs) return existing;

    if (!existing && this.windows.size >= IMPORT_IMAGE_RATE_LIMIT_MAX_KEYS) this.evictExpired(now);
    if (!existing && this.windows.size >= IMPORT_IMAGE_RATE_LIMIT_MAX_KEYS) return null;

    const fresh: TWindow = { startedAt: now, used: 0 };
    this.windows.set(key, fresh);
    return fresh;
  }

  private tableFull(): TRateLimitDecision {
    return { ok: false, retryAfterSeconds: Math.ceil(this.windowMs / 1000) };
  }

  private evictExpired(now: number): void {
    for (const [key, window] of this.windows) {
      if (now - window.startedAt >= this.windowMs) this.windows.delete(key);
    }
  }

  private retryAfter(window: TWindow, now: number): number {
    return Math.max(1, Math.ceil((window.startedAt + this.windowMs - now) / 1000));
  }
}

const requestCounter = new WindowCounter(IMPORT_IMAGE_RATE_LIMIT_REQUESTS, IMPORT_IMAGE_RATE_LIMIT_WINDOW_MS);
const byteCounter = new WindowCounter(IMPORT_IMAGE_RATE_LIMIT_BYTES, IMPORT_IMAGE_RATE_LIMIT_BYTES_WINDOW_MS);

const GLOBAL_KEY = 'global';
const globalRequestCounter = new WindowCounter(
  IMPORT_IMAGE_GLOBAL_RATE_LIMIT_REQUESTS,
  IMPORT_IMAGE_RATE_LIMIT_WINDOW_MS,
);
const globalByteCounter = new WindowCounter(
  IMPORT_IMAGE_GLOBAL_RATE_LIMIT_BYTES,
  IMPORT_IMAGE_RATE_LIMIT_BYTES_WINDOW_MS,
);

export class ImportImageRateLimiter {
  private constructor() {}

  /** Counts one fetch and refuses it when the key is out of requests or bytes. */
  static admit(key: string): TRateLimitDecision {
    const bytes = byteCounter.peek(key);
    if (!bytes.ok) return bytes;
    return requestCounter.consume(key, 1);
  }

  /**
   * Admits one fetch against the global allowance shared by every caller.
   * Checked before the per-key buckets so a refused fetch spends no per-key quota.
   */
  static admitGlobal(): TRateLimitDecision {
    const bytes = globalByteCounter.peek(GLOBAL_KEY);
    if (!bytes.ok) return bytes;
    return globalRequestCounter.consume(GLOBAL_KEY, 1);
  }

  /** Charges bytes actually served to the key and to the global allowance. */
  static recordBytes(key: string, bytes: number): void {
    if (bytes > 0) byteCounter.consume(key, bytes);
  }

  static recordGlobalBytes(bytes: number): void {
    if (bytes > 0) globalByteCounter.consume(GLOBAL_KEY, bytes);
  }

  static resetForTests(): void {
    requestCounter.clear();
    byteCounter.clear();
    globalRequestCounter.clear();
    globalByteCounter.clear();
  }
}
