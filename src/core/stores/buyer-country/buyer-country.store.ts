import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { BUYER_COUNTRY_PERSIST_KEY } from '../persistedKeys';

export interface BuyerCountryStore {
  /** The country the buyer said they live in (ISO 3166-1 alpha-2, uppercase), or null until they say. */
  country: string | null;
  setCountry: (countryCode: string | null) => void;
}

/**
 * The buyer's country, remembered on this device so the "Country you live in" prompt appears
 * once (legal launch plan C2). It is sent in clear text with the commands that sell, so the
 * transaction service can apply the EU fence without opening the sealed address.
 */
export const useBuyerCountryStore = create<BuyerCountryStore>()(
  persist(
    (set) => ({
      country: null,
      setCountry: (countryCode) => set({ country: countryCode ? countryCode.toUpperCase() : null }),
    }),
    {
      name: BUYER_COUNTRY_PERSIST_KEY,
      version: 1,
      partialize: (state) => ({ country: state.country }),
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<BuyerCountryStore>;
        return {
          ...current,
          country: typeof stored.country === 'string' && /^[A-Z]{2}$/.test(stored.country) ? stored.country : null,
        };
      },
    },
  ),
);
