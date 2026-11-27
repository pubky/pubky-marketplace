// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoreState } from '@/config/store-mode';
import { config, proxy } from './proxy';

const runtime = vi.hoisted(() => ({
  frameAncestors: [] as string[],
  embedded: false,
  state: { kind: 'off' } as StoreState,
}));

vi.mock('@/libs/runtime-config/runtime-config', () => ({
  getFrameAncestors: () => runtime.frameAncestors,
  getEmbeddedFlag: () => runtime.embedded,
}));
vi.mock('@/libs/store-state/store-state.server', () => ({
  resolveStoreState: async () => runtime.state,
}));

const STORE_SELLER = 'o'.repeat(52);
const OTHER_SELLER = 'y'.repeat(52);
const PINNED: StoreState = { kind: 'claimed', seller: STORE_SELLER, source: 'pinned', claimMode: false };
const request = (path = '/') => new NextRequest(new URL(path, 'https://store.example'));

afterEach(() => {
  runtime.state = { kind: 'off' };
  runtime.frameAncestors = [];
  runtime.embedded = false;
});

describe('proxy', () => {
  it('denies framing by default', async () => {
    const response = await proxy(request());

    expect(response.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin-allow-popups');
  });

  it('names the configured ancestors at request time, without X-Frame-Options', async () => {
    runtime.frameAncestors = ['https://pubky.app'];
    const response = await proxy(request());

    expect(response.headers.get('content-security-policy')).toBe('frame-ancestors https://pubky.app');
    expect(response.headers.get('x-frame-options')).toBeNull();
    expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin-allow-popups');
  });

  it('re-reads the allow-list on every request', async () => {
    runtime.frameAncestors = ['https://pubky.app'];
    expect((await proxy(request())).headers.get('content-security-policy')).toBe('frame-ancestors https://pubky.app');
    runtime.frameAncestors = [];
    expect((await proxy(request())).headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
  });

  it('does not run for static build output or optimised images', () => {
    const [matcher] = config.matcher;
    const pattern = new RegExp(`^${matcher}$`);

    expect(pattern.test('/marketplace')).toBe(true);
    expect(pattern.test('/api/report')).toBe(true);
    expect(pattern.test('/')).toBe(true);
    expect(pattern.test('/_next/static/chunks/main.js')).toBe(false);
    expect(pattern.test('/_next/image')).toBe(false);
  });

  it('omits Shop COOP when the App owns the top-level page and popup return', async () => {
    runtime.embedded = true;
    runtime.frameAncestors = ["'self'"];
    const response = await proxy(request());
    expect(response.headers.get('cross-origin-opener-policy')).toBeNull();
    expect(response.headers.get('content-security-policy')).toBe("frame-ancestors 'self'");
  });
});

describe('proxy in store mode', () => {
  it('passes every path through when store mode is off', async () => {
    for (const path of ['/', '/marketplace', '/hot', `/marketplace/shop/${OTHER_SELLER}`]) {
      const response = await proxy(request(path));
      expect(response.headers.get('location')).toBeNull();
      expect(response.headers.get('x-middleware-rewrite')).toBeNull();
      expect(response.headers.get('x-middleware-next')).toBe('1');
    }
  });

  it.each(['/', '/marketplace'])('opens the store seller shop from %s', async (path) => {
    runtime.state = PINNED;
    const response = await proxy(request(`${path}?tab=all`));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`https://store.example/marketplace/shop/${STORE_SELLER}`);
  });

  it('passes the not-found destination through and keeps the other store route responses', async () => {
    runtime.state = PINNED;

    const notFound = await proxy(request('/_not-found'));
    expect(notFound.headers.get('x-middleware-rewrite')).toBeNull();
    expect(notFound.headers.get('x-middleware-next')).toBe('1');
    expect(notFound.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
    expect(notFound.headers.get('x-frame-options')).toBe('DENY');
    expect(notFound.headers.get('cross-origin-opener-policy')).toBe('same-origin-allow-popups');

    const masked = await proxy(request('/hot'));
    expect(masked.headers.get('x-middleware-rewrite')).toBe('https://store.example/_not-found');

    const storeHome = await proxy(request('/marketplace'));
    expect(storeHome.status).toBe(307);
    expect(storeHome.headers.get('location')).toBe(`https://store.example/marketplace/shop/${STORE_SELLER}`);
  });

  it.each([
    '/home',
    '/search',
    '/hot',
    '/collections',
    '/who-to-follow',
    '/post/abc/def',
    `/profile/${STORE_SELLER}`,
    '/marketplace/drops',
    `/marketplace/shop/${OTHER_SELLER}`,
    `/marketplace/listing/${OTHER_SELLER}/1`,
    `/marketplace/drop/${OTHER_SELLER}/1`,
    '/never-classified',
    '/llms.txt',
    '/api/feedback',
    '/api/report',
    '/api/sentry-test',
    '/api/never-classified',
  ])('rewrites %s to the not-found page', async (path) => {
    runtime.state = PINNED;
    const response = await proxy(request(path));

    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-middleware-rewrite')).toBe('https://store.example/_not-found');
  });

  it.each([
    `/marketplace/shop/${STORE_SELLER}`,
    `/marketplace/listing/${STORE_SELLER}/1`,
    '/marketplace/cart',
    '/sign-in',
    '/api/marketplace/session',
    '/api/fx-rate',
    '/auth/passport/return',
    '/favicon.ico',
  ])('lets %s through', async (path) => {
    runtime.state = PINNED;
    const response = await proxy(request(path));

    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('sets the framing headers on redirects and not-found rewrites', async () => {
    runtime.state = PINNED;

    for (const path of ['/', '/hot']) {
      const response = await proxy(request(path));
      expect(response.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
      expect(response.headers.get('x-frame-options')).toBe('DENY');
      expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin-allow-popups');
    }
  });

  it('serves the unclaimed holding page and hides commerce', async () => {
    runtime.state = { kind: 'unclaimed', claimMode: true };
    expect((await proxy(request('/'))).headers.get('x-middleware-next')).toBe('1');
    expect((await proxy(request('/setup'))).headers.get('x-middleware-next')).toBe('1');
    expect((await proxy(request('/marketplace/cart'))).headers.get('x-middleware-rewrite')).toBe(
      'https://store.example/_not-found',
    );
  });

  it('sets noindex on the unclaimed holding and setup pages', async () => {
    runtime.state = { kind: 'unclaimed', claimMode: true };

    expect((await proxy(request('/'))).headers.get('x-robots-tag')).toBe('noindex');
    expect((await proxy(request('/setup'))).headers.get('x-robots-tag')).toBe('noindex');
  });

  it('sets no-referrer on setup responses', async () => {
    runtime.state = { kind: 'unclaimed', claimMode: true };

    expect((await proxy(request('/setup'))).headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('rewrites unavailable documents to the 503 page', async () => {
    runtime.state = { kind: 'unavailable', claimMode: true };
    const response = await proxy(request('/marketplace?tab=all'));

    expect(response.status).toBe(503);
    expect(response.headers.get('x-middleware-rewrite')).toBe('https://store.example/store-unavailable');
  });

  it('answers unavailable API requests with JSON and no-store', async () => {
    runtime.state = { kind: 'unavailable', claimMode: true };
    const response = await proxy(request('/api/marketplace/session'));

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ error: 'STORE_UNAVAILABLE' });
  });

  it('passes the unavailable destination and static files through', async () => {
    runtime.state = { kind: 'unavailable', claimMode: true };
    expect((await proxy(request('/store-unavailable'))).headers.get('x-middleware-next')).toBe('1');
    expect((await proxy(request('/favicon.ico'))).headers.get('x-middleware-next')).toBe('1');
  });
});
