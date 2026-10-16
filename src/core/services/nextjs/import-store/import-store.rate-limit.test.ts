import { beforeEach, describe, expect, it } from 'vitest';
import {
  IMPORT_STORE_GLOBAL_RATE_LIMIT_REQUESTS,
  IMPORT_STORE_RATE_LIMIT_BYTES,
  IMPORT_STORE_RATE_LIMIT_REQUESTS,
} from '@/config/import-store';
import { ImportImageRateLimiter } from '../import-image/import-image.rate-limit';
import { ImportStoreRateLimiter } from './import-store.rate-limit';

describe('ImportStoreRateLimiter', () => {
  beforeEach(() => {
    ImportStoreRateLimiter.resetForTests();
    ImportImageRateLimiter.resetForTests();
  });

  it('admits a key up to its request allowance and then refuses with a wait', () => {
    for (let index = 0; index < IMPORT_STORE_RATE_LIMIT_REQUESTS; index += 1) {
      expect(ImportStoreRateLimiter.admit('ip:1.2.3.4')).toEqual({ ok: true });
    }
    expect(ImportStoreRateLimiter.admit('ip:1.2.3.4')).toMatchObject({
      ok: false,
      retryAfterSeconds: expect.any(Number),
    });
    expect(ImportStoreRateLimiter.admit('ip:5.6.7.8')).toEqual({ ok: true });
  });

  it('refuses a key that has already read its byte allowance', () => {
    ImportStoreRateLimiter.recordBytes('session:a', IMPORT_STORE_RATE_LIMIT_BYTES);
    expect(ImportStoreRateLimiter.admit('session:a')).toMatchObject({ ok: false });
    expect(ImportStoreRateLimiter.admit('session:b')).toEqual({ ok: true });
  });

  it('caps every caller together, and checks the global allowance on its own counters', () => {
    for (let index = 0; index < IMPORT_STORE_GLOBAL_RATE_LIMIT_REQUESTS; index += 1) {
      expect(ImportStoreRateLimiter.admitGlobal()).toEqual({ ok: true });
    }
    expect(ImportStoreRateLimiter.admitGlobal()).toMatchObject({ ok: false });
  });

  it('keeps its windows apart from the image route, so neither can starve the other', () => {
    for (let index = 0; index < IMPORT_STORE_RATE_LIMIT_REQUESTS; index += 1)
      ImportStoreRateLimiter.admit('ip:9.9.9.9');
    expect(ImportStoreRateLimiter.admit('ip:9.9.9.9')).toMatchObject({ ok: false });
    expect(ImportImageRateLimiter.admit('ip:9.9.9.9')).toEqual({ ok: true });
    for (let index = 0; index < IMPORT_STORE_GLOBAL_RATE_LIMIT_REQUESTS; index += 1)
      ImportStoreRateLimiter.admitGlobal();
    expect(ImportImageRateLimiter.admitGlobal()).toEqual({ ok: true });
  });
});
