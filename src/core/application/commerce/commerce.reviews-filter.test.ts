import { afterEach, describe, expect, it, vi } from 'vitest';
import * as reviewCounting from '@/libs/commerce/review-counting';
import { attestorWindowsParam } from '@/libs/commerce/review-counting';
import { httpStatusCodeToError } from '@/libs/error/error.http';
import { ErrorService } from '@/libs/error/error.types';
import { resetRuntimeConfigForTests } from '@/libs/runtime-config/runtime-config';
import { PUBKY_RUNTIME_ENV_NAMES } from '@/libs/runtime-config/runtime-config.schema';
import { NexusMarketplaceService } from '@/services/nexus/marketplace/marketplace';
import type { NexusReviewView } from '@/services/nexus/marketplace/marketplace.types';
import { COMMERCE_FIXTURE_SELLER } from '@/test/fixtures/commerce/commerce';
import { CommerceApplication } from './commerce';

const SELLER = 's'.repeat(52);
const VIEWER = 'v'.repeat(52);
const REVIEWER = 'a'.repeat(52);

function entry(reviewId: string): NexusReviewView {
  return {
    review: {
      review_id: reviewId,
      reviewer_id: REVIEWER,
      subject_id: COMMERCE_FIXTURE_SELLER,
      listing_owner_id: COMMERCE_FIXTURE_SELLER,
      listing_id: 'boots_01',
      role: 'buyer_reviewing_seller',
      rating_overall: 4,
      text: 'Fine.',
      verified: false,
      attestor_id: null,
      edited_late: false,
      created_at: '2026-10-20T12:00:00.000Z',
      updated_at: '2026-10-20T12:00:00.000Z',
      revision: 1,
      indexed_at: 1,
    } as NexusReviewView['review'],
    response: null,
  };
}

const MATCHED = { buyers: 3, orders: 4, avg: 4.8, seller_buyers: 2, seller_avg: 4.5 };
const ID = '8Z8CWH8NVYQY39ZEBFGKQWWEKG';

describe('CommerceApplication reviewer filters', () => {
  const envName = PUBKY_RUNTIME_ENV_NAMES.marketplaceTrustedAttestors;
  const suiteValue = process.env[envName];

  afterEach(() => {
    vi.restoreAllMocks();
    process.env[envName] = suiteValue;
    resetRuntimeConfigForTests();
  });

  it('sends the viewer, reach, depth and the trusted windows to the seller stream', async () => {
    const fetch = vi
      .spyOn(NexusMarketplaceService, 'fetchShopReviews')
      .mockResolvedValue({ reviews: [entry(ID)], matched: MATCHED });

    const result = await CommerceApplication.fetchSellerReviews(SELLER, {
      skip: 0,
      limit: 10,
      filter: { viewerId: VIEWER, reach: 'wot', depth: 2 },
    });

    expect(attestorWindowsParam()).not.toBeNull();
    expect(fetch).toHaveBeenCalledWith({
      seller_id: SELLER,
      skip: 0,
      limit: 10,
      viewer_id: VIEWER,
      reach: 'wot',
      depth: 2,
      attestors: attestorWindowsParam(),
    });
    expect(result).toMatchObject({
      status: 'ok',
      filterApplied: true,
      matched: { buyers: 3, orders: 4, avg: 4.8, sellerBuyers: 2, sellerAvg: 4.5 },
    });
  });

  it('sends the tag labels to the listing stream, joined by commas', async () => {
    const fetch = vi
      .spyOn(NexusMarketplaceService, 'fetchListingReviews')
      .mockResolvedValue({ reviews: [], matched: { buyers: 0, orders: 0, avg: null } });

    const result = await CommerceApplication.fetchListingReviews(SELLER, 'boots_01', {
      limit: 10,
      sort: 'value',
      filter: { viewerId: VIEWER, taggedLabels: ['trusted', 'fast'] },
    });

    const params = fetch.mock.calls[0][0];
    expect(params).toMatchObject({
      seller_id: SELLER,
      listing_id: 'boots_01',
      sort: 'value',
      viewer_id: VIEWER,
      tagged_by_viewer: 'trusted,fast',
    });
    expect(result).toMatchObject({
      status: 'ok',
      sortApplied: true,
      filterApplied: true,
      matched: { buyers: 0, orders: 0, avg: null },
    });
  });

  it('sends no filter parameter without a filter, and no matched figures come back', async () => {
    const fetch = vi
      .spyOn(NexusMarketplaceService, 'fetchShopReviews')
      .mockResolvedValue({ reviews: [entry(ID)], matched: MATCHED });

    const result = await CommerceApplication.fetchSellerReviews(SELLER, { limit: 10 });

    const params = fetch.mock.calls[0][0] as Record<string, unknown>;
    for (const key of ['viewer_id', 'reach', 'depth', 'tagged_by_viewer', 'attestors']) {
      expect(params[key]).toBeUndefined();
    }
    expect(result).toMatchObject({ status: 'ok', filterApplied: false, matched: null });
  });

  it('reads the bare list as a filter the index did not apply', async () => {
    vi.spyOn(NexusMarketplaceService, 'fetchShopReviews').mockResolvedValue([entry(ID)]);

    const result = await CommerceApplication.fetchSellerReviews(SELLER, {
      limit: 10,
      filter: { viewerId: VIEWER, reach: 'following' },
    });

    expect(result).toMatchObject({ status: 'ok', filterApplied: false, matched: null });
    expect(result.status === 'ok' && result.reviews).toHaveLength(1);
  });

  it('gives no matched figures when no attestor is trusted, since the counts would not be the counted ones', async () => {
    vi.spyOn(reviewCounting, 'attestorWindowsParam').mockReturnValue(null);
    const fetch = vi
      .spyOn(NexusMarketplaceService, 'fetchShopReviews')
      .mockResolvedValue({ reviews: [entry(ID)], matched: MATCHED });

    const result = await CommerceApplication.fetchSellerReviews(SELLER, {
      limit: 10,
      filter: { viewerId: VIEWER, reach: 'following' },
    });

    expect(fetch.mock.calls[0][0]).not.toHaveProperty('attestors');
    expect(result).toMatchObject({ status: 'ok', filterApplied: true, matched: null });
  });

  it('answers rejected when the index refuses the filter with a 400', async () => {
    vi.spyOn(NexusMarketplaceService, 'fetchShopReviews').mockRejectedValue(
      httpStatusCodeToError(400, 'Bad Request', ErrorService.Nexus, 'fetchShopReviews', 'url'),
    );
    vi.spyOn(NexusMarketplaceService, 'fetchListingReviews').mockRejectedValue(
      httpStatusCodeToError(400, 'Bad Request', ErrorService.Nexus, 'fetchListingReviews', 'url'),
    );
    const filter = { viewerId: VIEWER, reach: 'following' as const };

    await expect(CommerceApplication.fetchSellerReviews(SELLER, { filter })).resolves.toEqual({ status: 'rejected' });
    await expect(CommerceApplication.fetchListingReviews(SELLER, 'boots_01', { filter })).resolves.toEqual({
      status: 'rejected',
    });
  });

  it('answers unavailable for a 400 without a filter and for any other failure with one', async () => {
    const spy = vi.spyOn(NexusMarketplaceService, 'fetchShopReviews');
    spy.mockRejectedValueOnce(httpStatusCodeToError(400, 'Bad Request', ErrorService.Nexus, 'fetchShopReviews', 'url'));
    await expect(CommerceApplication.fetchSellerReviews(SELLER, { limit: 10 })).resolves.toEqual({
      status: 'unavailable',
    });

    spy.mockRejectedValueOnce(httpStatusCodeToError(503, 'Unavailable', ErrorService.Nexus, 'fetchShopReviews', 'url'));
    await expect(
      CommerceApplication.fetchSellerReviews(SELLER, { filter: { viewerId: VIEWER, reach: 'wot', depth: 2 } }),
    ).resolves.toEqual({ status: 'unavailable' });
  });
});
