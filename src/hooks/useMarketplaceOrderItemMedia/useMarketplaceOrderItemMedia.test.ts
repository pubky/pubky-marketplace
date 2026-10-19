import type { Pubky as PubkySdk } from '@synonymdev/pubky';
import { Pubky } from '@synonymdev/pubky';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { getHomeserver, getHomeserverUrl } from '@/config/network';
import { CommerceController } from '@/controllers/commerce/commerce';
import { MarketplaceMediaService } from '@/core/services/commerce/marketplace-media';
import { clearMarketplaceMediaCache } from '@/hooks/useMarketplaceMediaUrl/useMarketplaceMediaUrl';
import { resolveMarketplaceMediaUrl } from '@/libs/commerce/media-url';
import * as sentry from '@/libs/observability/sentry';
import { COMMERCE_FIXTURE_SELLER, createCommerceListingFixture } from '@/test/fixtures/commerce/commerce';
import { asOpaque } from '@/test-utils/type-assertions';
import { useMarketplaceOrderItemMedia } from './useMarketplaceOrderItemMedia';

const publicGet = vi.fn();
const LISTING_ID = 'boots_01';
const AGGREGATE_ID = `listing:${COMMERCE_FIXTURE_SELLER}_${LISTING_ID}`;
const LISTING_URI = `pubky://${COMMERCE_FIXTURE_SELLER}/pub/pubky.app/marketplace/v1/listings/${LISTING_ID}`;
const IMAGE_URI = `pubky://${COMMERCE_FIXTURE_SELLER}/pub/pubky.app/marketplace/v1/media/image_01`;
const IMAGE_URL = resolveMarketplaceMediaUrl(IMAGE_URI, getHomeserverUrl());

function listingResponse(listingId = LISTING_ID, imageUrl = IMAGE_URI) {
  const record = createCommerceListingFixture({ listingId });
  record.media[0].url = imageUrl;
  return new Response(JSON.stringify(record), { status: 200 });
}

// Keep the hook, controller, Dexie and HTTP error handling real. These spies
// wait for either implementation's complete read; they do not stub its result.
let strictRead: MockInstance<typeof CommerceController.getOrFetchListing>;
let optionalRead: MockInstance<typeof CommerceController.getOrFetchListingIfFound>;

async function settleListingRead() {
  await waitFor(() => expect(publicGet).toHaveBeenCalled());
  await act(async () => {
    await Promise.allSettled([...strictRead.mock.results, ...optionalRead.mock.results].map(({ value }) => value));
  });
}

beforeEach(() => {
  publicGet.mockReset();
  clearMarketplaceMediaCache();
  vi.spyOn(MarketplaceMediaService, 'getOwnerHomeserver').mockResolvedValue(getHomeserver());
  vi.spyOn(Pubky, 'testnet').mockReturnValue(asOpaque<PubkySdk>({ publicStorage: { get: publicGet } }));
  vi.spyOn(sentry, 'captureAppError').mockImplementation(() => {});
  strictRead = vi.spyOn(CommerceController, 'getOrFetchListing');
  optionalRead = vi.spyOn(CommerceController, 'getOrFetchListingIfFound');
});

afterEach(() => vi.restoreAllMocks());

describe('useMarketplaceOrderItemMedia', () => {
  it.each(['response', 'SDK rejection'] as const)(
    'keeps the image placeholder without reporting a missing listing (%s)',
    async (failure) => {
      if (failure === 'response') {
        publicGet.mockResolvedValue(new Response('Not Found', { status: 404 }));
      } else {
        publicGet.mockRejectedValue({ name: 'RequestError', message: 'Not Found', data: { statusCode: 404 } });
      }

      const { result } = renderHook(() => useMarketplaceOrderItemMedia(AGGREGATE_ID));
      await settleListingRead();

      expect(result.current).toBeNull();
      expect(publicGet).toHaveBeenCalledExactlyOnceWith(LISTING_URI);
      expect(sentry.captureAppError).not.toHaveBeenCalled();
    },
  );

  it('keeps the placeholder while loading and returns the image when the listing arrives', async () => {
    const response = Promise.withResolvers<Response>();
    publicGet.mockReturnValue(response.promise);

    const { result } = renderHook(() => useMarketplaceOrderItemMedia(AGGREGATE_ID));
    await waitFor(() => expect(publicGet).toHaveBeenCalledExactlyOnceWith(LISTING_URI));
    expect(result.current).toBeNull();

    response.resolve(listingResponse());
    await waitFor(() => expect(result.current).toBe(IMAGE_URL));
    expect(sentry.captureAppError).not.toHaveBeenCalled();
  });

  it.each([401, 403, 500, 503])('keeps the placeholder but still reports HTTP %i', async (status) => {
    publicGet.mockResolvedValue(new Response('Request failed', { status }));

    const { result } = renderHook(() => useMarketplaceOrderItemMedia(AGGREGATE_ID));
    await settleListingRead();

    expect(result.current).toBeNull();
    expect(sentry.captureAppError).toHaveBeenCalledTimes(1);
    expect(sentry.captureAppError).toHaveBeenCalledWith(
      expect.objectContaining({ context: expect.objectContaining({ statusCode: status }) }),
    );
  });

  it('does not apply a late image response to a different order item', async () => {
    const oldResponse = Promise.withResolvers<Response>();
    publicGet.mockReturnValueOnce(oldResponse.promise).mockResolvedValueOnce(listingResponse('another_listing'));

    const { result, rerender } = renderHook(({ id }) => useMarketplaceOrderItemMedia(id), {
      initialProps: { id: AGGREGATE_ID },
    });
    await waitFor(() => expect(publicGet).toHaveBeenCalledTimes(1));
    rerender({ id: `listing:${COMMERCE_FIXTURE_SELLER}_another_listing` });
    await waitFor(() => expect(result.current).toBe(IMAGE_URL));

    oldResponse.resolve(
      listingResponse(LISTING_ID, `pubky://${COMMERCE_FIXTURE_SELLER}/pub/pubky.app/marketplace/v1/media/old_image`),
    );
    await settleListingRead();
    expect(result.current).toBe(IMAGE_URL);
  });

  it('does not fetch media for an invalid listing aggregate', () => {
    const { result } = renderHook(() => useMarketplaceOrderItemMedia('not-a-listing'));

    expect(result.current).toBeNull();
    expect(publicGet).not.toHaveBeenCalled();
    expect(sentry.captureAppError).not.toHaveBeenCalled();
  });
});
