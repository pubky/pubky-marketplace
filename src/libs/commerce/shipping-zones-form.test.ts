import { describe, expect, it } from 'vitest';
import { BTC_ASSET, USD_ASSET } from './pricing';
import {
  emptyShippingRate,
  emptyShippingZone,
  type ShippingZoneFormValue,
  shippingZonesFromForm,
  shippingZonesToForm,
} from './shipping-zones-form';

const rate = (overrides: Partial<ReturnType<typeof emptyShippingRate>> = {}) =>
  emptyShippingRate({ rateId: 'std', label: 'Standard', amount: '4.79', minDays: '4', maxDays: '8', ...overrides });

const zone = (overrides: Partial<ShippingZoneFormValue> = {}) =>
  emptyShippingZone({ zoneId: 'us', name: 'United States', countries: 'US', rates: [rate()], ...overrides });

describe('shippingZonesFromForm', () => {
  it('turns typed prices into exact minor units of the asset', () => {
    const result = shippingZonesFromForm(
      [
        zone({ rates: [rate({ pricing: 'per_item', amount: '4.79', additionalAmount: '2.40' })] }),
        zone({
          zoneId: 'row',
          name: 'Rest of world',
          countries: '',
          restOfWorld: true,
          rates: [rate({ rateId: 'free', pricing: 'free' })],
        }),
      ],
      USD_ASSET,
    );
    expect(result).toEqual({
      ok: true,
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
          rates: [{ pricing: 'free', rateId: 'free', label: 'Standard', estimatedMinDays: 4, estimatedMaxDays: 8 }],
        },
      ],
    });
  });

  it('writes a UK entry as GB and keeps each country once', () => {
    const result = shippingZonesFromForm([zone({ countries: 'uk, GB de de' })], USD_ASSET);
    expect(result).toMatchObject({ ok: true, zones: [{ countries: ['GB', 'DE'] }] });
  });

  it('prices bitcoin in whole base units', () => {
    const result = shippingZonesFromForm([zone({ rates: [rate({ amount: '1200' })] })], BTC_ASSET);
    expect(result).toMatchObject({ ok: true, zones: [{ rates: [{ pricing: 'flat', amountMinor: 1200 }] }] });
  });

  it('reports every problem in one pass', () => {
    const result = shippingZonesFromForm(
      [
        zone({ name: ' ', countries: 'ZZZ' }),
        zone({ zoneId: 'b', countries: '', rates: [rate({ amount: 'abc', minDays: '9', maxDays: '3' })] }),
      ],
      USD_ASSET,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Zone 1: give the zone a name'),
        expect.stringContaining('Zone 1: not a two-letter country code: ZZZ'),
        expect.stringContaining('Zone 2: list the countries it serves'),
        expect.stringContaining('Zone 2, rate 1: enter the price in USD'),
        expect.stringContaining('longest delivery estimate cannot be shorter'),
      ]),
    );
  });

  it('refuses a country in two zones and a missing zone list through the record schema', () => {
    const overlapping = shippingZonesFromForm([zone(), zone({ zoneId: 'b', name: 'Again' })], USD_ASSET);
    expect(overlapping).toEqual({ ok: false, errors: ['A country may belong to only one shipping zone.'] });
    expect(shippingZonesFromForm([], USD_ASSET)).toEqual({ ok: false, errors: ['Add at least one zone.'] });
  });

  it('accepts zero for further items that ship free', () => {
    const result = shippingZonesFromForm(
      [zone({ rates: [rate({ pricing: 'per_item', amount: '4.79', additionalAmount: '0' })] })],
      USD_ASSET,
    );
    expect(result).toMatchObject({ ok: true, zones: [{ rates: [{ firstMinor: 479, additionalMinor: 0 }] }] });
  });

  it('refuses a price with more decimals than the asset has', () => {
    const result = shippingZonesFromForm([zone({ rates: [rate({ amount: '4.795' })] })], USD_ASSET);
    expect(result.ok).toBe(false);
  });

  it('round-trips zones through the editor', () => {
    const typed = [
      zone({
        rates: [
          rate({ pricing: 'per_item', amount: '4.79', additionalAmount: '2.40' }),
          rate({ rateId: 'exp', pricing: 'flat', amount: '14.99' }),
        ],
      }),
    ];
    const parsed = shippingZonesFromForm(typed, USD_ASSET);
    if (!parsed.ok) throw new Error('expected zones');
    expect(shippingZonesFromForm(shippingZonesToForm(parsed.zones, USD_ASSET), USD_ASSET)).toEqual(parsed);
  });
});

describe('shippingZonesFromForm with stored zones', () => {
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

  it('keeps the members another client wrote on a zone and a rate it edits', () => {
    const result = shippingZonesFromForm([zone({ rates: [rate({ amount: '5.00' })] })], USD_ASSET, stored);
    expect(result).toMatchObject({
      ok: true,
      zones: [
        { zoneId: 'us', carrierHint: 'ups', rates: [{ rateId: 'std', amountMinor: 500, trackingIncluded: true }] },
      ],
    });
  });

  it('lets the editor’s own fields win and drops the amounts of a rate that changes kind', () => {
    const result = shippingZonesFromForm(
      [zone({ rates: [rate({ pricing: 'per_item', amount: '4.00', additionalAmount: '1.00' })] })],
      USD_ASSET,
      stored,
    );
    expect(result.ok && result.zones[0]?.rates[0]).toEqual({
      pricing: 'per_item',
      rateId: 'std',
      label: 'Standard',
      estimatedMinDays: 4,
      estimatedMaxDays: 8,
      firstMinor: 400,
      additionalMinor: 100,
      trackingIncluded: true,
    });
  });

  it('adds nothing foreign to a new zone or rate', () => {
    const result = shippingZonesFromForm(
      [zone({ zoneId: 'eu', name: 'Europe', countries: 'DE', rates: [rate({ rateId: 'new' })] })],
      USD_ASSET,
      stored,
    );
    expect(result.ok && result.zones[0]).not.toHaveProperty('carrierHint');
    expect(result.ok && result.zones[0]?.rates[0]).not.toHaveProperty('trackingIncluded');
  });
});
