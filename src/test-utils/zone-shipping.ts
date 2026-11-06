import type { useMarketplaceShippingGroups } from '@/hooks/useMarketplaceShippingGroups/useMarketplaceShippingGroups';

type ZoneShipping = ReturnType<typeof useMarketplaceShippingGroups>;

/** The checkout hook's zone-shipping member for a cart with no zone-priced line. */
export function noZoneShipping(overrides: Partial<ZoneShipping> = {}): ZoneShipping {
  return {
    groups: [],
    hasZonedGroups: false,
    zonedItemIds: new Set(),
    amounts: [],
    setRate: () => undefined,
    refresh: () => undefined,
    choices: () => ({ ok: true, choices: [] }),
    ...overrides,
  };
}
