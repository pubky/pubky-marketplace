'use client';

import { useClientRegion } from '@/hooks/useClientRegion/useClientRegion';
import { type CommerceAvailability, evaluateCommerceAvailability } from '@/libs/commerce/commerce-availability';
import { getRegionPolicy } from '@/libs/runtime-config/runtime-config';
import { useBuyerCountryStore } from '@/stores/buyer-country/buyer-country.store';

/**
 * Whether this visitor may buy or pay here: the blocked-region policy applied to their IP country,
 * the country they declared on this device and, when the page is one seller's, that seller's shop
 * country. Inert unless the policy blocks a region.
 */
export function useCommerceAvailability(input: { sellerCountry?: string | null } = {}): CommerceAvailability {
  const client = useClientRegion();
  const declaredCountry = useBuyerCountryStore((state) => state.country);
  return evaluateCommerceAvailability(getRegionPolicy(), {
    declaredCountry,
    sellerCountry: input.sellerCountry,
    client,
  });
}
