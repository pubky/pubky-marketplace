import type { Pubky as PubkySdk } from '@synonymdev/pubky';
import { Pubky } from '@synonymdev/pubky';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import * as sentry from '@/libs/observability/sentry';
import { CommerceCatalogEntryModel } from '@/models/commerce/commerce.models';
import { LocalCommerceService } from '@/services/local/commerce/commerce';
import {
  COMMERCE_FIXTURE_SELLER,
  createCommerceCatalogEntryFixture,
  createCommerceListingFixture,
} from '@/test/fixtures/commerce/commerce';
import { asOpaque } from '@/test-utils/type-assertions';

const publicGet = vi.fn();
const LISTING_ID = 'boots_01';
const LISTING_URI = `pubky://${COMMERCE_FIXTURE_SELLER}/pub/pubky.app/marketplace/v1/listings/${LISTING_ID}`;

// Exercise the real controller, application, Dexie, homeserver response handling
// and Err factories. Only the SDK's public HTTP boundary and Sentry transport are stubbed.
beforeEach(() => {
  publicGet.mockReset();
  vi.spyOn(Pubky, 'testnet').mockReturnValue(asOpaque<PubkySdk>({ publicStorage: { get: publicGet } }));
  vi.spyOn(sentry, 'captureAppError').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('optional canonical listing reads for existing orders', () => {
  it('returns null for an absent public record without reporting an error', async () => {
    publicGet.mockResolvedValue(new Response('Not Found', { status: 404 }));

    await expect(CommerceController.getOrFetchListingIfFound(COMMERCE_FIXTURE_SELLER, LISTING_ID)).resolves.toBeNull();

    expect(publicGet).toHaveBeenCalledExactlyOnceWith(LISTING_URI);
    expect(sentry.captureAppError).not.toHaveBeenCalled();
  });

  it('also accepts a 404 thrown by the SDK without reporting it', async () => {
    publicGet.mockRejectedValue({ name: 'RequestError', message: 'Not Found', data: { statusCode: 404 } });

    await expect(CommerceController.getOrFetchListingIfFound(COMMERCE_FIXTURE_SELLER, LISTING_ID)).resolves.toBeNull();

    expect(sentry.captureAppError).not.toHaveBeenCalled();
  });

  it('does not cache absence: the same order lookup can find a later canonical record', async () => {
    const record = createCommerceListingFixture();
    publicGet
      .mockResolvedValueOnce(new Response('Not Found', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(record), { status: 200 }));

    await expect(CommerceController.getOrFetchListingIfFound(COMMERCE_FIXTURE_SELLER, LISTING_ID)).resolves.toBeNull();
    await expect(CommerceController.getOrFetchListingIfFound(COMMERCE_FIXTURE_SELLER, LISTING_ID)).resolves.toEqual(
      record,
    );

    expect((await LocalCommerceService.getListing(`${COMMERCE_FIXTURE_SELLER}:${LISTING_ID}`))?.record).toEqual(record);
    expect(publicGet).toHaveBeenCalledTimes(2);
    expect(sentry.captureAppError).not.toHaveBeenCalled();
  });

  it.each([401, 403, 500, 503])('still rejects and reports HTTP %i', async (status) => {
    publicGet.mockResolvedValue(new Response('Request failed', { status }));

    await expect(
      CommerceController.getOrFetchListingIfFound(COMMERCE_FIXTURE_SELLER, LISTING_ID),
    ).rejects.toMatchObject({
      context: expect.objectContaining({ statusCode: status }),
    });

    expect(sentry.captureAppError).toHaveBeenCalledTimes(1);
  });

  it('still reports missing listings in the strict listing-detail/checkout read', async () => {
    publicGet.mockResolvedValue(new Response('Not Found', { status: 404 }));

    await expect(CommerceController.getOrFetchListing(COMMERCE_FIXTURE_SELLER, LISTING_ID)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    expect(sentry.captureAppError).toHaveBeenCalledTimes(1);
  });

  it('keeps a cached digital lock if a newer index revision cannot be fetched', async () => {
    const record = createCommerceListingFixture({
      digitalLock: {
        policyUri: `pubky://${COMMERCE_FIXTURE_SELLER}/pub/locks/policies/lock`,
        criterionId: 'criterion-1',
        contentPath: 'purchased-file',
        resourceHash: 'a'.repeat(64),
        minimumConfirmations: 1,
      },
    });
    await LocalCommerceService.upsertListing(record, 'synced');
    await CommerceCatalogEntryModel.table.put(createCommerceCatalogEntryFixture({ revision: 2 }));
    publicGet.mockResolvedValue(new Response('Not Found', { status: 404 }));

    await expect(CommerceController.getOrFetchListingIfFound(COMMERCE_FIXTURE_SELLER, LISTING_ID)).resolves.toEqual(
      record,
    );

    expect(publicGet).toHaveBeenCalledTimes(1);
    expect(sentry.captureAppError).not.toHaveBeenCalled();
  });

  it('refreshes stale cached metadata when the canonical record is available', async () => {
    await LocalCommerceService.upsertListing(createCommerceListingFixture({ revision: 1 }), 'synced');
    await CommerceCatalogEntryModel.table.put(createCommerceCatalogEntryFixture({ revision: 2 }));
    const record = createCommerceListingFixture({ revision: 2 });
    publicGet.mockResolvedValue(new Response(JSON.stringify(record), { status: 200 }));

    await expect(CommerceController.getOrFetchListingIfFound(COMMERCE_FIXTURE_SELLER, LISTING_ID)).resolves.toEqual(
      record,
    );

    expect((await LocalCommerceService.getListing(`${COMMERCE_FIXTURE_SELLER}:${LISTING_ID}`))?.revision).toBe(2);
  });

  it.each(['wrong identity', 'older revision'] as const)(
    'still rejects a canonical record with %s',
    async (failure) => {
      await CommerceCatalogEntryModel.table.put(createCommerceCatalogEntryFixture({ revision: 2 }));
      const record = createCommerceListingFixture(
        failure === 'wrong identity' ? { listingId: 'another-listing', revision: 2 } : { revision: 1 },
      );
      publicGet.mockResolvedValue(new Response(JSON.stringify(record), { status: 200 }));

      await expect(
        CommerceController.getOrFetchListingIfFound(COMMERCE_FIXTURE_SELLER, LISTING_ID),
      ).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      });

      expect(await LocalCommerceService.getListing(`${COMMERCE_FIXTURE_SELLER}:${LISTING_ID}`)).toBeNull();
      expect(sentry.captureAppError).toHaveBeenCalledTimes(1);
    },
  );
});
