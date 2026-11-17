import { IMPORT_IMAGE_RATE_LIMIT_MAX_KEYS } from '@/config/import-image';
import {
  IMPORT_STORE_GLOBAL_RATE_LIMIT_BYTES,
  IMPORT_STORE_GLOBAL_RATE_LIMIT_REQUESTS,
  IMPORT_STORE_RATE_LIMIT_BYTES,
  IMPORT_STORE_RATE_LIMIT_BYTES_WINDOW_MS,
  IMPORT_STORE_RATE_LIMIT_REQUESTS,
  IMPORT_STORE_RATE_LIMIT_WINDOW_MS,
} from '@/config/import-store';
import { type TRateLimitDecision, WindowCounter } from '@/libs/api/window-counter';

/**
 * The store import's own windows, on the same limiter as the image route: a long
 * catalogue read cannot use up a seller's photo allowance, and neither route
 * can starve the other. Same rules: per key (session digest or IP) and across
 * all callers together, in process memory, and a full key table refuses new
 * keys instead of evicting live ones (`WindowCounter`).
 */
const requestCounter = new WindowCounter(
  IMPORT_STORE_RATE_LIMIT_REQUESTS,
  IMPORT_STORE_RATE_LIMIT_WINDOW_MS,
  IMPORT_IMAGE_RATE_LIMIT_MAX_KEYS,
);
const byteCounter = new WindowCounter(
  IMPORT_STORE_RATE_LIMIT_BYTES,
  IMPORT_STORE_RATE_LIMIT_BYTES_WINDOW_MS,
  IMPORT_IMAGE_RATE_LIMIT_MAX_KEYS,
);

const GLOBAL_KEY = 'global';
const globalRequestCounter = new WindowCounter(
  IMPORT_STORE_GLOBAL_RATE_LIMIT_REQUESTS,
  IMPORT_STORE_RATE_LIMIT_WINDOW_MS,
  IMPORT_IMAGE_RATE_LIMIT_MAX_KEYS,
);
const globalByteCounter = new WindowCounter(
  IMPORT_STORE_GLOBAL_RATE_LIMIT_BYTES,
  IMPORT_STORE_RATE_LIMIT_BYTES_WINDOW_MS,
  IMPORT_IMAGE_RATE_LIMIT_MAX_KEYS,
);

export class ImportStoreRateLimiter {
  private constructor() {}

  /** Counts one store read and refuses it when the key is out of requests or bytes. */
  static admit(key: string): TRateLimitDecision {
    const bytes = byteCounter.peek(key);
    if (!bytes.ok) return bytes;
    return requestCounter.consume(key, 1);
  }

  /** Admits one read against the allowance shared by every caller, before any per-key bucket is touched. */
  static admitGlobal(): TRateLimitDecision {
    const bytes = globalByteCounter.peek(GLOBAL_KEY);
    if (!bytes.ok) return bytes;
    return globalRequestCounter.consume(GLOBAL_KEY, 1);
  }

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
