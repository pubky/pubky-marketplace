import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IMPORT_IMAGE_GLOBAL_RATE_LIMIT_BYTES,
  IMPORT_IMAGE_GLOBAL_RATE_LIMIT_REQUESTS,
  IMPORT_IMAGE_RATE_LIMIT_BYTES,
  IMPORT_IMAGE_RATE_LIMIT_MAX_KEYS,
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

  describe('key table bound', () => {
    const fill = () => {
      for (let i = 0; i < IMPORT_IMAGE_RATE_LIMIT_MAX_KEYS; i += 1) ImportImageRateLimiter.admit(`forged:${i}`);
    };

    it('refuses new keys instead of evicting live ones when the table is full', () => {
      fill();
      const refused = ImportImageRateLimiter.admit('newcomer');
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('does not reset a live key whose window is nearly spent when the table floods', () => {
      for (let i = 0; i < IMPORT_IMAGE_RATE_LIMIT_REQUESTS; i += 1) ImportImageRateLimiter.admit('victim');
      expect(ImportImageRateLimiter.admit('victim').ok).toBe(false);
      fill();
      expect(ImportImageRateLimiter.admit('victim').ok).toBe(false);
    });

    it('keeps serving keys already in the table', () => {
      fill();
      expect(ImportImageRateLimiter.admit('forged:0').ok).toBe(true);
    });

    it('accepts new keys again once windows expire', () => {
      fill();
      vi.advanceTimersByTime(IMPORT_IMAGE_RATE_LIMIT_WINDOW_MS + 1);
      expect(ImportImageRateLimiter.admit('newcomer').ok).toBe(true);
    });

    it('does not open byte windows for fetches that served no bytes', () => {
      for (let i = 0; i < IMPORT_IMAGE_RATE_LIMIT_MAX_KEYS; i += 1) ImportImageRateLimiter.admit(`forged:${i}`);
      vi.advanceTimersByTime(IMPORT_IMAGE_RATE_LIMIT_WINDOW_MS + 1);
      expect(ImportImageRateLimiter.admit('newcomer').ok).toBe(true);
      ImportImageRateLimiter.recordBytes('newcomer', IMPORT_IMAGE_RATE_LIMIT_BYTES);
      expect(ImportImageRateLimiter.admit('newcomer').ok).toBe(false);
    });

    it('never lets a key flood affect the global allowance', () => {
      fill();
      expect(ImportImageRateLimiter.admitGlobal().ok).toBe(true);
    });
  });
});
