import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importRateLimitKeys } from './import-route-guards';

function createRequest(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3000/api/import-image', { method: 'POST', headers });
}

describe('import route guards', () => {
  beforeEach(() => {
    vi.stubEnv('VERCEL', undefined);
    vi.stubEnv('SHOP_BFF_CLI_TRUSTED_PROXY_COUNT', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('importRateLimitKeys', () => {
    it('keys the request by an unknown address when no trusted address is available', () => {
      expect(importRateLimitKeys(createRequest({ 'x-forwarded-for': '203.0.113.7' }))).toEqual(['ip:unknown']);
    });
  });
});
