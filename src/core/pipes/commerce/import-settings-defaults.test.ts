import { describe, expect, it } from 'vitest';
import type { CommerceListingRecord } from '@/libs/commerce/marketplace-records';
import { createCommerceListingFixture } from '@/test/fixtures/commerce/commerce';
import { shippingDefaultFromListings, shopCountryForImport } from './import-settings-defaults';

function listing(updatedAt: string, shippingOptions: CommerceListingRecord['shippingOptions']) {
  return createCommerceListingFixture({ updatedAt, shippingOptions });
}

describe('shopCountryForImport', () => {
  it('uses the country a seller saved, and never the Shop fallback', () => {
    expect(shopCountryForImport(null)).toBeNull();
    expect(shopCountryForImport({ revision: 2, location: { countryCode: 'US' } })).toBe('US');
    expect(shopCountryForImport({ revision: 5, location: { countryCode: 'CH' } })).toBe('CH');
    expect(shopCountryForImport({ revision: 1, location: { countryCode: 'US' } })).toBeNull();
    expect(shopCountryForImport({ revision: 1, location: { countryCode: 'DE' } })).toBe('DE');
  });
});

describe('shippingDefaultFromListings', () => {
  const free = { id: 'a', pricing: 'free' as const, label: 'Free', estimatedMinDays: 2, estimatedMaxDays: 4 };
  const flat = (amountMinor: number, currency = 'USD', exponent = 2) => ({
    id: 'b',
    pricing: 'flat' as const,
    label: 'Flat',
    price: { amountMinor, currency, exponent },
    estimatedMinDays: 3,
    estimatedMaxDays: 6,
  });

  it('takes the newest listing that has a free or flat option', () => {
    const result = shippingDefaultFromListings([
      listing('2026-01-01T00:00:00.000Z', [free]),
      listing('2026-09-01T00:00:00.000Z', [flat(790)]),
      listing('2026-10-01T00:00:00.000Z', []),
    ]);
    expect(result).toEqual({
      shipping: { mode: 'flat', priceMinor: 790, minDays: 3, maxDays: 6 },
      currency: 'USD',
    });
  });

  it('skips calculated options, a zero flat price and a flat price whose exponent does not fit its currency', () => {
    const calculated = {
      id: 'c',
      pricing: 'calculated' as const,
      label: 'Carrier',
      provider: 'shippo',
      serviceCode: 'x',
      estimatedMinDays: 1,
      estimatedMaxDays: 2,
    };
    expect(
      shippingDefaultFromListings([listing('2026-09-01T00:00:00.000Z', [calculated, flat(0), flat(500, 'JPY', 2)])]),
    ).toBeNull();
    const yen = createCommerceListingFixture({
      updatedAt: '2026-09-01T00:00:00.000Z',
      sale: {
        format: 'fixed_price',
        unitPrice: { amountMinor: 5000, currency: 'JPY', exponent: 0 },
        acceptsOffers: false,
      },
      shippingOptions: [calculated, flat(500, 'JPY', 0)],
    });
    expect(shippingDefaultFromListings([yen])).toEqual({
      shipping: { mode: 'flat', priceMinor: 500, minDays: 3, maxDays: 6 },
      currency: 'JPY',
    });
  });

  it('has nothing to offer a seller with no listings', () => {
    expect(shippingDefaultFromListings([])).toBeNull();
  });
});
