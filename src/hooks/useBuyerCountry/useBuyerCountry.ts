'use client';

import { CommerceController } from '@/controllers/commerce/commerce';
import { getRegionPolicy } from '@/libs/runtime-config/runtime-config';
import { useAuthStore } from '@/stores/auth/auth.store';
import { buyerCountryFor, useBuyerCountryStore } from '@/stores/buyer-country/buyer-country.store';

export interface UseBuyerCountryResult {
  /** Some region is nuanced or blocked, so commands that sell carry the country and the prompt may appear. */
  enabled: boolean;
  /** The country the buyer said they live in on this device, or null until they say. */
  country: string | null;
  setCountry: (countryCode: string | null) => void;
}

/** The buyer's remembered "Country you live in" (legal launch plan C2). */
export function useBuyerCountry(): UseBuyerCountryResult {
  const pubky = useAuthStore((state) => state.currentUserPubky);
  const country = useBuyerCountryStore((state) => buyerCountryFor(state, pubky));
  return {
    enabled: !getRegionPolicy().allOpen,
    country,
    setCountry: (countryCode) => CommerceController.setBuyerCountry(countryCode),
  };
}
