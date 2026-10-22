'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { CommerceController } from '@/controllers/commerce/commerce';
import { useClientRegion } from '@/hooks/useClientRegion/useClientRegion';
import { type CommerceAvailability, evaluateCommerceAvailability } from '@/libs/commerce/commerce-availability';
import { getRegionPolicy } from '@/libs/runtime-config/runtime-config';
import { useAuthStore } from '@/stores/auth/auth.store';

/**
 * Whether this seller may sell here: the blocked-region policy applied to their IP country and, unless
 * `byShopCountry` is off, to the country of their own shop (the storefront settings turn it off, so a
 * seller whose shop is in a blocked country can still open them to change it). Inert unless the policy blocks a region, and then the shop is read
 * from the local database only.
 */
export function useSellingAvailability({
  byShopCountry = true,
}: { byShopCountry?: boolean } = {}): CommerceAvailability {
  const policy = getRegionPolicy();
  const client = useClientRegion();
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  const shop = useLiveQuery(
    () =>
      byShopCountry && policy.usesClientRegion && currentUserPubky
        ? CommerceController.getShop(currentUserPubky)
        : null,
    [byShopCountry, policy.usesClientRegion, currentUserPubky],
  );
  return evaluateCommerceAvailability(policy, { declaredCountry: shop?.record.location.countryCode, client });
}
