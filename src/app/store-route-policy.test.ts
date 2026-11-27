// @vitest-environment node
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  decideStoreRoute,
  isStoreSellerViewerRoute,
  matchStoreRoute,
  STORE_NOT_FOUND_PATHNAME,
  STORE_PAGE_POLICY,
  STORE_ROUTE_HANDLER_POLICY,
  STORE_STATIC_FILES,
  storeRouteUrlSegments,
} from '@/app/store-route-policy';
import type { StoreState } from '@/config/store-mode';

const APP_DIR = path.join(process.cwd(), 'src/app');
const PUBLIC_DIR = path.join(process.cwd(), 'public');

const STORE_SELLER = 'o'.repeat(52);
const OTHER_SELLER = 'y'.repeat(52);
const PINNED: StoreState = { kind: 'claimed', seller: STORE_SELLER, source: 'pinned', claimMode: false };
const CLAIMED: StoreState = { kind: 'claimed', seller: STORE_SELLER, source: 'claim', claimMode: true };
const UNCLAIMED: StoreState = { kind: 'unclaimed', claimMode: true };
const UNAVAILABLE: StoreState = { kind: 'unavailable', claimMode: true };

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'));
}

/** `src/app`-relative folder of a file, as a policy key: `/` for the root, else `/a/(b)/[c]`. */
function folderKey(file: string): string {
  const folder = path.posix.dirname(file);
  return folder === '.' ? '/' : `/${folder}`;
}

const isTest = (file: string) => /\.test\.tsx?$/.test(file);
const appFiles = filesUnder(APP_DIR).filter((file) => !isTest(file));
const basename = (file: string) => path.posix.basename(file);

describe('store route policy table', () => {
  it('has exactly one row per page under src/app', () => {
    const pages = appFiles.filter((file) => /^page\.tsx?$/.test(basename(file))).map(folderKey);

    expect(new Set(pages).size).toBe(pages.length);
    expect(pages.filter((key) => !(key in STORE_PAGE_POLICY))).toEqual([]);
    expect(Object.keys(STORE_PAGE_POLICY).filter((key) => !pages.includes(key))).toEqual([]);
  });

  it('has exactly one row, with a reason, per route handler under src/app, /api included', () => {
    const handlers = appFiles.filter((file) => /^route\.tsx?$/.test(basename(file))).map(folderKey);

    expect(handlers.some((key) => key.startsWith('/api/'))).toBe(true);
    expect(new Set(handlers).size).toBe(handlers.length);
    expect(handlers.filter((key) => !(key in STORE_ROUTE_HANDLER_POLICY))).toEqual([]);
    expect(Object.keys(STORE_ROUTE_HANDLER_POLICY).filter((key) => !handlers.includes(key))).toEqual([]);
    expect(Object.values(STORE_ROUTE_HANDLER_POLICY).filter((row) => row.reason.trim().length < 20)).toEqual([]);
  });

  it('ties every Open Graph and Twitter image to a page in the table', () => {
    const imageFolders = appFiles
      .filter((file) => /^(?:opengraph|twitter)-image\.tsx?$/.test(basename(file)))
      .map(folderKey);

    expect(imageFolders.length).toBeGreaterThan(0);
    expect(imageFolders.filter((key) => !(key in STORE_PAGE_POLICY))).toEqual([]);
  });

  it('has no metadata route the policy does not cover', () => {
    const uncovered = appFiles.filter((file) =>
      /^(?:icon|apple-icon|sitemap|robots|manifest)(?:\d*)\.(?:tsx?|js|xml|txt|json|webmanifest|png|jpe?g|svg|ico)$/.test(
        basename(file),
      ),
    );

    expect(uncovered).toEqual([]);
  });

  it('gives no two pages or route handlers the same URL', () => {
    const urls = [...Object.keys(STORE_PAGE_POLICY), ...Object.keys(STORE_ROUTE_HANDLER_POLICY)]
      .map(storeRouteUrlSegments)
      .filter((segments) => segments !== null)
      .map((segments) => `/${segments.join('/')}`.replace(/\[[^\]]+\]/g, '[]'));

    expect(new Set(urls).size).toBe(urls.length);
  });

  it('lists exactly the files public/ holds, the service worker build output and the app favicon', () => {
    expect(appFiles).toContain('favicon.ico');
    const onDisk = filesUnder(PUBLIC_DIR).map((file) => `/${file}`);
    expect(new Set([...onDisk, '/sw.js', '/sw.js.map', '/favicon.ico'])).toEqual(STORE_STATIC_FILES);
  });

  it('rewrites to the not-found route Next.js builds from src/app/not-found.tsx', () => {
    expect(STORE_NOT_FOUND_PATHNAME).toBe('/_not-found');
    expect(appFiles).toContain('not-found.tsx');
    expect(matchStoreRoute(STORE_NOT_FOUND_PATHNAME)).toBeNull();
    expect(decideStoreRoute(STORE_NOT_FOUND_PATHNAME, PINNED).kind).toBe('not-found');
  });
});

describe('matchStoreRoute', () => {
  it('drops route groups and ignores parallel slots', () => {
    expect(matchStoreRoute('/sign-in')?.key).toBe('/(auth)/sign-in');
    expect(storeRouteUrlSegments('/(group)/@slot/[...path]')).toBeNull();
  });

  it('matches the social handoff handler and keeps retired social paths out of the store', () => {
    expect(matchStoreRoute('/social-handoff/profile/alice')?.key).toBe('/social-handoff/[...segments]');
    expect(matchStoreRoute('/profile/alice')).toBeNull();
  });

  it('returns the page params', () => {
    expect(matchStoreRoute(`/marketplace/listing/${STORE_SELLER}/42/edit`)).toEqual({
      key: '/marketplace/listing/[sellerPubky]/[listingId]/edit',
      policy: { mode: 'store-scoped', scope: 'seller-path-and-viewer' },
      params: { sellerPubky: STORE_SELLER, listingId: '42' },
    });
  });

  it('returns null for paths no page serves', () => {
    expect(matchStoreRoute('/not-a-page')).toBeNull();
    expect(matchStoreRoute('/marketplace/shop')).toBeNull();
    expect(matchStoreRoute('/hot/extra')).toBeNull();
  });
});

describe('decideStoreRoute', () => {
  const decide = (pathname: string) => decideStoreRoute(pathname, PINNED).kind;

  it.each(['/', '/marketplace'])('opens the store seller shop from %s', (pathname) => {
    expect(decide(pathname)).toBe('store-home');
  });

  it.each([
    `/marketplace/shop/${STORE_SELLER}`,
    `/marketplace/listing/${STORE_SELLER}/1`,
    `/marketplace/listing/${STORE_SELLER}/1/edit`,
    `/marketplace/drop/${STORE_SELLER}/1`,
  ])('serves the store seller page %s', (pathname) => {
    expect(decide(pathname)).toBe('allow');
  });

  it.each([
    `/marketplace/shop/${OTHER_SELLER}`,
    `/marketplace/listing/${OTHER_SELLER}/1`,
    `/marketplace/listing/${OTHER_SELLER}/1/edit`,
    `/marketplace/drop/${OTHER_SELLER}/1`,
    `/marketplace/shop/${STORE_SELLER.toUpperCase()}`,
  ])('hides the other seller page %s', (pathname) => {
    expect(decide(pathname)).toBe('not-found');
  });

  it.each([
    '/home',
    '/search',
    '/feed/1',
    '/hot',
    '/collections',
    '/collections/bookmarks',
    '/post/a/b',
    '/profile',
    `/profile/${STORE_SELLER}`,
    '/who-to-follow',
    '/share',
    '/settings/account',
    '/social-handoff/settings/account',
    '/marketplace/drops',
    '/marketplace/sandbox',
    '/copyright',
    '/sentry-test',
  ])('hides the Market browse, social or hosted-Market page %s', (pathname) => {
    expect(decide(pathname)).toBe('not-found');
  });

  it.each([
    '/sign-in',
    '/logout',
    '/complete-profile',
    '/marketplace/cart',
    '/marketplace/checkout',
    '/marketplace/orders',
    '/messages',
    '/marketplace/settings/addresses',
    '/offline',
  ])('serves the shared page %s', (pathname) => {
    expect(decide(pathname)).toBe('allow');
  });

  it.each(['/marketplace/dashboard', '/marketplace/sell', '/marketplace/settings', '/marketplace/storefront'])(
    'leaves the selling tool %s to the route guard',
    (pathname) => {
      expect(decide(pathname)).toBe('allow');
      expect(isStoreSellerViewerRoute(pathname)).toBe(true);
    },
  );

  it('hides paths no page serves', () => {
    expect(decide('/not-a-page')).toBe('not-found');
    expect(decide('/marketplace/shop')).toBe('not-found');
  });

  it.each([
    '/llms.txt',
    '/api/sentry-test',
    '/api/report',
    '/api/feedback',
    '/api/copyright',
    '/api/og-metadata',
    '/api/cli/grant-challenges',
    '/api/cli/grant-flows/abc/claim',
  ])('hides the hosted-Market route handler %s', (pathname) => {
    expect(decide(pathname)).toBe('not-found');
  });

  it.each([
    '/api/build',
    '/api/fx-rate',
    '/api/import-store',
    '/api/import-image',
    '/api/marketplace/health',
    '/api/marketplace/session',
    '/api/marketplace/client-region',
    '/api/marketplace/grant-cleanup',
    '/api/marketplace/grant-flows',
    '/api/marketplace/grant-flows/abc/status',
    '/api/marketplace/bootstrap-challenges/abc/verify',
    '/auth/passport/return',
  ])('serves the route handler %s', (pathname) => {
    expect(decide(pathname)).toBe('allow');
  });

  it('serves the Paykit creator lookup to the store seller payment setup without a viewer gate', () => {
    expect(STORE_ROUTE_HANDLER_POLICY['/api/paykit-creator']?.policy).toEqual({ mode: 'both' });
    expect(decide('/api/paykit-creator')).toBe('allow');
    expect(decideStoreRoute('/api/paykit-creator', { ...PINNED, seller: OTHER_SELLER }).kind).toBe('allow');
    expect(isStoreSellerViewerRoute('/api/paykit-creator')).toBe(false);
    expect(decide('/api/paykit-creator/extra')).toBe('not-found');
  });

  it('hides API paths no route handler serves', () => {
    expect(decide('/api')).toBe('not-found');
    expect(decide('/api/not-a-handler')).toBe('not-found');
    expect(decide('/api/marketplace')).toBe('not-found');
  });

  it('passes through build output and the files it serves', () => {
    expect(decide('/_next/data/build/x.json')).toBe('allow');
    expect(decide('/sw.js')).toBe('allow');
    expect(decide('/images/marketplace/marketplace-icon.png')).toBe('allow');
    expect(decide('/manifest.json')).toBe('allow');
    expect(decide('/favicon.ico')).toBe('allow');
  });

  it.each([
    '/a.b',
    '/robots.txt',
    '/sitemap.xml',
    '/hot.txt',
    '/images/no-such.png',
    `/marketplace/shop/${OTHER_SELLER}/x.y`,
  ])('hides the unknown file %s', (pathname) => {
    expect(decide(pathname)).toBe('not-found');
  });

  it('decides React Server Components requests as their page', () => {
    expect(decide(`/marketplace/shop/${STORE_SELLER}.rsc`)).toBe('allow');
    expect(decide('/marketplace/cart.prefetch.rsc')).toBe('allow');
    expect(decide('/marketplace/orders.segments/_tree.segment.rsc')).toBe('allow');
    expect(decide('/hot.rsc')).toBe('not-found');
    expect(decide(`/marketplace/shop/${OTHER_SELLER}.segments/_tree.segment.rsc`)).toBe('not-found');
    expect(decide('/marketplace.rsc')).toBe('not-found');
  });

  it('serves page images where the page is served, and the Market image the store pages point at', () => {
    expect(decide(`/marketplace/shop/${STORE_SELLER}/opengraph-image`)).toBe('allow');
    expect(decide(`/marketplace/listing/${STORE_SELLER}/1/twitter-image-abc123`)).toBe('allow');
    expect(decide('/marketplace/opengraph-image')).toBe('allow');
    expect(decide('/marketplace/twitter-image')).toBe('allow');
    expect(decide(`/marketplace/shop/${OTHER_SELLER}/opengraph-image`)).toBe('not-found');
    expect(decide(`/profile/${STORE_SELLER}/twitter-image`)).toBe('not-found');
  });
});

describe('decideStoreRoute across store states', () => {
  it('applies no store policy when store mode is off', () => {
    expect(decideStoreRoute('/', { kind: 'off' })).toEqual({ kind: 'allow' });
    expect(decideStoreRoute('/hot', { kind: 'off' })).toEqual({ kind: 'allow' });
  });

  it('serves setup only to an unclaimed store or a store claimed through setup', () => {
    expect(decideStoreRoute('/setup', UNCLAIMED)).toEqual({ kind: 'allow' });
    expect(decideStoreRoute('/setup', CLAIMED)).toEqual({ kind: 'allow' });
    expect(decideStoreRoute('/setup', PINNED)).toEqual({ kind: 'not-found' });
  });

  it.each([
    '/',
    '/setup',
    '/sign-in',
    '/logout',
    '/complete-profile',
    '/api/build',
    '/api/marketplace/health',
    '/api/marketplace/store',
    '/api/marketplace/session',
    '/api/marketplace/grant-flows',
    '/api/marketplace/grant-flows/abc/status',
    '/api/marketplace/bootstrap-challenges',
    '/api/marketplace/bootstrap-challenges/abc/verify',
    '/favicon.ico',
    '/_next/static/chunks/main.js',
  ])('serves %s while unclaimed', (pathname) => {
    expect(decideStoreRoute(pathname, UNCLAIMED)).toEqual({ kind: 'allow' });
  });

  it.each([
    '/marketplace',
    '/marketplace/cart',
    '/marketplace/checkout',
    '/marketplace/dashboard',
    '/messages',
    '/settings',
    `/marketplace/shop/${STORE_SELLER}`,
    '/api/fx-rate',
    '/api/marketplace/client-region',
    '/not-a-page',
  ])('hides %s while unclaimed', (pathname) => {
    expect(decideStoreRoute(pathname, UNCLAIMED)).toEqual({ kind: 'not-found' });
  });

  it('does not redirect the unclaimed holding page or its RSC read', () => {
    expect(decideStoreRoute('/', UNCLAIMED)).toEqual({ kind: 'allow' });
    expect(decideStoreRoute('/index.rsc', UNCLAIMED)).toEqual({ kind: 'not-found' });
    expect(decideStoreRoute('/.rsc', UNCLAIMED)).toEqual({ kind: 'allow' });
  });

  it('marks every document unavailable but keeps static files available', () => {
    expect(decideStoreRoute('/', UNAVAILABLE)).toEqual({ kind: 'unavailable' });
    expect(decideStoreRoute('/api/marketplace/store', UNAVAILABLE)).toEqual({ kind: 'unavailable' });
    expect(decideStoreRoute('/favicon.ico', UNAVAILABLE)).toEqual({ kind: 'allow' });
    expect(decideStoreRoute('/_next/static/chunks/main.js', UNAVAILABLE)).toEqual({ kind: 'allow' });
  });
});

describe('isStoreSellerViewerRoute', () => {
  it('is true only for selling tools', () => {
    expect(isStoreSellerViewerRoute(`/marketplace/listing/${STORE_SELLER}/1/edit`)).toBe(true);
    expect(isStoreSellerViewerRoute('/marketplace/settings/shipping')).toBe(true);
    expect(isStoreSellerViewerRoute(`/marketplace/shop/${STORE_SELLER}`)).toBe(false);
    expect(isStoreSellerViewerRoute('/marketplace/cart')).toBe(false);
    expect(isStoreSellerViewerRoute('/hot')).toBe(false);
    expect(isStoreSellerViewerRoute('/not-a-page')).toBe(false);
  });
});
