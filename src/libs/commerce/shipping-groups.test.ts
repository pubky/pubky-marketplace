import { describe, expect, it } from 'vitest';
import {
  groupAmount,
  groupOptions,
  selectedRateId,
  shippingChoicePayload,
  shippingGroups,
  type ZonedLine,
} from './shipping-groups';
import type { ShippingZone } from './shipping-zones';
import { buildMarketplaceListingAggregateId } from './transaction-commands';

const SELLER = 's'.repeat(52);
const OTHER_SELLER = 't'.repeat(52);

const ZONES: ShippingZone[] = [
  {
    zoneId: 'us',
    name: 'United States',
    countries: ['US'],
    rates: [
      {
        pricing: 'per_item',
        rateId: 'std',
        label: 'Standard',
        estimatedMinDays: 4,
        estimatedMaxDays: 8,
        firstMinor: 479,
        additionalMinor: 240,
      },
      {
        pricing: 'flat',
        rateId: 'exp',
        label: 'Express',
        estimatedMinDays: 2,
        estimatedMaxDays: 4,
        amountMinor: 1499,
      },
    ],
  },
];

function line(id: string, overrides: Partial<ZonedLine> = {}): ZonedLine {
  return {
    id,
    sellerPubky: SELLER,
    listingId: `listing${id}`,
    quantity: 1,
    pricing: { kind: 'profile', profileId: 'worldwide' },
    ...overrides,
  };
}

describe('shippingGroups', () => {
  it('groups lines of one seller and profile and sums their units', () => {
    const groups = shippingGroups([line('a', { quantity: 2 }), line('b', { quantity: 3 })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ sellerPubky: SELLER, profileId: 'worldwide', units: 5, lineIds: ['a', 'b'] });
  });

  it('keeps the same profile id of two sellers apart', () => {
    const groups = shippingGroups([line('a'), line('b', { sellerPubky: OTHER_SELLER })]);
    expect(groups.map((group) => group.sellerPubky)).toEqual([SELLER, OTHER_SELLER]);
    expect(new Set(groups.map((group) => group.key)).size).toBe(2);
  });

  it('keys an inline-zone group by its listing and sums that listing’s lines', () => {
    const inline = { kind: 'inline', zones: ZONES } as const;
    const groups = shippingGroups([
      line('a', { listingId: 'one', pricing: inline, quantity: 1 }),
      line('b', { listingId: 'one', pricing: inline, quantity: 2 }),
      line('c', { listingId: 'two', pricing: inline, quantity: 1 }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      listingAggregateId: buildMarketplaceListingAggregateId(SELLER, 'one'),
      units: 3,
      lineIds: ['a', 'b'],
    });
    expect(groups[0]?.profileId).toBeUndefined();
  });

  it('leaves lines that are not zone-priced out of every group', () => {
    expect(shippingGroups([line('a', { pricing: null })])).toEqual([]);
  });
});

describe('group pricing', () => {
  const [group] = shippingGroups([line('a', { quantity: 2 }), line('b', { quantity: 1 })]);
  const card = { zones: ZONES, excludedCountries: [], profileSha256: 'a'.repeat(64) };

  it('prices the whole group once: per-item counts every line’s units, flat charges once', () => {
    if (!group) throw new Error('expected a group');
    const options = groupOptions(group, card, 'US');
    expect(options).toMatchObject({ status: 'ready' });
    expect(
      options.status === 'ready' && options.quotes.map(({ rateId, amountMinor }) => [rateId, amountMinor]),
    ).toEqual([
      ['std', 479 + 2 * 240],
      ['exp', 1499],
    ]);
  });

  it('refuses a destination no zone serves and one the profile excludes', () => {
    if (!group) throw new Error('expected a group');
    expect(groupOptions(group, card, 'DE')).toEqual({ status: 'refused', code: 'SHIPPING_UNAVAILABLE_TO_COUNTRY' });
    expect(groupOptions(group, { ...card, excludedCountries: ['US'] }, 'US')).toEqual({
      status: 'refused',
      code: 'SHIPPING_UNAVAILABLE_TO_COUNTRY',
    });
  });

  it('returns the code for an unknown rate', () => {
    if (!group) throw new Error('expected a group');
    expect(groupAmount(group, card, 'US', 'nope')).toBe('UNKNOWN_SHIPPING_RATE');
    expect(groupAmount(group, card, 'US', 'exp')).toMatchObject({ amountMinor: 1499 });
  });
});

describe('selectedRateId', () => {
  const quotes = [
    { zoneId: 'z', rateId: 'slow', label: 'Slow', amountMinor: 500, estimatedMinDays: 9, estimatedMaxDays: 12 },
    { zoneId: 'z', rateId: 'cheap', label: 'Cheap', amountMinor: 300, estimatedMinDays: 9, estimatedMaxDays: 12 },
    { zoneId: 'z', rateId: 'cheap2', label: 'Cheap too', amountMinor: 300, estimatedMinDays: 1, estimatedMaxDays: 2 },
  ];

  it('keeps the buyer’s pick while it still exists', () => {
    expect(selectedRateId(quotes, 'slow')).toBe('slow');
  });

  it('falls back to the cheapest rate, first in order on a tie, when the pick is gone', () => {
    expect(selectedRateId(quotes, 'removed')).toBe('cheap');
    expect(selectedRateId(quotes, undefined)).toBe('cheap');
  });

  it('has no rate when there are no quotes', () => {
    expect(selectedRateId([], 'x')).toBeUndefined();
  });
});

describe('shippingChoicePayload', () => {
  const [profileGroup] = shippingGroups([line('a')]);
  const [inlineGroup] = shippingGroups([line('a', { pricing: { kind: 'inline', zones: ZONES } })]);

  it('pins a profile choice to the digest of the bytes read', () => {
    if (!profileGroup) throw new Error('expected a group');
    expect(shippingChoicePayload(profileGroup, 'std', { profileSha256: 'b'.repeat(64) })).toEqual({
      sellerPubky: SELLER,
      profileId: 'worldwide',
      rateId: 'std',
      profileSha256: 'b'.repeat(64),
    });
  });

  it('refuses to build a profile choice without a digest', () => {
    if (!profileGroup) throw new Error('expected a group');
    expect(() => shippingChoicePayload(profileGroup, 'std', {})).toThrow(TypeError);
  });

  it('names an inline group by its listing and carries no digest', () => {
    if (!inlineGroup) throw new Error('expected a group');
    const payload = shippingChoicePayload(inlineGroup, 'std', {});
    expect(payload).toEqual({
      sellerPubky: SELLER,
      listingAggregateId: buildMarketplaceListingAggregateId(SELLER, 'listinga'),
      rateId: 'std',
    });
    expect('profileSha256' in payload).toBe(false);
  });
});
