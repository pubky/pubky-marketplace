/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertSameOrigin, BffError } from './bff';
import type { MarketplaceGrantConfig } from './config';

const config = {
  allowedOrigins: ['https://pubky.app', 'https://staging.pubky.app', 'https://shop-staging-example.vercel.app'],
} as MarketplaceGrantConfig;

function request(origin: string | null, fetchSite = 'same-origin'): Request {
  const headers = new Headers({ 'sec-fetch-site': fetchSite });
  if (origin) headers.set('origin', origin);
  return new Request('https://pubky.app/shop/api/marketplace/session', { method: 'POST', headers });
}

describe('assertSameOrigin for the embedded Shop', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(['https://pubky.app', 'https://staging.pubky.app', 'https://shop-staging-example.vercel.app'])(
    'accepts a same-origin request from %s',
    (origin) => {
      vi.stubEnv('NODE_ENV', 'production');
      expect(() => assertSameOrigin(request(origin), config)).not.toThrow();
    },
  );

  it.each([
    ['a missing Origin', null],
    ['the retired standalone host', 'https://shop.pubky.app'],
    ['a sibling subdomain of pubky.app', 'https://evil.pubky.app'],
    ['the mount path in place of an origin', 'https://pubky.app/shop'],
    ['an http downgrade', 'http://pubky.app'],
  ])('refuses %s', (_label, origin) => {
    expect(() => assertSameOrigin(request(origin), config)).toThrow(BffError);
  });

  it('refuses a cross-site fetch from an allowed origin in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => assertSameOrigin(request('https://pubky.app', 'cross-site'), config)).toThrow(BffError);
  });
});
