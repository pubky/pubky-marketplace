'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { CommerceController } from '@/controllers/commerce/commerce';
import { useClientRegion } from '@/hooks/useClientRegion/useClientRegion';
import { type CommerceAvailability, evaluateCommerceAvailability } from '@/libs/commerce/commerce-availability';
import { getRegionPolicy } from '@/libs/runtime-config/runtime-config';
import { useAuthStore } from '@/stores/auth/auth.store';

/**
 * Whether this seller may sell here: the blocked-region policy applied to their IP country and to the
 * country of their own shop. Inert unless the policy blocks a region, and then the shop is read from
 * the local database only.
 */
export function useSellingAvailability(): CommerceAvailability {
  const policy = getRegionPolicy();
  const client = useClientRegion();
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  const shop = useLiveQuery(
    () => (policy.usesClientRegion && currentUserPubky ? CommerceController.getShop(currentUserPubky) : null),
    [policy.usesClientRegion, currentUserPubky],
  );
  return evaluateCommerceAvailability(policy, { declaredCountry: shop?.record.location.countryCode, client });
}
