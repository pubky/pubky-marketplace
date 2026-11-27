import { type NextRequest, NextResponse } from 'next/server';
import { APP_ROUTES, getMarketplaceShopRoute } from '@/app/routes';
import { decideStoreRoute, STORE_NOT_FOUND_PATHNAME } from '@/app/store-route-policy';
import type { StoreState } from '@/config/store-mode';
import { getEmbeddedFlag, getFrameAncestors } from '@/libs/runtime-config/runtime-config';
import { buildFramingHeaders } from '@/libs/security/headers';
import { resolveStoreState } from '@/libs/store-state/store-state.server';

/**
 * Sets the framing and opener headers on every document and API response.
 *
 * The `frame-ancestors` allow-list is a runtime value, so it cannot live in
 * `next.config.ts` `headers()`, which Next.js evaluates once at build time. One
 * image therefore serves a locked-down deployment and an embeddable one,
 * depending only on `PUBKY_RUNTIME_FRAME_ANCESTORS`.
 *
 * In store mode it also applies the store route policy (`src/app/store-route-policy.ts`).
 */
const STORE_UNAVAILABLE_HTML = `<!doctype html><html lang="en-US"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>This shop is temporarily unavailable</title></head><body><main><h1>This shop is temporarily unavailable</h1><p>Please check back soon.</p></main></body></html>`;

export async function proxy(request: NextRequest) {
  const state = await resolveStoreState();
  let response = storeModeResponse(request, state);
  if (!response) {
    if (state.kind === 'off' || !state.claimMode) response = NextResponse.next();
    else {
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set('x-pubky-pathname', request.nextUrl.pathname);
      response = NextResponse.next({ request: { headers: requestHeaders } });
    }
  }
  const pathname = request.nextUrl.pathname;
  if (state.kind !== 'off' && state.claimMode && (pathname === '/' || pathname === APP_ROUTES.SETUP)) {
    response.headers.set('X-Robots-Tag', 'noindex');
  }
  if (pathname === APP_ROUTES.SETUP) response.headers.set('Referrer-Policy', 'no-referrer');
  for (const { key, value } of buildFramingHeaders(getFrameAncestors(), getEmbeddedFlag())) {
    response.headers.set(key, value);
  }
  return response;
}

function storeModeResponse(request: NextRequest, state: StoreState): NextResponse | null {
  const pathname = request.nextUrl.pathname;
  if (state.kind === 'off') {
    if (pathname !== '/') return null;
    // A redirect in `next.config.ts` would run before this proxy and hide an unclaimed store's holding page.
    const url = request.nextUrl.clone();
    url.pathname = APP_ROUTES.MARKETPLACE;
    return NextResponse.redirect(url, 307);
  }
  if (state.kind !== 'unavailable' && pathname === STORE_NOT_FOUND_PATHNAME) return null;
  const decision = decideStoreRoute(pathname, state);
  if (decision.kind === 'allow') return null;
  if (decision.kind === 'unavailable') {
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'STORE_UNAVAILABLE' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    // Rewriting to an app-owned page can also render the feeds catch-all in a production build.
    return new NextResponse(STORE_UNAVAILABLE_HTML, {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  const url = request.nextUrl.clone();
  if (decision.kind === 'store-home' && state.kind === 'claimed') {
    url.pathname = getMarketplaceShopRoute(state.seller);
    url.search = '';
    return NextResponse.redirect(url, 307);
  }
  url.pathname = STORE_NOT_FOUND_PATHNAME;
  return NextResponse.rewrite(url);
}

export const config = {
  // Static build output and optimised images are not documents, so framing policy is moot
  // there; skipping them keeps the proxy off the CDN-served asset path.
  matcher: ['/((?!_next/static|_next/image).*)'],
};
