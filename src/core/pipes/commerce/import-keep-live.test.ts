import { describe, expect, it } from 'vitest';
import type { CommerceListingRecord } from '@/libs/commerce/marketplace-records';
import { createCommerceListingFixture } from '@/test/fixtures/commerce/commerce';
import { continueRevision, keepLiveRecord, keptLiveSkipText, recordShips } from './import-keep-live';

const NOW = '2026-10-15T12:00:00.000Z';

const stored = (overrides: Partial<CommerceListingRecord> = {}) =>
  createCommerceListingFixture({ revision: 3, createdAt: '2026-01-01T00:00:00.000Z', ...overrides });

const digital = (overrides: Partial<CommerceListingRecord> = {}) =>
  stored({ fulfillmentMethods: ['digital'], package: undefined, shippingOptions: [], ...overrides });

describe('continueRevision', () => {
  it('moves a record that collides with the stored revision onto the next one, keeping the creation time', () => {
    const existing = stored();
    const mapped = createCommerceListingFixture({ revision: 1, createdAt: '2026-10-15T00:00:00.000Z' });
    expect(continueRevision(existing, mapped)).toMatchObject({ revision: 4, createdAt: existing.createdAt });
    const ahead = createCommerceListingFixture({ revision: 9 });
    expect(continueRevision(existing, ahead)).toBe(ahead);
  });
});

describe('keepLiveRecord', () => {
  it('applies the safe content, continues the revision and leaves the listing active', () => {
    const existing = stored();
    const mapped = stored({
      title: 'Boots, resoled',
      description: 'New sole.',
      tags: ['vintage', 'resoled'],
      condition: 'excellent',
      location: { countryCode: 'CH' },
      sale: {
        format: 'fixed_price',
        unitPrice: { amountMinor: 14_900, currency: 'USD', exponent: 2 },
        acceptsOffers: true,
      },
    });
    const result = keepLiveRecord(existing, mapped, NOW);
    expect(result?.skipped).toEqual([]);
    expect(result?.record).toMatchObject({
      state: 'active',
      revision: 4,
      updatedAt: NOW,
      createdAt: existing.createdAt,
      title: 'Boots, resoled',
      condition: 'excellent',
      location: { countryCode: 'CH' },
    });
    expect(result?.record.sale.format === 'fixed_price' && result.record.sale.unitPrice.amountMinor).toBe(14_900);
  });

  it('skips a switch to shipping and keeps the stored fulfilment, package and shipping options', () => {
    const existing = digital();
    const mapped = stored();
    expect(recordShips(existing)).toBe(false);
    expect(recordShips(mapped)).toBe(true);
    const result = keepLiveRecord(existing, { ...mapped, title: 'Printed guide' }, NOW);
    expect(result?.skipped).toEqual(['fulfillment']);
    expect(result?.record).toMatchObject({ title: 'Printed guide', fulfillmentMethods: ['digital'], state: 'active' });
    expect(result?.record.package).toBeUndefined();
    expect(result?.record.shippingOptions).toEqual([]);
  });

  it('updates shipping facts of a listing that already ships, and allows leaving shipping', () => {
    const existing = stored();
    const changed = stored({
      shippingOptions: [{ id: 'free_01', pricing: 'free', label: 'Free', estimatedMinDays: 1, estimatedMaxDays: 2 }],
    });
    expect(keepLiveRecord(existing, changed, NOW)?.record.shippingOptions?.[0]).toMatchObject({ pricing: 'free' });
    const toDigital = keepLiveRecord(existing, digital(), NOW);
    expect(toDigital?.skipped).toEqual([]);
    expect(toDigital?.record.fulfillmentMethods).toEqual(['digital']);
  });

  it('never rewrites auction terms or switches the sale format, and reports the skipped sale change', () => {
    const auction = stored({
      sale: {
        format: 'auction',
        startingPrice: { amountMinor: 1_000, currency: 'USD', exponent: 2 },
        minimumIncrement: { amountMinor: 100, currency: 'USD', exponent: 2 },
        startsAt: '2026-10-01T00:00:00.000Z',
        endsAt: '2026-11-01T00:00:00.000Z',
        antiSnipingWindowSeconds: 0,
        antiSnipingExtensionSeconds: 0,
      },
      variants: [{ id: 'v1', options: {}, quantity: 1, mediaIds: [], enabled: true }],
    });
    const fixed = stored({ variants: auction.variants });
    const result = keepLiveRecord(auction, fixed, NOW);
    expect(result?.skipped).toEqual(['sale']);
    expect(result?.record.sale).toEqual(auction.sale);
    expect(keepLiveRecord(auction, auction, NOW)?.skipped).toEqual([]);
  });

  it('lets a row pause a live listing, which is always safe', () => {
    expect(keepLiveRecord(stored(), stored({ state: 'paused' }), NOW)?.record.state).toBe('paused');
  });

  it('returns null for a combined record that is not a valid listing', () => {
    expect(keepLiveRecord(stored(), stored({ title: 'x'.repeat(200) }), NOW)).toBeNull();
    expect(keepLiveRecord(stored(), stored({ media: [] }), NOW)).toBeNull();
  });

  it('names the skipped changes in plain words', () => {
    expect(keptLiveSkipText(['fulfillment', 'sale'])).toBe('switch to shipping, sale terms');
  });
});
