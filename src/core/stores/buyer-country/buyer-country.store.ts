import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { BUYER_COUNTRY_PERSIST_KEY } from '../persistedKeys';

export interface BuyerCountryStore {
  /** The country the buyer said they live in (ISO 3166-1 alpha-2, uppercase), or null until they say. */
  country: string | null;
  /**
   * The pubky whose country this is. A country is only ever read for the account that said it, so a
   * different account on the same device never sees it. Null while nobody was signed in: such a
   * country stays in memory and is never written to the device.
   */
  owner: string | null;
  setCountry: (countryCode: string | null, owner?: string | null) => void;
  reset: () => void;
}

const COUNTRY_PATTERN = /^[A-Z]{2}$/;

/**
 * The country that counts for the signed-in account: the one it said, or one given before anybody
 * signed in. A country left on the device by another account counts for nobody.
 */
export function buyerCountryFor(
  state: Pick<BuyerCountryStore, 'country' | 'owner'>,
  pubky: string | null,
): string | null {
  if (state.country === null) return null;
  return state.owner === null || state.owner === pubky ? state.country : null;
}

/**
 * The buyer's country, remembered on this device so the "Country you live in" prompt appears
 * once (legal launch plan C2). It is sent in clear text with the commands that sell, so the
 * transaction service can apply the EU fence without opening the sealed address.
 *
 * It is stored with the pubky that said it and removed at sign-out. Version 1 stored it with no
 * owner, so any account could have read it; that value is dropped, not adopted.
 */
export const useBuyerCountryStore = create<BuyerCountryStore>()(
  persist(
    (set, get) => ({
      country: null,
      owner: null,
      setCountry: (countryCode, owner = get().owner) =>
        set({ country: countryCode ? countryCode.toUpperCase() : null, owner }),
      reset: () => set({ country: null, owner: null }),
    }),
    {
      name: BUYER_COUNTRY_PERSIST_KEY,
      version: 2,
      migrate: () => ({ country: null, owner: null }),
      partialize: (state) =>
        state.owner === null ? { country: null, owner: null } : { country: state.country, owner: state.owner },
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<BuyerCountryStore>;
        const owner = typeof stored.owner === 'string' && stored.owner !== '' ? stored.owner : null;
        const country =
          owner !== null && typeof stored.country === 'string' && COUNTRY_PATTERN.test(stored.country)
            ? stored.country
            : null;
        return { ...current, country, owner: country === null ? null : owner };
      },
    },
  ),
);
