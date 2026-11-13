import { beforeEach, describe, expect, it } from 'vitest';
import {
  getMarketplaceCheckoutRoute,
  getMarketplaceDropCheckoutRoute,
  getMarketplaceOfferCheckoutRoute,
} from '@/libs/commerce/checkout-phase';
import {
  clearRouteGuardReturnTo,
  consumeRouteGuardReturnTo,
  isValidRouteGuardReturnToPath,
  ROUTE_GUARD_RETURN_TO_STORAGE_KEY,
  routeGuardReturnToWithSearch,
  storeRouteGuardReturnTo,
} from './RouteGuardProvider.returnPath';

describe('RouteGuardProvider return path', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('validates same-origin relative paths only', () => {
    expect(isValidRouteGuardReturnToPath('/marketplace/orders')).toBe(true);
    expect(isValidRouteGuardReturnToPath('/marketplace/orders?tab=open#x')).toBe(true);
    expect(isValidRouteGuardReturnToPath('https://evil')).toBe(false);
    expect(isValidRouteGuardReturnToPath('//evil')).toBe(false);
    expect(isValidRouteGuardReturnToPath('javascript:alert(1)')).toBe(false);
  });

  it('rejects backslash, encoded-backslash, whitespace, control, and oversized paths', () => {
    expect(isValidRouteGuardReturnToPath('/\\evil.com')).toBe(false);
    expect(isValidRouteGuardReturnToPath('/\\\\evil.com')).toBe(false);
    // %5C is not decoded by WHATWG origin checks; reject so a later client decode cannot
    // turn it into a protocol-relative `/\evil.com` open redirect.
    expect(isValidRouteGuardReturnToPath('/%5Cevil.com')).toBe(false);
    expect(isValidRouteGuardReturnToPath('/ /x')).toBe(false);
    expect(isValidRouteGuardReturnToPath('/\tx')).toBe(false);
    expect(isValidRouteGuardReturnToPath(`/${'a'.repeat(299)}`)).toBe(false);
  });

  it('stores and consumes an allowed route once', () => {
    storeRouteGuardReturnTo('/marketplace/orders');

    expect(consumeRouteGuardReturnTo(['/marketplace'])).toBe('/marketplace/orders');
    expect(window.sessionStorage.getItem(ROUTE_GUARD_RETURN_TO_STORAGE_KEY)).toBeNull();
    expect(consumeRouteGuardReturnTo(['/marketplace'])).toBeNull();
  });

  it('clears a stored route that is not allowed', () => {
    storeRouteGuardReturnTo('/marketplace/orders');

    expect(consumeRouteGuardReturnTo(['/feed'])).toBeNull();
    expect(window.sessionStorage.getItem(ROUTE_GUARD_RETURN_TO_STORAGE_KEY)).toBeNull();
  });

  it('keeps the query a guarded deep link was opened with, or drops it when it fails validation', () => {
    expect(routeGuardReturnToWithSearch('/marketplace/checkout', '?offer=abc&seller=xyz')).toBe(
      '/marketplace/checkout?offer=abc&seller=xyz',
    );
    expect(routeGuardReturnToWithSearch('/marketplace/checkout', '')).toBe('/marketplace/checkout');
    expect(routeGuardReturnToWithSearch('/marketplace/checkout', '?')).toBe('/marketplace/checkout');
    expect(routeGuardReturnToWithSearch('/marketplace/checkout', '?next=%5Cevil.test')).toBe('/marketplace/checkout');
    expect(routeGuardReturnToWithSearch('/marketplace/checkout', `?q=${'a'.repeat(300)}`)).toBe(
      '/marketplace/checkout',
    );
  });

  it('keeps the longest checkout deep links the app builds', () => {
    const uuid = '018f47d2-6a27-7c23-b51e-000000000002';
    const drop = getMarketplaceDropCheckoutRoute({ sellerPubky: 'o'.repeat(52), dropId: uuid, listingId: uuid });
    for (const route of [
      getMarketplaceCheckoutRoute(uuid),
      getMarketplaceOfferCheckoutRoute(`offer:${uuid}`),
      `${drop}&variant=${uuid}`,
    ]) {
      const [pathname, query] = route.split('?');
      expect(routeGuardReturnToWithSearch(pathname, `?${query}`)).toBe(route);
      storeRouteGuardReturnTo(route);
      expect(consumeRouteGuardReturnTo(['/marketplace'])).toBe(route);
    }
  });

  it('checks the allow-list against the path and not its query', () => {
    storeRouteGuardReturnTo('/settings?tab=account');
    expect(consumeRouteGuardReturnTo(['/settings'])).toBe('/settings?tab=account');

    storeRouteGuardReturnTo('/sign-in?next=/settings');
    expect(consumeRouteGuardReturnTo(['/settings'])).toBeNull();
  });

  it('clears a stored return path without consuming it', () => {
    storeRouteGuardReturnTo('/marketplace/orders');

    clearRouteGuardReturnTo();

    expect(window.sessionStorage.getItem(ROUTE_GUARD_RETURN_TO_STORAGE_KEY)).toBeNull();
    expect(consumeRouteGuardReturnTo(['/marketplace'])).toBeNull();
  });
});
