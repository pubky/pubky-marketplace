import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IMPORT_IMAGE_GLOBAL_RATE_LIMIT_BYTES,
  IMPORT_IMAGE_GLOBAL_RATE_LIMIT_REQUESTS,
  IMPORT_IMAGE_RATE_LIMIT_BYTES,
  IMPORT_IMAGE_RATE_LIMIT_REQUESTS,
  IMPORT_IMAGE_RATE_LIMIT_WINDOW_MS,
} from '@/config/import-image';
import { ImportImageRateLimiter } from './import-image.rate-limit';

describe('ImportImageRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    ImportImageRateLimiter.resetForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refuses a key after its request allowance and reports when to retry', () => {
    for (let i = 0; i < IMPORT_IMAGE_RATE_LIMIT_REQUESTS; i += 1) {
      expect(ImportImageRateLimiter.admit('session:a').ok).toBe(true);
    }
    const refused = ImportImageRateLimiter.admit('session:a');
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.retryAfterSeconds).toBe(IMPORT_IMAGE_RATE_LIMIT_WINDOW_MS / 1000);
  });

  it('keeps keys independent', () => {
    for (let i = 0; i < IMPORT_IMAGE_RATE_LIMIT_REQUESTS; i += 1) ImportImageRateLimiter.admit('session:a');
    expect(ImportImageRateLimiter.admit('session:b').ok).toBe(true);
  });

  it('opens a fresh window after the window elapses', () => {
    for (let i = 0; i < IMPORT_IMAGE_RATE_LIMIT_REQUESTS; i += 1) ImportImageRateLimiter.admit('session:a');
    vi.advanceTimersByTime(IMPORT_IMAGE_RATE_LIMIT_WINDOW_MS + 1);
    expect(ImportImageRateLimiter.admit('session:a').ok).toBe(true);
  });

  it('refuses further fetches once the byte allowance is spent', () => {
    expect(ImportImageRateLimiter.admit('ip:1').ok).toBe(true);
    ImportImageRateLimiter.recordBytes('ip:1', IMPORT_IMAGE_RATE_LIMIT_BYTES);
    expect(ImportImageRateLimiter.admit('ip:1').ok).toBe(false);
    expect(ImportImageRateLimiter.admit('ip:2').ok).toBe(true);
  });

  describe('global allowance', () => {
    it('refuses every caller once the global request allowance is spent, then recovers', () => {
      for (let i = 0; i < IMPORT_IMAGE_GLOBAL_RATE_LIMIT_REQUESTS; i += 1) {
        expect(ImportImageRateLimiter.admitGlobal().ok).toBe(true);
      }
      const refused = ImportImageRateLimiter.admitGlobal();
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.retryAfterSeconds).toBeGreaterThan(0);

      vi.advanceTimersByTime(IMPORT_IMAGE_RATE_LIMIT_WINDOW_MS + 1);
      expect(ImportImageRateLimiter.admitGlobal().ok).toBe(true);
    });

    it('refuses once the global byte allowance is spent', () => {
      expect(ImportImageRateLimiter.admitGlobal().ok).toBe(true);
      ImportImageRateLimiter.recordGlobalBytes(IMPORT_IMAGE_GLOBAL_RATE_LIMIT_BYTES);
      expect(ImportImageRateLimiter.admitGlobal().ok).toBe(false);
    });
  });
});
