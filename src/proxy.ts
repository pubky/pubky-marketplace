import { type NextRequest, NextResponse } from 'next/server';
import { getMarketplaceShopRoute } from '@/app/routes';
import { decideStoreRoute, STORE_NOT_FOUND_PATHNAME, STORE_UNAVAILABLE_PATHNAME } from '@/app/store-route-policy';
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
export async function proxy(request: NextRequest) {
  const response = storeModeResponse(request, await resolveStoreState()) ?? NextResponse.next();
  for (const { key, value } of buildFramingHeaders(getFrameAncestors(), getEmbeddedFlag())) {
    response.headers.set(key, value);
  }
  return response;
}

function storeModeResponse(request: NextRequest, state: StoreState): NextResponse | null {
  if (state.kind === 'off') return null;
  const pathname = request.nextUrl.pathname;
  if (pathname === STORE_UNAVAILABLE_PATHNAME) return null;
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
    const url = request.nextUrl.clone();
    url.pathname = STORE_UNAVAILABLE_PATHNAME;
    url.search = '';
    return NextResponse.rewrite(url, { status: 503 });
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
