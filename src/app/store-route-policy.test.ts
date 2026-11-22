// @vitest-environment node
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  decideStoreRoute,
  isStoreSellerViewerRoute,
  matchStoreRoute,
  STORE_NOT_FOUND_PATHNAME,
  STORE_ROUTE_HANDLER_PATHS,
  STORE_ROUTE_POLICY,
  storeRouteUrlSegments,
} from '@/app/store-route-policy';

const APP_DIR = path.join(process.cwd(), 'src/app');
const PUBLIC_DIR = path.join(process.cwd(), 'public');

const STORE_SELLER = 'o'.repeat(52);
const OTHER_SELLER = 'y'.repeat(52);

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
const isOutsideApi = (file: string) => !file.startsWith('api/');

describe('store route policy table', () => {
  it('has exactly one row per page under src/app', () => {
    const pages = appFiles.filter((file) => /^page\.tsx?$/.test(basename(file))).map(folderKey);

    expect(new Set(pages).size).toBe(pages.length);
    expect(pages.filter((key) => !(key in STORE_ROUTE_POLICY))).toEqual([]);
    expect(Object.keys(STORE_ROUTE_POLICY).filter((key) => !pages.includes(key))).toEqual([]);
  });

  it('lists every route handler outside /api', () => {
    const handlers = appFiles
      .filter((file) => /^route\.tsx?$/.test(basename(file)) && isOutsideApi(file))
      .map((file) => storeRouteUrlSegments(folderKey(file)))
      .map((segments) => `/${segments?.join('/') ?? ''}`);

    expect(handlers.toSorted()).toEqual([...STORE_ROUTE_HANDLER_PATHS].toSorted());
  });

  it('ties every Open Graph and Twitter image to a page in the table', () => {
    const imageFolders = appFiles
      .filter((file) => /^(?:opengraph|twitter)-image\.tsx?$/.test(basename(file)))
      .map(folderKey);

    expect(imageFolders.length).toBeGreaterThan(0);
    expect(imageFolders.filter((key) => !(key in STORE_ROUTE_POLICY))).toEqual([]);
  });

  it('has no metadata route the policy does not cover', () => {
    const uncovered = appFiles.filter((file) =>
      /^(?:icon|apple-icon|sitemap|robots|manifest)(?:\d*)\.(?:tsx?|js|xml|txt|json|webmanifest|png|jpe?g|svg|ico)$/.test(
        basename(file),
      ),
    );

    expect(uncovered).toEqual([]);
  });

  it('gives no two pages the same URL', () => {
    const urls = Object.keys(STORE_ROUTE_POLICY)
      .map(storeRouteUrlSegments)
      .filter((segments) => segments !== null)
      .map((segments) => `/${segments.join('/')}`.replace(/\[[^\]]+\]/g, '[]'));

    expect(new Set(urls).size).toBe(urls.length);
  });

  it('serves only files with an extension from public/', () => {
    expect(filesUnder(PUBLIC_DIR).filter((file) => !basename(file).includes('.'))).toEqual([]);
  });

  it('keeps the not-found target unroutable', () => {
    expect(STORE_NOT_FOUND_PATHNAME.startsWith('/_')).toBe(true);
    expect(matchStoreRoute(STORE_NOT_FOUND_PATHNAME)).toBeNull();
  });
});

describe('matchStoreRoute', () => {
  it('drops route groups and ignores parallel slots', () => {
    expect(matchStoreRoute('/home')?.key).toBe('/(feeds)/home');
    expect(matchStoreRoute('/profile')?.key).toBe('/profile/(own)');
    expect(matchStoreRoute('/post/a/b')?.key).toBe('/post/[userId]/[postId]');
  });

  it('prefers static segments over dynamic ones', () => {
    expect(matchStoreRoute('/collections/bookmarks')?.key).toBe('/collections/bookmarks');
    expect(matchStoreRoute('/settings/edit')?.key).toBe('/(edit-profile)/settings/edit');
    expect(matchStoreRoute('/profile/followers')?.key).toBe('/profile/(own)/followers');
    expect(matchStoreRoute(`/profile/${OTHER_SELLER}/followers`)?.key).toBe('/profile/[pubky]/followers');
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
  const decide = (pathname: string) => decideStoreRoute(pathname, STORE_SELLER).kind;

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
    '/marketplace/drops',
    '/marketplace/sandbox',
  ])('hides the Market browse or social page %s', (pathname) => {
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
    '/settings/account',
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

  it('passes through API routes, build output, route handlers and files', () => {
    expect(decide('/api')).toBe('allow');
    expect(decide('/api/feedback')).toBe('allow');
    expect(decide('/_next/data/build/x.json')).toBe('allow');
    expect(decide('/auth/passport/return')).toBe('allow');
    expect(decide('/llms.txt')).toBe('allow');
    expect(decide('/sw.js')).toBe('allow');
    expect(decide('/images/logo.png')).toBe('allow');
    expect(decide('/favicon.ico')).toBe('allow');
  });

  it('serves page images only where the page is served', () => {
    expect(decide(`/marketplace/shop/${STORE_SELLER}/opengraph-image`)).toBe('allow');
    expect(decide(`/marketplace/listing/${STORE_SELLER}/1/twitter-image-abc123`)).toBe('allow');
    expect(decide(`/marketplace/shop/${OTHER_SELLER}/opengraph-image`)).toBe('not-found');
    expect(decide('/marketplace/opengraph-image')).toBe('not-found');
    expect(decide(`/profile/${STORE_SELLER}/twitter-image`)).toBe('not-found');
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
