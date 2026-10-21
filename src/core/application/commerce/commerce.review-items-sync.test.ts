import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/database/franky/franky';
import { HttpMethod } from '@/libs/http/http.types';
import { CommerceReviewModel, CommerceSyncJobModel } from '@/models/commerce/commerce.models';
import type { CommerceReviewModelSchema } from '@/models/commerce/commerce.schema';
import { CommerceRecordNormalizer } from '@/pipes/commerce/commerce.normalizer';
import { LocalCommerceService } from '@/services/local/commerce/commerce';
import { MarketplaceGatewayService, type MarketplaceOrder } from '@/services/marketplace/marketplace';
import { useAuthStore } from '@/stores/auth/auth.store';
import { createOrderFixture, ORDER_FIXTURE_BUYER, ORDER_FIXTURE_SELLER } from '@/test/fixtures/commerce/orders';
import { type FakeHomeserver, installFakeHomeserver } from '@/test-utils/fake-homeserver';
import { issuedAttestation } from '@/test-utils/review-attestation';
import { installWebLocks, removeWebLocks } from '@/test-utils/web-locks';
import { CommerceApplication } from './commerce';

const LISTINGS = [
  { id: 'boots', title: 'Handmade leather boots' },
  { id: 'belt', title: 'Braided leather belt' },
  { id: 'wallet', title: 'Slim leather wallet' },
];

function reviewedOrder(): MarketplaceOrder {
  return createOrderFixture('completed', {
    lines: LISTINGS.map(({ id, title }) => ({
      ...createOrderFixture('completed').lines[0],
      listingAggregateId: `listing:${ORDER_FIXTURE_SELLER}_${id}`,
      title,
    })),
    reviews: LISTINGS.map(({ id }, index) => ({
      id: `018f47d2-6a27-7c23-a49d-00000000010${index}`,
      reviewerPubky: ORDER_FIXTURE_BUYER,
      subjectPubky: ORDER_FIXTURE_SELLER,
      listingAggregateId: `listing:${ORDER_FIXTURE_SELLER}_${id}`,
      rating: 5,
      text: `Review of ${id}.`,
      createdAt: '2026-08-21T10:00:00.000Z',
    })),
  });
}

describe('own item reviews on the reviewer homeserver', () => {
  let homeserver: FakeHomeserver;
  let order: MarketplaceOrder;
  let published: CommerceReviewModelSchema[];
  let attestations: ReturnType<typeof issuedAttestation>[];

  const urlOf = (row: CommerceReviewModelSchema) =>
    CommerceRecordNormalizer.reviewUri(ORDER_FIXTURE_BUYER, row.review_id);
  const localRows = () => LocalCommerceService.getOwnReviewsByOrder(ORDER_FIXTURE_BUYER, order.id);

  beforeEach(async () => {
    await db.table(CommerceReviewModel.table.name).clear();
    await CommerceSyncJobModel.table.clear();
    installWebLocks();
    useAuthStore.getState().setCurrentUserPubky(ORDER_FIXTURE_BUYER);
    CommerceApplication.resetOwnReviewHydrateMemo();
    homeserver = installFakeHomeserver();
    order = reviewedOrder();
    attestations = LISTINGS.map(({ id }) => issuedAttestation(id));
    published = await CommerceApplication.commitPublishOwnReviews({
      actorPubky: ORDER_FIXTURE_BUYER,
      order,
      result: {
        kind: 'review',
        reviews: LISTINGS.map(({ id }) => ({
          reviewerPubky: ORDER_FIXTURE_BUYER,
          reviewerRole: 'buyer',
          subjectPubky: ORDER_FIXTURE_SELLER,
          listingAggregateId: `listing:${ORDER_FIXTURE_SELLER}_${id}`,
          rating: 5,
          text: `Review of ${id}.`,
          createdAt: '2026-08-21T10:00:00.000Z',
          updatedAt: '2026-08-21T10:00:00.000Z',
        })),
        attestations: attestations.map(({ wire }, index) => ({ listingId: LISTINGS[index].id, ...wire })),
      },
    });
    homeserver.log.length = 0;
  });

  afterEach(async () => {
    removeWebLocks();
    useAuthStore.getState().setCurrentUserPubky(null);
    vi.restoreAllMocks();
    await db.table(CommerceReviewModel.table.name).clear();
    await CommerceSyncJobModel.table.clear();
  });

  it('publishes three records at three paths', () => {
    expect(published).toHaveLength(3);
    expect(new Set(published.map(urlOf)).size).toBe(3);
    for (const row of published) expect(homeserver.files.has(urlOf(row))).toBe(true);
  });

  it('refreshes only the item another device edited', async () => {
    const belt = published[1];
    homeserver.files.set(urlOf(belt), {
      ...belt.record,
      revision: 2,
      text: 'Changed my mind about the belt.',
      ratings: { overall: 2 },
      updatedAt: '2026-08-22T10:00:00.000Z',
    });

    await expect(CommerceApplication.refreshOwnReviews(ORDER_FIXTURE_BUYER, [order])).resolves.toBe(1);

    const rows = await localRows();
    const byListing = Object.fromEntries(rows.map((row) => [row.record.listingId, row]));
    expect(byListing.belt.record.text).toBe('Changed my mind about the belt.');
    expect(byListing.belt.record.revision).toBe(2);
    expect(byListing.boots.record.revision).toBe(1);
    expect(byListing.wallet.record.revision).toBe(1);
    expect([...homeserver.log].sort()).toEqual(published.map((row) => `${HttpMethod.GET} ${urlOf(row)}`).sort());
  });

  it('keeps an unsynced item edit and still refreshes the other items', async () => {
    const [boots, belt] = published;
    await LocalCommerceService.upsertOwnReview({ ...boots, sync_status: 'pending' });
    homeserver.files.set(urlOf(boots), { ...boots.record, revision: 9, text: 'Elsewhere, later.' });
    homeserver.files.set(urlOf(belt), { ...belt.record, revision: 2, text: 'Belt, edited elsewhere.' });

    await expect(CommerceApplication.refreshOwnReviews(ORDER_FIXTURE_BUYER, [order])).resolves.toBe(1);

    const byListing = Object.fromEntries((await localRows()).map((row) => [row.record.listingId, row]));
    expect(byListing.boots.record.revision).toBe(1);
    expect(byListing.belt.record.text).toBe('Belt, edited elsewhere.');
  });

  it('removes every item record of the order and clears the local rows', async () => {
    await expect(CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id)).resolves.toBe('removed');

    expect(await localRows()).toEqual([]);
    expect(homeserver.log.filter((entry) => entry.startsWith(HttpMethod.DELETE)).sort()).toEqual(
      published.map((row) => `${HttpMethod.DELETE} ${urlOf(row)}`).sort(),
    );
    for (const row of published) expect(homeserver.files.has(urlOf(row))).toBe(false);
  });

  it('queues only the removal whose DEL failed, and one retry sends it once', async () => {
    const [, belt] = published;
    homeserver.failNext(HttpMethod.DELETE, urlOf(belt), 500);

    await expect(CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id)).resolves.toBe('queued');
    expect(homeserver.files.has(urlOf(belt))).toBe(true);
    expect(homeserver.files.size).toBe(1);
    homeserver.log.length = 0;

    await expect(CommerceApplication.resumeOwnReviewRemovals(ORDER_FIXTURE_BUYER)).resolves.toBe(1);
    expect(homeserver.log).toEqual([`${HttpMethod.DELETE} ${urlOf(belt)}`]);
    expect(homeserver.files.size).toBe(0);
  });

  it('answers absent when the order has no local review to remove', async () => {
    await db.table(CommerceReviewModel.table.name).clear();

    await expect(CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id)).resolves.toBe('absent');
  });

  it('hydrates every reviewed listing of a device with no local rows from one attestations read', async () => {
    await db.table(CommerceReviewModel.table.name).clear();
    const fetchAttestations = vi
      .spyOn(MarketplaceGatewayService, 'getReviewAttestations')
      .mockResolvedValue(attestations.map(({ wire }, index) => ({ listingId: LISTINGS[index].id, ...wire })));

    const rows = await CommerceApplication.getOwnMarketplaceOrderReviews(ORDER_FIXTURE_BUYER, order);

    expect(fetchAttestations).toHaveBeenCalledTimes(1);
    expect(rows.map(({ record }) => record.listingId)).toEqual(['boots', 'belt', 'wallet']);
    expect(rows.every((row) => row.sync_status === 'synced' && row.attestation_verified)).toBe(true);
    expect(homeserver.log).toEqual(published.map((row) => `${HttpMethod.GET} ${urlOf(row)}`));
    expect((await localRows()).map(({ record }) => record.listingId).sort()).toEqual(['belt', 'boots', 'wallet']);
  });

  it('leaves a listing unresolved, without claiming it unpublished, when its record is not on the homeserver yet', async () => {
    await db.table(CommerceReviewModel.table.name).clear();
    homeserver.files.delete(urlOf(published[2]));
    vi.spyOn(MarketplaceGatewayService, 'getReviewAttestations').mockResolvedValue(
      attestations.map(({ wire }, index) => ({ listingId: LISTINGS[index].id, ...wire })),
    );

    const rows = await CommerceApplication.getOwnMarketplaceOrderReviews(ORDER_FIXTURE_BUYER, order);

    expect(rows.map(({ record }) => record.listingId)).toEqual(['boots', 'belt']);
  });

  it("restores a one-review order's record a later order overwrote at the per-listing path, once", async () => {
    const [boots] = published;
    await db.table(CommerceReviewModel.table.name).clear();
    const otherOrder = issuedAttestation('boots', 'ef'.repeat(32));
    const { orderRef: _orderRef, ...unscoped } = boots.record;
    const { PubkySpecsBuilder } = await import('pubky-app-specs');
    const legacy = new PubkySpecsBuilder(ORDER_FIXTURE_BUYER).createMarketplaceReview({
      ...unscoped,
      reviewId: '',
      eligibilityAttestation: otherOrder.jws,
    });
    homeserver.files.clear();
    homeserver.files.set(
      CommerceRecordNormalizer.reviewUri(ORDER_FIXTURE_BUYER, legacy.meta.id),
      legacy.marketplace_review.toJson(),
    );
    const single: MarketplaceOrder = { ...order, reviews: [order.reviews![0]] };
    vi.spyOn(MarketplaceGatewayService, 'getReviewAttestations').mockResolvedValue([
      { listingId: 'boots', ...attestations[0].wire },
    ]);
    homeserver.log.length = 0;

    const rows = await CommerceApplication.getOwnMarketplaceOrderReviews(ORDER_FIXTURE_BUYER, single);

    expect(rows.map((row) => row.review_id)).toEqual([boots.review_id]);
    expect(rows[0].record.text).toBe('Review of boots.');
    expect(homeserver.log.filter((entry) => entry.startsWith(HttpMethod.PUT))).toEqual([
      `${HttpMethod.PUT} ${urlOf(boots)}`,
    ]);
    expect(homeserver.files.has(urlOf(boots))).toBe(true);
  });
});
