import type { StoreState } from '@/config/store-mode';

/**
 * Which pages and route handlers a store-mode deployment (see `@/config/store-mode`) serves. Every `page.tsx` and every `route.ts` under `src/app`, `/api`
 * included, has one row, keyed by its folder; `store-route-policy.test.ts` fails on a file without
 * a row, and at run time a store answers 404 for any path that matches no row, so a new page or
 * handler stays hidden in store mode until it is classified here. Outside store mode these tables
 * change nothing.
 *
 * - `both`: served as in the full Market.
 * - `marketplace-only`: the full Market's browse, search and social pages, and what only the hosted
 *   Market runs; 404 in a store.
 * - `store-scoped`: served only for the store seller, as `scope` says.
 */
type StoreRouteScope =
  /** The Market's entry routes; a store opens the store seller's shop instead. */
  | 'store-home'
  /** A page of the seller in its `[sellerPubky]` segment; only the store seller's pages exist. */
  | 'seller-path'
  /** Selling tools; only the store seller, signed in, may use them. */
  | 'seller-viewer'
  /** The store seller's own record, edited by the store seller: `seller-path` and `seller-viewer`. */
  | 'seller-path-and-viewer'
  /** First-boot claiming, or the claimed summary after it. */
  | 'store-setup';

type StoreRoutePolicy =
  | { mode: 'both' }
  | { mode: 'marketplace-only' }
  | { mode: 'store-scoped'; scope: StoreRouteScope };

const BOTH: StoreRoutePolicy = { mode: 'both' };
const MARKETPLACE_ONLY: StoreRoutePolicy = { mode: 'marketplace-only' };
const STORE_HOME: StoreRoutePolicy = { mode: 'store-scoped', scope: 'store-home' };
const SELLER_PATH: StoreRoutePolicy = { mode: 'store-scoped', scope: 'seller-path' };
const SELLER_VIEWER: StoreRoutePolicy = { mode: 'store-scoped', scope: 'seller-viewer' };
const SELLER_PATH_AND_VIEWER: StoreRoutePolicy = { mode: 'store-scoped', scope: 'seller-path-and-viewer' };
const STORE_SETUP: StoreRoutePolicy = { mode: 'store-scoped', scope: 'store-setup' };

// exported for tests
/** The page folders under `src/app`, with route groups `(...)` and parallel slots `@...` as on disk. */
export const STORE_PAGE_POLICY: Readonly<Record<string, StoreRoutePolicy>> = {
  '/': STORE_HOME,
  '/(auth)/logout': BOTH,
  '/(auth)/sign-in': BOTH,
  '/complete-profile': BOTH,
  // Its form files notices with the hosted Market's support desk (`/api/copyright`).
  '/copyright': MARKETPLACE_ONLY,
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
  '/sentry-test': MARKETPLACE_ONLY,
  '/setup': STORE_SETUP,
  '/store-unavailable': MARKETPLACE_ONLY,
};

type StoreRouteHandlerRow = { policy: StoreRoutePolicy; reason: string };

const GRANT_BFF = 'Marketplace grant BFF: sign-in and selling approvals for the store seller and buyers.';
const CLI_GRANT =
  'Headless marketplace grant for CLI tools (`SHOP_BFF_CLI_GRANT_ENABLED`); no store client uses it, and a store signs in through the browser grant flow.';
const STUDIO_IMPORT =
  "The store seller's studio inventory import fetches through it; it holds no credential and only reads public catalogues.";

// exported for tests
/** The route handler folders under `src/app`, `/api` included, each with why a store serves it or not. */
export const STORE_ROUTE_HANDLER_POLICY: Readonly<Record<string, StoreRouteHandlerRow>> = {
  '/api/build': { policy: BOTH, reason: 'The deployed commit, for release and install checks.' },
  '/api/cli/grant-challenges': { policy: MARKETPLACE_ONLY, reason: CLI_GRANT },
  '/api/cli/grant-challenges/[challengeId]/verify': { policy: MARKETPLACE_ONLY, reason: CLI_GRANT },
  '/api/cli/grant-flows/[stateId]/cancel': { policy: MARKETPLACE_ONLY, reason: CLI_GRANT },
  '/api/cli/grant-flows/[stateId]/claim': { policy: MARKETPLACE_ONLY, reason: CLI_GRANT },
  '/api/cli/grant-flows/[stateId]/result-nonces': { policy: MARKETPLACE_ONLY, reason: CLI_GRANT },
  '/api/cli/grant-flows/[stateId]/result-ticket': { policy: MARKETPLACE_ONLY, reason: CLI_GRANT },
  '/api/cli/grant-flows/[stateId]/status': { policy: MARKETPLACE_ONLY, reason: CLI_GRANT },
  '/api/copyright': {
    policy: MARKETPLACE_ONLY,
    reason: "Files copyright notices with the hosted Market's support desk using its server secrets.",
  },
  '/api/fx-rate': {
    policy: BOTH,
    reason: "The indicative bitcoin rate behind the store's converted price hints.",
  },
  '/api/import-image': { policy: BOTH, reason: STUDIO_IMPORT },
  '/api/import-store': { policy: BOTH, reason: STUDIO_IMPORT },
  '/api/marketplace/bootstrap-challenges': { policy: BOTH, reason: GRANT_BFF },
  '/api/marketplace/bootstrap-challenges/[challengeId]/verify': { policy: BOTH, reason: GRANT_BFF },
  '/api/marketplace/bootstrap-flows/[stateId]/cancel': { policy: BOTH, reason: GRANT_BFF },
  '/api/marketplace/bootstrap-flows/[stateId]/status': { policy: BOTH, reason: GRANT_BFF },
  '/api/marketplace/client-region': {
    policy: BOTH,
    reason: "The visitor's country for region modes, which apply to the store's commerce too.",
  },
  '/api/marketplace/grant-cleanup': {
    policy: BOTH,
    reason: "The scheduler's cleanup of the grant BFF's expired state.",
  },
  '/api/marketplace/grant-flows': { policy: BOTH, reason: GRANT_BFF },
  '/api/marketplace/grant-flows/[stateId]/cancel': { policy: BOTH, reason: GRANT_BFF },
  '/api/marketplace/grant-flows/[stateId]/status': { policy: BOTH, reason: GRANT_BFF },
  '/api/marketplace/health': { policy: BOTH, reason: 'Grant BFF readiness, for deploy and install checks.' },
  '/api/marketplace/session': { policy: BOTH, reason: GRANT_BFF },
  '/api/marketplace/store': {
    policy: BOTH,
    reason: 'The public resolved store state used to finish first-boot claiming.',
  },
  '/api/paykit-creator': {
    policy: BOTH,
    reason:
      "Whether Paykit already holds a creator, for the store seller's Bitkit setup in its payment settings; it holds no credential and answers only held or not.",
  },
  '/api/report': {
    policy: MARKETPLACE_ONLY,
    reason: "Reports posts, listings and reviews to the hosted Market's support desk using its server secrets.",
  },
  '/api/sentry-test': { policy: MARKETPLACE_ONLY, reason: 'Development and preview error-reporting check.' },
  '/auth/passport/return': { policy: BOTH, reason: 'The Pubky Passport sign-in popup returns here.' },
  '/social-handoff/[...segments]': {
    policy: MARKETPLACE_ONLY,
    reason: 'Retired social pages open in Pubky App from the hosted Market only.',
  },
  '/llms.txt': {
    policy: MARKETPLACE_ONLY,
    reason: "Agent guide to the hosted Market's shared index; a store is one seller's shop.",
  },
};

/**
 * Where the proxy rewrites a path a store does not serve: the route Next.js builds from
 * `src/app/not-found.tsx`, which answers 404 with the app’s not-found page.
 * `scripts/store-mode-served-check.mjs` checks this against a production build.
 */
export const STORE_NOT_FOUND_PATHNAME = '/_not-found';
export const STORE_UNAVAILABLE_PATHNAME = '/store-unavailable';

/** The route segment Next.js generates for a page's `opengraph-image` / `twitter-image` file. */
const METADATA_IMAGE_SEGMENT = /^(?:opengraph|twitter)-image(?:-[\w-]+)?$/;

// exported for tests
/**
 * The files a store serves by name: everything under `public/`, the service worker Serwist writes
 * there at build time, and the favicon from `src/app/favicon.ico`. `store-route-policy.test.ts` fails
 * when this differs from what is on disk; any other path with an extension is 404 in a store.
 */
export const STORE_STATIC_FILES: ReadonlySet<string> = new Set([
  '/franky.png',
  '/images/bg-home-mobile.svg',
  '/images/bitkit/app-store.png',
  '/images/bitkit/google-play.png',
  '/images/bitkit/logo.svg',
  '/images/key.webp',
  '/images/keyring.webp',
  '/images/logo-pubky-ring.svg',
  '/images/manifest/web-app-manifest-1280x720.png',
  '/images/manifest/web-app-manifest-128x128.png',
  '/images/manifest/web-app-manifest-144x144.png',
  '/images/manifest/web-app-manifest-152x152.png',
  '/images/manifest/web-app-manifest-180x180.png',
  '/images/manifest/web-app-manifest-192x192.png',
  '/images/manifest/web-app-manifest-384x384.png',
  '/images/manifest/web-app-manifest-48x48.png',
  '/images/manifest/web-app-manifest-512x512.png',
  '/images/manifest/web-app-manifest-640x1136.png',
  '/images/manifest/web-app-manifest-72x72.png',
  '/images/manifest/web-app-manifest-96x96.png',
  '/images/marketplace/marketplace-icon.png',
  '/images/pubky-ring-qr-example.webp',
  '/images/qr-blurred.png',
  '/images/ring-logo.svg',
  '/images/scan.webp',
  '/images/sign-in.webp',
  '/images/sign-in/cloud.webp',
  '/images/sign-in/google.svg',
  '/images/synonym-grey-logo.svg',
  '/images/tag.webp',
  '/images/tether-text.svg',
  '/manifest.json',
  '/preview.webp',
  '/pubky-favicon.svg',
  '/pubky-logo-on-light.svg',
  '/pubky-logo.svg',
  '/social-handoff.js',
  '/sw.js',
  '/sw.js.map',
  '/favicon.ico',
]);

/**
 * A React Server Components request for a page: `<page>.rsc`, `<page>.prefetch.rsc`, `<page>.segments/...`.
 * A production Next.js server strips the `.rsc` suffix before the proxy runs and sends RSC requests to the page URL
 * with headers; this table still pins the policy for the literal suffixed paths.
 */
const RSC_REQUEST_SUFFIX = /(?:\.prefetch)?\.rsc$|\.segments\/.*$/;

type Segment =
  | { kind: 'static'; value: string }
  | { kind: 'dynamic'; name: string }
  | { kind: 'catch-all'; name: string }
  | { kind: 'optional-catch-all'; name: string };

type RoutePattern = { key: string; segments: Segment[]; policy: StoreRoutePolicy };

const ROUTE_POLICY_ROWS: readonly [string, StoreRoutePolicy][] = [
  ...Object.entries(STORE_PAGE_POLICY),
  ...Object.entries(STORE_ROUTE_HANDLER_POLICY).map(([key, row]): [string, StoreRoutePolicy] => [key, row.policy]),
];

// exported for tests
/** URL segments of a folder key, or `null` for a parallel-slot page that never owns a URL. */
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

const ROUTE_PATTERNS: readonly RoutePattern[] = ROUTE_POLICY_ROWS.flatMap(([key, policy]) => {
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

// exported for tests
/**
 * The policy row for a URL path (without the base path) and the params the page or handler would
 * receive, or `null` when none serves the path. Static segments win over dynamic ones, as in Next.js.
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
  | { kind: 'unavailable' }
  /** Open the store seller's shop. */
  | { kind: 'store-home' };

function decidePage(
  { policy, params }: NonNullable<ReturnType<typeof matchStoreRoute>>,
  state: Extract<StoreState, { kind: 'claimed' }>,
): StoreRouteDecision {
  if (policy.mode === 'both') return { kind: 'allow' };
  if (policy.mode === 'marketplace-only') return { kind: 'not-found' };
  if (policy.scope === 'store-home') return { kind: 'store-home' };
  if (policy.scope === 'store-setup') {
    return state.source === 'claim' ? { kind: 'allow' } : { kind: 'not-found' };
  }
  if (policy.scope === 'seller-path' || policy.scope === 'seller-path-and-viewer') {
    return params.sellerPubky === state.seller ? { kind: 'allow' } : { kind: 'not-found' };
  }
  // `seller-viewer`: the viewer is known only in the browser; the route guard checks it.
  return { kind: 'allow' };
}

const UNCLAIMED_PAGES = new Set(['/', '/setup', '/(auth)/sign-in', '/(auth)/logout', '/complete-profile']);
const UNCLAIMED_HANDLERS = new Set(['/api/build', '/api/marketplace/health', '/api/marketplace/store']);

function isUnclaimedGrantHandler(key: string): boolean {
  return (
    key === '/api/marketplace/session' ||
    key.startsWith('/api/marketplace/bootstrap-') ||
    key.startsWith('/api/marketplace/grant-')
  );
}

function decideUnclaimedRoute(pathname: string): StoreRouteDecision {
  if (RSC_REQUEST_SUFFIX.test(pathname)) {
    const decision = decideUnclaimedRoute(pathname.replace(RSC_REQUEST_SUFFIX, '') || '/');
    return decision.kind === 'allow' ? decision : { kind: 'not-found' };
  }
  const page = matchStoreRoute(pathname);
  if (!page) return { kind: 'not-found' };
  if (UNCLAIMED_PAGES.has(page.key) || UNCLAIMED_HANDLERS.has(page.key) || isUnclaimedGrantHandler(page.key)) {
    return { kind: 'allow' };
  }
  return { kind: 'not-found' };
}

/**
 * What a store serves at a URL path (without the base path). Paths no page or route handler
 * serves are 404, except `/_next` and {@link STORE_STATIC_FILES}. A page's React Server Components
 * requests follow their page. A page's Open Graph and Twitter images are served when their page is,
 * or when it is an entry route (the Market's image, which the store's other pages point at), and
 * never open the store home.
 */
export function decideStoreRoute(pathname: string, state: StoreState): StoreRouteDecision {
  if (pathname.startsWith('/_next/') || STORE_STATIC_FILES.has(pathname)) return { kind: 'allow' };
  if (state.kind === 'off') return { kind: 'allow' };
  if (state.kind === 'unavailable') return { kind: 'unavailable' };
  if (state.kind === 'unclaimed') return decideUnclaimedRoute(pathname);
  if (RSC_REQUEST_SUFFIX.test(pathname)) {
    const decision = decideStoreRoute(pathname.replace(RSC_REQUEST_SUFFIX, '') || '/', state);
    return decision.kind === 'allow' ? decision : { kind: 'not-found' };
  }

  const segments = pathname.split('/').filter(Boolean);
  const last = segments.at(-1);
  if (last !== undefined && METADATA_IMAGE_SEGMENT.test(last)) {
    const page = matchStoreRoute(`/${segments.slice(0, -1).join('/')}`);
    const kind = page ? decidePage(page, state).kind : 'not-found';
    return kind === 'allow' || kind === 'store-home' ? { kind: 'allow' } : { kind: 'not-found' };
  }

  const page = matchStoreRoute(pathname);
  if (!page) return { kind: 'not-found' };
  return decidePage(page, state);
}

/** Whether a store lets only the store seller, signed in, open this path (selling tools). */
export function isStoreSellerViewerRoute(pathname: string): boolean {
  const policy = matchStoreRoute(pathname)?.policy;
  return (
    policy?.mode === 'store-scoped' && (policy.scope === 'seller-viewer' || policy.scope === 'seller-path-and-viewer')
  );
}
