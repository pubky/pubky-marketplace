/**
 * Which pages a store-mode deployment (`PUBKY_RUNTIME_STORE_SELLER`, see `@/config/store-mode`)
 * serves. Every `page.tsx` under `src/app` has one row, keyed by its folder;
 * `store-route-policy.test.ts` fails on a page without a row, and at run time a store answers 404
 * for any path that matches no row, so a new page stays hidden in store mode until it is
 * classified here. Outside store mode this table changes nothing.
 *
 * - `both`: served as in the full Market.
 * - `marketplace-only`: the full Market's browse, search and social pages; 404 in a store.
 * - `store-scoped`: served only for the store seller, as `scope` says.
 */
export type StoreRouteScope =
  /** The Market's entry routes; a store opens the store seller's shop instead. */
  | 'store-home'
  /** A page of the seller in its `[sellerPubky]` segment; only the store seller's pages exist. */
  | 'seller-path'
  /** Selling tools; only the store seller, signed in, may use them. */
  | 'seller-viewer'
  /** The store seller's own record, edited by the store seller: `seller-path` and `seller-viewer`. */
  | 'seller-path-and-viewer';

export type StoreRoutePolicy =
  | { mode: 'both' }
  | { mode: 'marketplace-only' }
  | { mode: 'store-scoped'; scope: StoreRouteScope };

const BOTH: StoreRoutePolicy = { mode: 'both' };
const MARKETPLACE_ONLY: StoreRoutePolicy = { mode: 'marketplace-only' };
const STORE_HOME: StoreRoutePolicy = { mode: 'store-scoped', scope: 'store-home' };
const SELLER_PATH: StoreRoutePolicy = { mode: 'store-scoped', scope: 'seller-path' };
const SELLER_VIEWER: StoreRoutePolicy = { mode: 'store-scoped', scope: 'seller-viewer' };
const SELLER_PATH_AND_VIEWER: StoreRoutePolicy = { mode: 'store-scoped', scope: 'seller-path-and-viewer' };

/** The page folders under `src/app`, with route groups `(...)` and parallel slots `@...` as on disk. */
export const STORE_ROUTE_POLICY: Readonly<Record<string, StoreRoutePolicy>> = {
  '/': STORE_HOME,
  '/(auth)/logout': BOTH,
  '/(auth)/sign-in': BOTH,
  '/(edit-profile)/settings/edit': BOTH,
  '/(feeds)/@post/(.)post/[userId]/[postId]': MARKETPLACE_ONLY,
  '/(feeds)/@post/[...catchAll]': MARKETPLACE_ONLY,
  '/(feeds)/feed/[id]': MARKETPLACE_ONLY,
  '/(feeds)/home': MARKETPLACE_ONLY,
  '/(feeds)/search': MARKETPLACE_ONLY,
  '/collections': MARKETPLACE_ONLY,
  '/collections/[userId]/[postId]': MARKETPLACE_ONLY,
  '/collections/bookmarks': MARKETPLACE_ONLY,
  '/complete-profile': BOTH,
  '/copyright': BOTH,
  '/hot': MARKETPLACE_ONLY,
  '/marketplace': STORE_HOME,
  '/marketplace/award-checkout': BOTH,
  '/marketplace/cart': BOTH,
  '/marketplace/checkout': BOTH,
  '/marketplace/dashboard': SELLER_VIEWER,
  '/marketplace/dashboard/inventory': SELLER_VIEWER,
  '/marketplace/dashboard/inventory/automations': SELLER_VIEWER,
  '/marketplace/drop/[sellerPubky]/[dropId]': SELLER_PATH,
  '/marketplace/drops': MARKETPLACE_ONLY,
  '/marketplace/listing/[sellerPubky]/[listingId]': SELLER_PATH,
  '/marketplace/listing/[sellerPubky]/[listingId]/edit': SELLER_PATH_AND_VIEWER,
  '/marketplace/my-shop': SELLER_VIEWER,
  '/marketplace/notifications': BOTH,
  '/marketplace/offers': BOTH,
  '/marketplace/orders': BOTH,
  '/marketplace/sandbox': MARKETPLACE_ONLY,
  '/marketplace/sell': SELLER_VIEWER,
  '/marketplace/sell/drops': SELLER_VIEWER,
  '/marketplace/sell/drops/[dropId]': SELLER_VIEWER,
  '/marketplace/settings': SELLER_VIEWER,
  '/marketplace/settings/addresses': BOTH,
  '/marketplace/settings/shipping': SELLER_VIEWER,
  '/marketplace/settings/store-connections': SELLER_VIEWER,
  '/marketplace/settings/store-connections/[connectionId]': SELLER_VIEWER,
  '/marketplace/shop/[sellerPubky]': SELLER_PATH,
  '/marketplace/storefront': SELLER_VIEWER,
  '/marketplace/watchlist': BOTH,
  '/messages': BOTH,
  '/messages/[pubky]': BOTH,
  '/offline': BOTH,
  '/post/[userId]/[postId]': MARKETPLACE_ONLY,
  '/profile/(own)': MARKETPLACE_ONLY,
  '/profile/(own)/collections': MARKETPLACE_ONLY,
  '/profile/(own)/followers': MARKETPLACE_ONLY,
  '/profile/(own)/following': MARKETPLACE_ONLY,
  '/profile/(own)/friends': MARKETPLACE_ONLY,
  '/profile/(own)/posts': MARKETPLACE_ONLY,
  '/profile/(own)/profile': MARKETPLACE_ONLY,
  '/profile/(own)/replies': MARKETPLACE_ONLY,
  '/profile/(own)/tagged': MARKETPLACE_ONLY,
  '/profile/(own)/tags': MARKETPLACE_ONLY,
  '/profile/[pubky]': MARKETPLACE_ONLY,
  '/profile/[pubky]/collections': MARKETPLACE_ONLY,
  '/profile/[pubky]/followers': MARKETPLACE_ONLY,
  '/profile/[pubky]/following': MARKETPLACE_ONLY,
  '/profile/[pubky]/friends': MARKETPLACE_ONLY,
  '/profile/[pubky]/profile': MARKETPLACE_ONLY,
  '/profile/[pubky]/replies': MARKETPLACE_ONLY,
  '/profile/[pubky]/tagged': MARKETPLACE_ONLY,
  '/sentry-test': BOTH,
  '/settings': BOTH,
  '/settings/account': BOTH,
  '/settings/help': BOTH,
  '/settings/muted-users': BOTH,
  '/settings/notifications': BOTH,
  '/settings/privacy-safety': BOTH,
  '/share': MARKETPLACE_ONLY,
  '/who-to-follow': MARKETPLACE_ONLY,
};

/**
 * Route handlers outside `/api` that answer at a page-like path. `store-route-policy.test.ts`
 * fails on any other `route.ts` outside `src/app/api`.
 */
export const STORE_ROUTE_HANDLER_PATHS: readonly string[] = ['/auth/passport/return', '/llms.txt'];

/** Where the proxy rewrites a path a store does not serve. A `_` folder is never routable, so this always 404s. */
export const STORE_NOT_FOUND_PATHNAME = '/_store-not-found';

/** The route segment Next.js generates for a page's `opengraph-image` / `twitter-image` file. */
const METADATA_IMAGE_SEGMENT = /^(?:opengraph|twitter)-image(?:-[\w-]+)?$/;

type Segment =
  | { kind: 'static'; value: string }
  | { kind: 'dynamic'; name: string }
  | { kind: 'catch-all'; name: string }
  | { kind: 'optional-catch-all'; name: string };

type RoutePattern = { key: string; segments: Segment[]; policy: StoreRoutePolicy };

/** URL segments of a page folder key, or `null` for a parallel-slot page that never owns a URL. */
export function storeRouteUrlSegments(key: string): string[] | null {
  const parts = key.split('/').filter(Boolean);
  if (parts.some((part) => part.startsWith('@'))) return null;
  return parts.filter((part) => !/^\(.*\)$/.test(part));
}

function parseSegment(part: string): Segment {
  const optionalCatchAll = /^\[\[\.\.\.(\w+)\]\]$/.exec(part);
  if (optionalCatchAll) return { kind: 'optional-catch-all', name: optionalCatchAll[1] };
  const catchAll = /^\[\.\.\.(\w+)\]$/.exec(part);
  if (catchAll) return { kind: 'catch-all', name: catchAll[1] };
  const dynamic = /^\[(\w+)\]$/.exec(part);
  if (dynamic) return { kind: 'dynamic', name: dynamic[1] };
  return { kind: 'static', value: part };
}

const ROUTE_PATTERNS: readonly RoutePattern[] = Object.entries(STORE_ROUTE_POLICY).flatMap(([key, policy]) => {
  const parts = storeRouteUrlSegments(key);
  return parts === null ? [] : [{ key, segments: parts.map(parseSegment), policy }];
});

const SPECIFICITY: Record<Segment['kind'], number> = {
  static: 0,
  dynamic: 1,
  'catch-all': 2,
  'optional-catch-all': 3,
};

/** Params of `segments` matched against the path, or `null`; also the per-segment specificity of the match. */
function matchPattern(segments: Segment[], path: string[]): { params: Record<string, string>; rank: number[] } | null {
  const params: Record<string, string> = {};
  const rank: number[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    rank.push(SPECIFICITY[segment.kind]);
    if (segment.kind === 'catch-all' || segment.kind === 'optional-catch-all') {
      const rest = path.slice(index);
      if (segment.kind === 'catch-all' && rest.length === 0) return null;
      params[segment.name] = rest.join('/');
      return index === segments.length - 1 ? { params, rank } : null;
    }
    const value = path[index];
    if (value === undefined) return null;
    if (segment.kind === 'static' && segment.value !== value) return null;
    if (segment.kind === 'dynamic') params[segment.name] = value;
  }
  return segments.length === path.length ? { params, rank } : null;
}

function compareRank(left: number[], right: number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? -1) - (right[index] ?? -1);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * The policy row for a URL path (without the base path) and the params the page would receive,
 * or `null` when no page serves the path. Static segments win over dynamic ones, as in Next.js.
 */
export function matchStoreRoute(
  pathname: string,
): { key: string; policy: StoreRoutePolicy; params: Record<string, string> } | null {
  const path = pathname.split('/').filter(Boolean);
  let best: { pattern: RoutePattern; params: Record<string, string>; rank: number[] } | null = null;
  for (const pattern of ROUTE_PATTERNS) {
    const match = matchPattern(pattern.segments, path);
    if (match && (!best || compareRank(match.rank, best.rank) < 0)) best = { pattern, ...match };
  }
  return best ? { key: best.pattern.key, policy: best.pattern.policy, params: best.params } : null;
}

export type StoreRouteDecision =
  | { kind: 'allow' }
  | { kind: 'not-found' }
  /** Open the store seller's shop. */
  | { kind: 'store-home' };

function decidePage(
  { policy, params }: NonNullable<ReturnType<typeof matchStoreRoute>>,
  storeSeller: string,
): StoreRouteDecision {
  if (policy.mode === 'both') return { kind: 'allow' };
  if (policy.mode === 'marketplace-only') return { kind: 'not-found' };
  if (policy.scope === 'store-home') return { kind: 'store-home' };
  if (policy.scope === 'seller-path' || policy.scope === 'seller-path-and-viewer') {
    return params.sellerPubky === storeSeller ? { kind: 'allow' } : { kind: 'not-found' };
  }
  // `seller-viewer`: the viewer is known only in the browser; the route guard checks it.
  return { kind: 'allow' };
}

/**
 * What a store serves at a URL path (without the base path). Paths no page serves are 404,
 * except `/_next` and `/api`, the listed route handlers, and files with an extension (the
 * `public/` assets and the service worker). A page's Open Graph and Twitter images follow
 * their page, and never open the store home.
 */
export function decideStoreRoute(pathname: string, storeSeller: string): StoreRouteDecision {
  if (pathname.startsWith('/_next/') || pathname === '/api' || pathname.startsWith('/api/')) return { kind: 'allow' };
  if (STORE_ROUTE_HANDLER_PATHS.includes(pathname)) return { kind: 'allow' };

  const segments = pathname.split('/').filter(Boolean);
  const last = segments.at(-1);
  if (last !== undefined && METADATA_IMAGE_SEGMENT.test(last)) {
    const page = matchStoreRoute(`/${segments.slice(0, -1).join('/')}`);
    return page && decidePage(page, storeSeller).kind === 'allow' ? { kind: 'allow' } : { kind: 'not-found' };
  }

  const page = matchStoreRoute(pathname);
  if (!page) return last?.includes('.') ? { kind: 'allow' } : { kind: 'not-found' };
  return decidePage(page, storeSeller);
}

/** Whether a store lets only the store seller, signed in, open this path (selling tools). */
export function isStoreSellerViewerRoute(pathname: string): boolean {
  const policy = matchStoreRoute(pathname)?.policy;
  return (
    policy?.mode === 'store-scoped' && (policy.scope === 'seller-viewer' || policy.scope === 'seller-path-and-viewer')
  );
}
