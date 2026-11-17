import {
  IMPORT_IMAGE_GLOBAL_RATE_LIMIT_BYTES,
  IMPORT_IMAGE_GLOBAL_RATE_LIMIT_REQUESTS,
  IMPORT_IMAGE_RATE_LIMIT_BYTES,
  IMPORT_IMAGE_RATE_LIMIT_BYTES_WINDOW_MS,
  IMPORT_IMAGE_RATE_LIMIT_MAX_KEYS,
  IMPORT_IMAGE_RATE_LIMIT_REQUESTS,
  IMPORT_IMAGE_RATE_LIMIT_WINDOW_MS,
} from '@/config/import-image';
import { type TRateLimitDecision, WindowCounter } from '@/libs/api/window-counter';

const requestCounter = new WindowCounter(
  IMPORT_IMAGE_RATE_LIMIT_REQUESTS,
  IMPORT_IMAGE_RATE_LIMIT_WINDOW_MS,
  IMPORT_IMAGE_RATE_LIMIT_MAX_KEYS,
);
const byteCounter = new WindowCounter(
  IMPORT_IMAGE_RATE_LIMIT_BYTES,
  IMPORT_IMAGE_RATE_LIMIT_BYTES_WINDOW_MS,
  IMPORT_IMAGE_RATE_LIMIT_MAX_KEYS,
);

const GLOBAL_KEY = 'global';
const globalRequestCounter = new WindowCounter(
  IMPORT_IMAGE_GLOBAL_RATE_LIMIT_REQUESTS,
  IMPORT_IMAGE_RATE_LIMIT_WINDOW_MS,
  IMPORT_IMAGE_RATE_LIMIT_MAX_KEYS,
);
const globalByteCounter = new WindowCounter(
  IMPORT_IMAGE_GLOBAL_RATE_LIMIT_BYTES,
  IMPORT_IMAGE_RATE_LIMIT_BYTES_WINDOW_MS,
  IMPORT_IMAGE_RATE_LIMIT_MAX_KEYS,
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
