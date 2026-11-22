import { type NextRequest, NextResponse } from 'next/server';
import { getMarketplaceShopRoute } from '@/app/routes';
import { decideStoreRoute, STORE_NOT_FOUND_PATHNAME } from '@/app/store-route-policy';
import { getStoreSeller } from '@/config/store-mode';
import { getEmbeddedFlag, getFrameAncestors } from '@/libs/runtime-config/runtime-config';
import { buildFramingHeaders } from '@/libs/security/headers';

/**
 * Sets the framing and opener headers on every document and API response.
 *
 * The `frame-ancestors` allow-list is a runtime value, so it cannot live in
 * `next.config.ts` `headers()`, which Next.js evaluates once at build time. One
 * image therefore serves a locked-down deployment and an embeddable one,
 * depending only on `PUBKY_RUNTIME_FRAME_ANCESTORS`.
 *
 * In store mode (`PUBKY_RUNTIME_STORE_SELLER`) it also applies the store route
 * policy (`src/app/store-route-policy.ts`): the entry routes open the store
 * seller's shop and every path the store does not serve answers 404.
 */
export function proxy(request: NextRequest) {
  const response = storeModeResponse(request) ?? NextResponse.next();
  for (const { key, value } of buildFramingHeaders(getFrameAncestors(), getEmbeddedFlag())) {
    response.headers.set(key, value);
  }
  return response;
}

function storeModeResponse(request: NextRequest): NextResponse | null {
  const storeSeller = getStoreSeller();
  if (storeSeller === null) return null;
  const decision = decideStoreRoute(request.nextUrl.pathname, storeSeller);
  if (decision.kind === 'allow') return null;
  const url = request.nextUrl.clone();
  if (decision.kind === 'store-home') {
    url.pathname = getMarketplaceShopRoute(storeSeller);
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
