// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, proxy } from './proxy';

const runtime = vi.hoisted(() => ({
  frameAncestors: [] as string[],
  embedded: false,
  storeSeller: undefined as string | undefined,
}));

vi.mock('@/libs/runtime-config/runtime-config', () => ({
  getFrameAncestors: () => runtime.frameAncestors,
  getEmbeddedFlag: () => runtime.embedded,
  getStoreSeller: () => runtime.storeSeller,
}));

const request = (path = '/') => new NextRequest(new URL(path, 'https://store.example'));

describe('proxy', () => {
  it('denies framing by default', () => {
    runtime.frameAncestors = [];
    const response = proxy(request());

    expect(response.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin-allow-popups');
  });

  it('names the configured ancestors at request time, without X-Frame-Options', () => {
    runtime.frameAncestors = ['https://pubky.app'];
    const response = proxy(request());

    expect(response.headers.get('content-security-policy')).toBe('frame-ancestors https://pubky.app');
    expect(response.headers.get('x-frame-options')).toBeNull();
    expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin-allow-popups');
  });

  it('re-reads the allow-list on every request', () => {
    runtime.frameAncestors = ['https://pubky.app'];
    expect(proxy(request()).headers.get('content-security-policy')).toBe('frame-ancestors https://pubky.app');
    runtime.frameAncestors = [];
    expect(proxy(request()).headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
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
});

it('omits Shop COOP when the App owns the top-level page and popup return', () => {
  runtime.embedded = true;
  runtime.frameAncestors = ["'self'"];
  const response = proxy(request());
  expect(response.headers.get('cross-origin-opener-policy')).toBeNull();
  expect(response.headers.get('content-security-policy')).toBe("frame-ancestors 'self'");
  runtime.embedded = false;
});

describe('proxy in store mode', () => {
  const STORE_SELLER = 'o'.repeat(52);
  const OTHER_SELLER = 'y'.repeat(52);

  afterEach(() => {
    runtime.storeSeller = undefined;
  });

  it('passes every path through when store mode is off', () => {
    for (const path of ['/', '/marketplace', '/hot', `/marketplace/shop/${OTHER_SELLER}`]) {
      const response = proxy(request(path));
      expect(response.headers.get('location')).toBeNull();
      expect(response.headers.get('x-middleware-rewrite')).toBeNull();
      expect(response.headers.get('x-middleware-next')).toBe('1');
    }
  });

  it.each(['/', '/marketplace'])('opens the store seller shop from %s', (path) => {
    runtime.storeSeller = STORE_SELLER;
    const response = proxy(request(`${path}?tab=all`));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`https://store.example/marketplace/shop/${STORE_SELLER}`);
  });

  it('passes the not-found destination through and keeps the other store route responses', () => {
    runtime.storeSeller = STORE_SELLER;
    runtime.frameAncestors = [];

    const notFound = proxy(request('/_not-found'));
    expect(notFound.headers.get('x-middleware-rewrite')).toBeNull();
    expect(notFound.headers.get('x-middleware-next')).toBe('1');
    expect(notFound.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
    expect(notFound.headers.get('x-frame-options')).toBe('DENY');
    expect(notFound.headers.get('cross-origin-opener-policy')).toBe('same-origin-allow-popups');

    const masked = proxy(request('/hot'));
    expect(masked.headers.get('x-middleware-rewrite')).toBe('https://store.example/_not-found');

    const storeHome = proxy(request('/marketplace'));
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
  ])('rewrites %s to the not-found page', (path) => {
    runtime.storeSeller = STORE_SELLER;
    const response = proxy(request(path));

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
  ])('lets %s through', (path) => {
    runtime.storeSeller = STORE_SELLER;
    const response = proxy(request(path));

    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('sets the framing headers on redirects and not-found rewrites', () => {
    runtime.storeSeller = STORE_SELLER;
    runtime.frameAncestors = [];

    for (const path of ['/', '/hot']) {
      const response = proxy(request(path));
      expect(response.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
      expect(response.headers.get('x-frame-options')).toBe('DENY');
      expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin-allow-popups');
    }
  });
});
