import {
  IMPORT_IMAGE_GLOBAL_RATE_LIMIT_BYTES,
  IMPORT_IMAGE_GLOBAL_RATE_LIMIT_REQUESTS,
  IMPORT_IMAGE_RATE_LIMIT_BYTES,
  IMPORT_IMAGE_RATE_LIMIT_BYTES_WINDOW_MS,
  IMPORT_IMAGE_RATE_LIMIT_REQUESTS,
  IMPORT_IMAGE_RATE_LIMIT_WINDOW_MS,
} from '@/config/import-image';

const MAX_TRACKED_KEYS = 5_000;

type TRateLimitDecision = { ok: true } | { ok: false; retryAfterSeconds: number };

type TWindow = { startedAt: number; used: number };

/**
 * Fixed-window limiter, held in process memory. Keys are caller-chosen
 * (session digest or IP). One instance per server process: a deployment with
 * several instances multiplies the effective limit by the instance count.
 */
class WindowCounter {
  private readonly windows = new Map<string, TWindow>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  consume(key: string, amount: number): TRateLimitDecision {
    const now = Date.now();
    const current = this.current(key, now);
    if (current.used >= this.limit) return { ok: false, retryAfterSeconds: this.retryAfter(current, now) };
    current.used += amount;
    return { ok: true };
  }

  peek(key: string): TRateLimitDecision {
    const now = Date.now();
    const current = this.current(key, now);
    if (current.used >= this.limit) return { ok: false, retryAfterSeconds: this.retryAfter(current, now) };
    return { ok: true };
  }

  clear(): void {
    this.windows.clear();
  }

  private current(key: string, now: number): TWindow {
    const existing = this.windows.get(key);
    if (existing && now - existing.startedAt < this.windowMs) return existing;

    if (this.windows.size >= MAX_TRACKED_KEYS) this.evictExpired(now);
    if (this.windows.size >= MAX_TRACKED_KEYS) {
      const oldest = this.windows.keys().next().value;
      if (oldest !== undefined) this.windows.delete(oldest);
    }

    const fresh: TWindow = { startedAt: now, used: 0 };
    this.windows.set(key, fresh);
    return fresh;
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
