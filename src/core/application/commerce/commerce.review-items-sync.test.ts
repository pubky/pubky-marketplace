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
import { type FakeMarketplaceService, installFakeMarketplaceService } from '@/test-utils/fake-marketplace-service';
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
  let service: FakeMarketplaceService;
  let order: MarketplaceOrder;
  let published: CommerceReviewModelSchema[];
  let attestations: ReturnType<typeof issuedAttestation>[];

  const urlOf = (row: CommerceReviewModelSchema) =>
    CommerceRecordNormalizer.reviewUri(ORDER_FIXTURE_BUYER, row.review_id);
  const localRows = () => LocalCommerceService.getOwnReviewsByOrder(ORDER_FIXTURE_BUYER, order.id);

  /** What a review command answers for the named listings: their reviews and one attestation each. */
  const resultFor = (listingIds: string[]) => ({
    kind: 'review',
    reviews: listingIds.map((id) => ({
      reviewerPubky: ORDER_FIXTURE_BUYER,
      reviewerRole: 'buyer',
      subjectPubky: ORDER_FIXTURE_SELLER,
      listingAggregateId: `listing:${ORDER_FIXTURE_SELLER}_${id}`,
      rating: 5,
      text: `Review of ${id}.`,
      createdAt: '2026-08-21T10:00:00.000Z',
      updatedAt: '2026-08-21T10:00:00.000Z',
    })),
    attestations: listingIds.map((id) => ({
      listingId: id,
      ...attestations[LISTINGS.findIndex((listing) => listing.id === id)].wire,
    })),
  });

  beforeEach(async () => {
    await db.table(CommerceReviewModel.table.name).clear();
    await CommerceSyncJobModel.table.clear();
    installWebLocks();
    useAuthStore.getState().setCurrentUserPubky(ORDER_FIXTURE_BUYER);
    CommerceApplication.resetOwnReviewHydrateMemo();
    homeserver = installFakeHomeserver();
    order = reviewedOrder();
    service = installFakeMarketplaceService(order, ORDER_FIXTURE_BUYER);
    attestations = LISTINGS.map(({ id }) => issuedAttestation(id));
    published = await CommerceApplication.commitPublishOwnReviews({
      actorPubky: ORDER_FIXTURE_BUYER,
      order,
      result: resultFor(LISTINGS.map(({ id }) => id)),
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

  describe('removing item reviews also withdraws each at the service', () => {
    /** The order the rows are removed in: the local rows' own order. */
    let first: string;
    let middle: string;
    let last: string;
    const rowOf = (listingId: string) => published.find((row) => row.record.listingId === listingId)!;
    const urlsByListing = () => new Map(published.map((row) => [urlOf(row), row.record.listingId]));
    const deletedListings = () =>
      homeserver.log
        .filter((entry) => entry.startsWith(`${HttpMethod.DELETE} `))
        .map((entry) => urlsByListing().get(entry.slice(HttpMethod.DELETE.length + 1)));
    const removeJobs = async () =>
      (await CommerceSyncJobModel.table.toArray()).filter((job) => job.operation === 'remove');

    beforeEach(async () => {
      [first, middle, last] = (await localRows()).map(({ record }) => record.listingId);
    });

    it('withdraws one item at a time, naming the listing, each before that item DEL', async () => {
      const withdrawalsAtDelete: (string | undefined)[][] = [];
      homeserver.onRequest = ({ entry, phase }) => {
        if (phase === 'before' && entry.startsWith(`${HttpMethod.DELETE} `)) {
          withdrawalsAtDelete.push([...service.withdrawals]);
        }
      };

      await expect(CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id)).resolves.toBe('removed');

      expect(withdrawalsAtDelete).toEqual([[first], [first, middle], [first, middle, last]]);
      expect(deletedListings()).toEqual([first, middle, last]);
      for (const { id } of LISTINGS) expect(service.withdrawn(id)).toBe(true);
      expect(await removeJobs()).toEqual([]);
    });

    it('holds the next item and its DEL back until the previous item is withdrawn and deleted', async () => {
      const parked = service.holdNext('review.withdraw', { listingId: middle });

      const removal = CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id);
      await parked.reached;

      expect(service.withdrawals).toEqual([first, middle]);
      expect(service.withdrawn(first)).toBe(true);
      expect(service.withdrawn(middle)).toBe(false);
      expect(deletedListings()).toEqual([first]);
      expect(homeserver.files.has(urlOf(rowOf(middle)))).toBe(true);
      expect(homeserver.files.has(urlOf(rowOf(last)))).toBe(true);
      expect(
        (await removeJobs()).map((job) => (job.payload as { listingId?: string }).listingId).sort(),
      ).toEqual([last, middle].sort());

      parked.release();

      await expect(removal).resolves.toBe('removed');
      expect(deletedListings()).toEqual([first, middle, last]);
      expect(homeserver.files.size).toBe(0);
    });

    it('sends no DEL for an item whose withdrawal fails, removes the others, and one retry finishes that item', async () => {
      const stuck = rowOf(middle);
      service.failNext('review.withdraw', { listingId: middle });

      await expect(CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id)).resolves.toBe('queued');

      expect(deletedListings()).toEqual([first, last]);
      expect([...homeserver.files.keys()]).toEqual([urlOf(stuck)]);
      expect(service.withdrawn(first)).toBe(true);
      expect(service.withdrawn(middle)).toBe(false);
      const owed = await removeJobs();
      expect(owed).toHaveLength(1);
      expect(owed[0]).toMatchObject({ entity_id: stuck.review_id, attempts: 1 });
      expect(owed[0].payload).toMatchObject({ listingId: middle });
      homeserver.log.length = 0;

      await expect(CommerceApplication.resumeOwnReviewRemovals(ORDER_FIXTURE_BUYER)).resolves.toBe(1);

      expect(service.withdrawals).toEqual([first, middle, last, middle]);
      expect(deletedListings()).toEqual([middle]);
      expect(homeserver.files.size).toBe(0);
      expect(await removeJobs()).toEqual([]);
    });

    it('retries only the DEL of an item whose withdrawal stands', async () => {
      const stuck = rowOf(middle);
      homeserver.failNext(HttpMethod.DELETE, urlOf(stuck), 500);

      await expect(CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id)).resolves.toBe('queued');
      expect(service.withdrawn(middle)).toBe(true);
      expect(service.withdrawals).toEqual([first, middle, last]);
      homeserver.log.length = 0;

      await expect(CommerceApplication.resumeOwnReviewRemovals(ORDER_FIXTURE_BUYER)).resolves.toBe(1);

      expect(service.withdrawals).toEqual([first, middle, last]);
      expect(deletedListings()).toEqual([middle]);
      expect(homeserver.files.size).toBe(0);
    });

    it('re-reads the order for each item, so a revision that moved meanwhile does not stop it', async () => {
      service.touch();
      const stale = service.holdNext('getOrder', { afterAnswer: true });

      const removal = CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id);
      await stale.reached;
      service.touch();
      stale.release();

      await expect(removal).resolves.toBe('removed');
      for (const { id } of LISTINGS) expect(service.withdrawn(id)).toBe(true);
      expect(homeserver.files.size).toBe(0);
    });

    it("keeps another item's owed removal when this item is published again, and still sends it", async () => {
      const stuck = rowOf(middle);
      service.failNext('review.withdraw', { listingId: middle });
      await CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id);
      service.reinstate(first);

      const [again] = await CommerceApplication.commitPublishOwnReviews({
        actorPubky: ORDER_FIXTURE_BUYER,
        order,
        result: resultFor([first]),
      });

      expect(again).toMatchObject({ sync_status: 'synced' });
      expect(again.record.listingId).toBe(first);
      expect((await removeJobs()).map((job) => job.entity_id)).toEqual([stuck.review_id]);
      expect(await localRows()).toEqual([again]);

      await expect(CommerceApplication.resumeOwnReviewRemovals(ORDER_FIXTURE_BUYER)).resolves.toBe(1);

      expect(homeserver.files.has(urlOf(stuck))).toBe(false);
      expect(homeserver.files.has(urlOf(again))).toBe(true);
    });
  });

  describe('a removed item stays removed on every device', () => {
    const puts = () => homeserver.log.filter((entry) => entry.startsWith(`${HttpMethod.PUT} `));
    const deletes = () => homeserver.log.filter((entry) => entry.startsWith(`${HttpMethod.DELETE} `));
    const listingsOf = (rows: CommerceReviewModelSchema[]) => rows.map(({ record }) => record.listingId).sort();

    /** A fresh sign-in on another device: nothing local, no session memory; the homeserver and the service are shared. */
    const switchDevice = async () => {
      await db.table(CommerceReviewModel.table.name).clear();
      await CommerceSyncJobModel.table.clear();
      CommerceApplication.resetOwnReviewHydrateMemo();
      homeserver.log.length = 0;
      service.log.length = 0;
      service.withdrawals.length = 0;
      vi.spyOn(MarketplaceGatewayService, 'getReviewAttestations').mockResolvedValue(
        attestations.map(({ wire }, index) => ({ listingId: LISTINGS[index].id, ...wire })),
      );
    };

    describe('with the belt removed on device 1 and the other items kept', () => {
      beforeEach(async () => {
        service.withdraw('belt');
        await switchDevice();
      });

      it('does not show the belt when device 2 opens the order, though the homeserver still serves its record', async () => {
        const rows = await CommerceApplication.getOwnMarketplaceOrderReviews(ORDER_FIXTURE_BUYER, service.order());

        expect(listingsOf(rows)).toEqual(['boots', 'wallet']);
        expect(listingsOf(await localRows())).toEqual(['boots', 'wallet']);
        expect(puts()).toEqual([]);
        expect(homeserver.files.has(urlOf(published[1]))).toBe(true);
      });

      it("does not read the belt's record again in the same session", async () => {
        await CommerceApplication.getOwnMarketplaceOrderReviews(ORDER_FIXTURE_BUYER, service.order());
        homeserver.log.length = 0;

        await CommerceApplication.getOwnMarketplaceOrderReviews(ORDER_FIXTURE_BUYER, service.order());

        expect(homeserver.log).toEqual([]);
      });

      it('publishes the belt again when device 2 edits it, and only the belt', async () => {
        service.reinstate('belt');

        const edited = await CommerceApplication.commitPublishOwnReviews({
          actorPubky: ORDER_FIXTURE_BUYER,
          order,
          result: resultFor(['belt']),
        });

        expect(edited).toHaveLength(1);
        expect(edited[0]).toMatchObject({ sync_status: 'synced', review_id: published[1].review_id });
        expect(puts()).toEqual([`${HttpMethod.PUT} ${urlOf(published[1])}`]);
      });

      it('clears the belt another device still holds on refresh, and leaves the other items alone', async () => {
        await db.table(CommerceReviewModel.table.name).bulkPut(published);

        await expect(CommerceApplication.refreshOwnReviews(ORDER_FIXTURE_BUYER, [service.order()])).resolves.toBe(1);

        expect(listingsOf(await localRows())).toEqual(['boots', 'wallet']);
        expect(homeserver.log.filter((entry) => entry.includes(urlOf(published[1])))).toEqual([]);
      });

      it('keeps the belt copy when the order data predates an edit that cleared the removal', async () => {
        await db.table(CommerceReviewModel.table.name).bulkPut(published);
        const flagged = service.order();
        service.reinstate('belt');

        await expect(CommerceApplication.refreshOwnReviews(ORDER_FIXTURE_BUYER, [flagged])).resolves.toBe(0);

        expect(listingsOf(await localRows())).toEqual(['belt', 'boots', 'wallet']);
      });
    });

    describe('the repair of a one-review order whose record a later order overwrote', () => {
      let single: MarketplaceOrder;
      let boots: CommerceReviewModelSchema;

      beforeEach(async () => {
        [boots] = published;
        single = { ...order, reviews: [order.reviews![0]] };
        service = installFakeMarketplaceService(single, ORDER_FIXTURE_BUYER);
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
        await switchDevice();
      });

      it('republishes the record once while the item is not removed', async () => {
        const rows = await CommerceApplication.getOwnMarketplaceOrderReviews(ORDER_FIXTURE_BUYER, service.order());

        expect(listingsOf(rows)).toEqual(['boots']);
        expect(puts()).toEqual([`${HttpMethod.PUT} ${urlOf(boots)}`]);
      });

      it('publishes nothing on device 2 once the item was removed, and the homeserver gains nothing', async () => {
        service.withdraw('boots');
        const before = homeserver.files.size;

        await expect(
          CommerceApplication.getOwnMarketplaceOrderReviews(ORDER_FIXTURE_BUYER, service.order()),
        ).resolves.toEqual([]);

        expect(puts()).toEqual([]);
        expect(homeserver.files.size).toBe(before);
        expect(await localRows()).toEqual([]);
        expect(await CommerceSyncJobModel.table.toArray()).toEqual([]);
      });

      it('publishes nothing from an order read made before the removal', async () => {
        service.withdraw('boots');

        await expect(CommerceApplication.getOwnMarketplaceOrderReviews(ORDER_FIXTURE_BUYER, single)).resolves.toEqual([]);

        expect(puts()).toEqual([]);
        expect(await localRows()).toEqual([]);
      });

      it('publishes nothing when the removal lands after the repair read the order and before it writes', async () => {
        const parked = service.holdNext('getOrder');
        const repair = CommerceApplication.getOwnMarketplaceOrderReviews(ORDER_FIXTURE_BUYER, single);
        await parked.reached;
        service.withdraw('boots');
        parked.release();

        await expect(repair).resolves.toEqual([]);

        expect(puts()).toEqual([]);
        expect(await localRows()).toEqual([]);
        expect(await CommerceSyncJobModel.table.toArray()).toEqual([]);
      });

      it('takes back its own PUT when the withdrawal landed after the check and before the PUT finished', async () => {
        const parked = homeserver.holdNext(HttpMethod.PUT, urlOf(boots));
        const repair = CommerceApplication.getOwnMarketplaceOrderReviews(ORDER_FIXTURE_BUYER, single);
        await parked.reached;
        service.withdraw('boots');
        parked.release();

        await expect(repair).resolves.toEqual([]);

        expect(puts()).toHaveLength(1);
        expect(deletes()).toEqual([`${HttpMethod.DELETE} ${urlOf(boots)}`]);
        expect(homeserver.files.has(urlOf(boots))).toBe(false);
        expect(await localRows()).toEqual([]);
        expect(await CommerceSyncJobModel.table.toArray()).toEqual([]);
      });

      it('keeps its PUT when no withdrawal arrived', async () => {
        await CommerceApplication.getOwnMarketplaceOrderReviews(ORDER_FIXTURE_BUYER, single);

        expect(deletes()).toEqual([]);
        expect(homeserver.files.has(urlOf(boots))).toBe(true);
      });
    });
  });
});
