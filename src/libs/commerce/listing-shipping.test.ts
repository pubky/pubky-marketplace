import { describe, expect, it } from 'vitest';
import {
  buildListingShipping,
  type ListingShippingForm,
  listingShippingFormFromRecord,
  ZONE_LEGACY_OPTION_ID,
} from './listing-shipping';
import { commerceShippingProfileRecordSchema } from './marketplace-records';
import { assetForListingCurrency } from './pricing';
import type { ShippingProfileSnapshot } from './shipping-profile';
import { emptyShippingRate, emptyShippingZone } from './shipping-zones-form';

const OWNER = 'o'.repeat(52);
const NOW = '2026-11-05T10:00:00.000Z';

function snapshot(overrides: Record<string, unknown> = {}): ShippingProfileSnapshot {
  return {
    sha256: 'a'.repeat(64),
    record: commerceShippingProfileRecordSchema.parse({
      schemaVersion: 1,
      recordType: 'shipping_profile',
      ownerPubky: OWNER,
      revision: 1,
      createdAt: NOW,
      updatedAt: NOW,
      profileId: 'worldwide',
      name: 'Worldwide',
      currency: 'USD',
      exponent: 2,
      origins: ['US'],
      excludedCountries: [],
      zones: [
        {
          zoneId: 'us',
          name: 'United States',
          countries: ['US'],
          rates: [
            {
              pricing: 'per_item',
              rateId: 'std',
              label: 'Standard',
              firstMinor: 479,
              additionalMinor: 240,
              estimatedMinDays: 4,
              estimatedMaxDays: 8,
            },
          ],
        },
        {
          zoneId: 'row',
          name: 'Rest of world',
          countries: [],
          restOfWorld: true,
          rates: [
            {
              pricing: 'flat',
              rateId: 'int',
              label: 'International',
              amountMinor: 1500,
              estimatedMinDays: 9,
              estimatedMaxDays: 20,
            },
          ],
        },
      ],
      ...overrides,
    }),
  };
}

function form(overrides: Partial<ListingShippingForm> = {}): ListingShippingForm {
  return {
    shippingMode: 'flat',
    shippingProfileId: '',
    shippingZoneValues: [],
    shippingLabel: 'Ground',
    freeShipping: false,
    shippingPrice: '5.00',
    shippingMinDays: '3',
    shippingMaxDays: '7',
    currency: 'USD',
    ...overrides,
  };
}

describe('buildListingShipping', () => {
  it('writes the flat option and no zone members in flat mode', () => {
    const result = buildListingShipping(form(), null);
    expect(result).toMatchObject({
      ok: true,
      fields: {
        shippingOptions: [{ id: 'seller_flat_rate', pricing: 'flat', price: { amountMinor: 500 } }],
        shippingProfileId: undefined,
        shippingZones: undefined,
      },
    });
  });

  it('names the profile and derives the legacy option from the profile as read', () => {
    const result = buildListingShipping(form({ shippingMode: 'profile', shippingProfileId: 'worldwide' }), snapshot());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields.shippingProfileId).toBe('worldwide');
    expect(result.fields.shippingZones).toBeUndefined();
    expect(result.fields.shippingOptions).toHaveLength(1);
    expect(result.fields.shippingOptions[0]?.id).toBe(ZONE_LEGACY_OPTION_ID);
  });

  it('refuses a profile that was not read, or that is another profile', () => {
    expect(buildListingShipping(form({ shippingMode: 'profile', shippingProfileId: 'worldwide' }), null)).toMatchObject(
      {
        ok: false,
        reason: 'profile-missing',
      },
    );
    expect(
      buildListingShipping(form({ shippingMode: 'profile', shippingProfileId: 'other' }), snapshot()),
    ).toMatchObject({
      ok: false,
      reason: 'profile-missing',
    });
  });

  it('refuses a profile priced in another currency than the listing', () => {
    const result = buildListingShipping(
      form({ shippingMode: 'profile', shippingProfileId: 'worldwide', currency: 'EUR' }),
      snapshot(),
    );
    expect(result).toMatchObject({ ok: false, reason: 'profile-currency' });
  });

  it('carries the listing’s own zones and a legacy option in custom mode', () => {
    const zone = emptyShippingZone({
      name: 'Europe',
      countries: 'DE, FR',
      rates: [emptyShippingRate({ rateId: 'std', pricing: 'flat', amount: '8.00' })],
    });
    const result = buildListingShipping(form({ shippingMode: 'custom', shippingZoneValues: [zone] }), null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields.shippingProfileId).toBeUndefined();
    expect(result.fields.shippingZones?.[0]).toMatchObject({ countries: ['DE', 'FR'] });
    expect(result.fields.shippingOptions[0]?.id).toBe(ZONE_LEGACY_OPTION_ID);
  });

  it('reports invalid custom zones instead of publishing them', () => {
    const result = buildListingShipping(form({ shippingMode: 'custom', shippingZoneValues: [] }), null);
    expect(result).toMatchObject({ ok: false, reason: 'zones-invalid' });
    expect(!result.ok && result.errors.length).toBeGreaterThan(0);
  });
});

describe('listingShippingFormFromRecord', () => {
  const asset = assetForListingCurrency('USD');

  it('returns null for a flat listing', () => {
    expect(listingShippingFormFromRecord({}, asset)).toBeNull();
  });

  it('opens a profile listing in profile mode', () => {
    expect(listingShippingFormFromRecord({ shippingProfileId: 'worldwide' }, asset)).toEqual({
      shippingMode: 'profile',
      shippingProfileId: 'worldwide',
      shippingZoneValues: [],
    });
  });

  it('round-trips custom zones through the form', () => {
    const zones = snapshot().record.zones;
    const opened = listingShippingFormFromRecord({ shippingZones: zones }, asset);
    expect(opened?.shippingMode).toBe('custom');
    const rebuilt = buildListingShipping(
      form({ shippingMode: 'custom', shippingZoneValues: opened?.shippingZoneValues ?? [] }),
      null,
    );
    expect(rebuilt.ok && rebuilt.fields.shippingZones).toEqual(zones);
  });
});

describe('buildListingShipping when an edit round-trips inline zones', () => {
  it('keeps the zone and rate members the editor does not manage', () => {
    const stored = [
      {
        zoneId: 'us',
        name: 'United States',
        countries: ['US'],
        carrierHint: 'ups',
        rates: [
          {
            pricing: 'flat' as const,
            rateId: 'std',
            label: 'Standard',
            estimatedMinDays: 4,
            estimatedMaxDays: 8,
            amountMinor: 479,
            trackingIncluded: true,
          },
        ],
      },
    ];
    const values = [
      emptyShippingZone({
        zoneId: 'us',
        name: 'United States',
        countries: 'US',
        rates: [emptyShippingRate({ rateId: 'std', label: 'Standard', amount: '6.00', minDays: '4', maxDays: '8' })],
      }),
    ];

    const result = buildListingShipping(form({ shippingMode: 'custom', shippingZoneValues: values }), null, stored);

    expect(result).toMatchObject({
      ok: true,
      fields: {
        shippingZones: [{ carrierHint: 'ups', rates: [{ amountMinor: 600, trackingIncluded: true }] }],
      },
    });
  });
});
