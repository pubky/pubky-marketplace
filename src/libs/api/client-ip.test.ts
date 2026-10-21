import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { trustedClientIp } from './client-ip';

function createRequest(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3000/api/feedback', { method: 'POST', headers });
}

describe('trustedClientIp', () => {
  beforeEach(() => {
    vi.stubEnv('VERCEL', undefined);
    vi.stubEnv('SHOP_BFF_CLI_TRUSTED_PROXY_COUNT', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('trusts no forwarded address when no proxy count is configured', () => {
    expect(trustedClientIp(createRequest({ 'x-forwarded-for': '203.0.113.7' }))).toBeNull();
  });

  it.each(['0', '-1', '1.5', 'abc'])('trusts no forwarded address when the proxy count is %s', (count) => {
    vi.stubEnv('SHOP_BFF_CLI_TRUSTED_PROXY_COUNT', count);
    const request = createRequest({ 'x-forwarded-for': '198.51.100.1, 203.0.113.7' });
    expect(trustedClientIp(request)).toBeNull();
  });

  it('takes the last hop when one proxy is trusted', () => {
    vi.stubEnv('SHOP_BFF_CLI_TRUSTED_PROXY_COUNT', '1');
    const request = createRequest({ 'x-forwarded-for': '198.51.100.1, 203.0.113.7' });
    expect(trustedClientIp(request)).toBe('203.0.113.7');
  });

  it('takes the second hop from the right when two proxies are trusted', () => {
    vi.stubEnv('SHOP_BFF_CLI_TRUSTED_PROXY_COUNT', '2');
    const request = createRequest({ 'x-forwarded-for': '198.51.100.1, 203.0.113.7, 10.0.0.2' });
    expect(trustedClientIp(request)).toBe('203.0.113.7');
  });

  it('trusts no address when the header has fewer hops than trusted proxies', () => {
    vi.stubEnv('SHOP_BFF_CLI_TRUSTED_PROXY_COUNT', '2');
    expect(trustedClientIp(createRequest({ 'x-forwarded-for': '203.0.113.7' }))).toBeNull();
  });

  it('takes the last hop of the Vercel forwarded header on Vercel', () => {
    vi.stubEnv('VERCEL', '1');
    const request = createRequest({
      'x-vercel-forwarded-for': '198.51.100.1, 203.0.113.7',
      'x-forwarded-for': '192.0.2.9',
    });
    expect(trustedClientIp(request)).toBe('203.0.113.7');
  });

  it('falls back to the trusted forwarded hop on Vercel when the Vercel header is missing', () => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('SHOP_BFF_CLI_TRUSTED_PROXY_COUNT', '1');
    const request = createRequest({ 'x-forwarded-for': '198.51.100.1, 203.0.113.9' });
    expect(trustedClientIp(request)).toBe('203.0.113.9');
  });
});
