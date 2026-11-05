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
    expect(previewListingShipping(ZONES, [], 'Germany').destination).toBeNull();
    expect(previewListingShipping(ZONES, [], '1').destination).toBeNull();
    expect(previewListingShipping(ZONES, [], '').destination).toBeNull();
  });

  it('reads a lowercase country as its uppercase code', () => {
    expect(previewListingShipping(ZONES, [], 'de').destination).toMatchObject({ country: 'DE' });
  });

  it('reads the viewer’s country through its canonical code, so UK matches a GB zone', () => {
    const gb = [{ ...(ZONES[0] as ShippingZone), countries: ['GB'] }];
    expect(previewListingShipping(gb, [], ' uk ').destination).toMatchObject({
      country: 'GB',
      quotes: [expect.objectContaining({ rateId: 'std' })],
    });
  });

  it('narrows the countries and the viewer’s quote to the shop’s own ships-to list', () => {
    expect(previewListingShipping(ZONES, [], null, ['de', 'IT']).countries).toEqual(['DE', 'IT']);
    expect(previewListingShipping([ZONES[0] as ShippingZone], [], null, ['DE', 'IT']).countries).toEqual(['DE']);
    expect(previewListingShipping(ZONES, [], 'FR', ['DE']).destination).toEqual({ country: 'FR', quotes: null });
    expect(previewListingShipping(ZONES, [], 'DE', ['DE']).destination?.quotes).not.toBeNull();
  });

  it('reports no countries when the shop list and the zones share none', () => {
    expect(previewListingShipping([ZONES[0] as ShippingZone], [], null, ['BR']).countries).toEqual([]);
  });
});
