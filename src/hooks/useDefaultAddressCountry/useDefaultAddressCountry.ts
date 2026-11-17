'use client';

import { useClientRegion } from '@/hooks/useClientRegion/useClientRegion';
import { addressCountryDefault } from '@/libs/commerce/commerce-availability';
import { browserAddressCountry } from '@/libs/commerce/postal-address';
import { getRegionPolicy } from '@/libs/runtime-config/runtime-config';

/**
 * The country a new delivery address starts with (see {@link addressCountryDefault}): the browser's
 * where no region is blocked, otherwise the visitor's IP country when it is open, otherwise empty so
 * the buyer chooses. Read after mount, so the server-rendered form and the first client render agree.
 */
export function useDefaultAddressCountry(): string {
  const client = useClientRegion();
  return addressCountryDefault(getRegionPolicy(), client, browserAddressCountry());
}
