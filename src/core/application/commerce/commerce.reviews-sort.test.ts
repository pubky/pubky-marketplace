import { afterEach, describe, expect, it, vi } from 'vitest';
import { NexusMarketplaceService } from '@/services/nexus/marketplace/marketplace';
import type { NexusReviewView } from '@/services/nexus/marketplace/marketplace.types';
import { COMMERCE_FIXTURE_SELLER } from '@/test/fixtures/commerce/commerce';
import { CommerceApplication } from './commerce';

const SELLER = 's'.repeat(52);
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

const MATCHED = { buyers: 1, orders: 1, avg: 4 };

describe('CommerceApplication review sorts', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes the sort parameter to the seller stream and reads the envelope as a sorted page', async () => {
    const fetch = vi
      .spyOn(NexusMarketplaceService, 'fetchShopReviews')
      .mockResolvedValue({ reviews: [entry('8Z8CWH8NVYQY39ZEBFGKQWWEKG')], matched: MATCHED });

    const result = await CommerceApplication.fetchSellerReviews(SELLER, { skip: 10, limit: 10, sort: 'value' });

    expect(fetch).toHaveBeenCalledWith({ seller_id: SELLER, skip: 10, limit: 10, sort: 'value' });
    expect(result).toMatchObject({ status: 'ok', sortApplied: true });
    expect(result.status === 'ok' && result.reviews.map(({ reviewId }) => reviewId)).toEqual([
      '8Z8CWH8NVYQY39ZEBFGKQWWEKG',
    ]);
  });

  it('passes the sort parameter to the listing stream', async () => {
    const fetch = vi
      .spyOn(NexusMarketplaceService, 'fetchListingReviews')
      .mockResolvedValue({ reviews: [], matched: { buyers: 0, orders: 0, avg: null } });

    const result = await CommerceApplication.fetchListingReviews(SELLER, 'boots_01', { limit: 10, sort: 'rating_asc' });

    expect(fetch).toHaveBeenCalledWith({ seller_id: SELLER, listing_id: 'boots_01', limit: 10, sort: 'rating_asc' });
    expect(result).toEqual({ status: 'ok', reviews: [], sortApplied: true });
  });

  it('sends no sort without one, and reads the bare list as not sorted', async () => {
    const fetch = vi
      .spyOn(NexusMarketplaceService, 'fetchShopReviews')
      .mockResolvedValue([entry('8Z8CWH8NVYQY39ZEBFGKQWWEKG')]);

    const result = await CommerceApplication.fetchSellerReviews(SELLER, { skip: 0, limit: 10 });

    expect(fetch.mock.calls[0][0]).not.toHaveProperty('sort');
    expect(result).toMatchObject({ status: 'ok', sortApplied: false });
  });

  it('reads the bare list an index before IX4 answers to a sort as not sorted', async () => {
    vi.spyOn(NexusMarketplaceService, 'fetchShopReviews').mockResolvedValue([entry('8Z8CWH8NVYQY39ZEBFGKQWWEKG')]);

    const result = await CommerceApplication.fetchSellerReviews(SELLER, { limit: 10, sort: 'rating_desc' });

    expect(result).toMatchObject({ status: 'ok', sortApplied: false });
    expect(result.status === 'ok' && result.reviews).toHaveLength(1);
  });

  it('answers unavailable when the stream cannot be read', async () => {
    vi.spyOn(NexusMarketplaceService, 'fetchListingReviews').mockRejectedValue(new Error('down'));

    await expect(CommerceApplication.fetchListingReviews(SELLER, 'boots_01', { sort: 'value' })).resolves.toEqual({
      status: 'unavailable',
    });
  });
});
