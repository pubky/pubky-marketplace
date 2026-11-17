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

    it('keys the request by the trusted forwarded hop when one proxy is trusted', () => {
      vi.stubEnv('SHOP_BFF_CLI_TRUSTED_PROXY_COUNT', '1');
      const request = createRequest({ 'x-forwarded-for': '198.51.100.1, 203.0.113.9' });
      expect(importRateLimitKeys(request)).toEqual(['ip:203.0.113.9']);
    });

    it('adds a hashed session key after the address key when a session cookie is present', () => {
      const keys = importRateLimitKeys(createRequest({ cookie: '__Host-shop-bff-session=session-value' }));
      expect(keys).toHaveLength(2);
      expect(keys[0]).toBe('ip:unknown');
      expect(keys[1]).toMatch(/^session:[a-f0-9]{64}$/);
    });
  });
});
