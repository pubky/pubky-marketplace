import { describe, expect, it } from 'vitest';
import { previewListingShipping } from './shipping-preview';
import type { ShippingZone } from './shipping-zones';

const ZONES: ShippingZone[] = [
  {
    zoneId: 'eu',
    name: 'Europe',
    countries: ['DE', 'FR'],
    rates: [
      {
        pricing: 'per_item',
        rateId: 'std',
        label: 'Standard',
        estimatedMinDays: 6,
        estimatedMaxDays: 12,
        firstMinor: 899,
        additionalMinor: 450,
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
        estimatedMinDays: 9,
        estimatedMaxDays: 20,
        amountMinor: 2500,
      },
    ],
  },
];

describe('previewListingShipping', () => {
  it('lists the countries served when no zone covers the rest of the world', () => {
    expect(previewListingShipping([ZONES[0] as ShippingZone], ['FR'], null)).toEqual({
      countries: ['DE'],
      destination: null,
    });
  });

  it('reports the rest of the world as open', () => {
    expect(previewListingShipping(ZONES, [], null).countries).toBeNull();
  });

  it('quotes one unit to the viewer’s country', () => {
    const preview = previewListingShipping(ZONES, [], 'DE');
    expect(preview.destination?.country).toBe('DE');
    expect(preview.destination?.quotes?.map(({ rateId, amountMinor }) => [rateId, amountMinor])).toEqual([
      ['std', 899],
    ]);
  });

  it('reports no quotes for an excluded country and ignores a malformed country', () => {
    expect(previewListingShipping(ZONES, ['DE'], 'DE').destination).toEqual({ country: 'DE', quotes: null });
    expect(previewListingShipping(ZONES, [], 'de').destination).toBeNull();
  });
});
