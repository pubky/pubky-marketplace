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
import { asOpaque } from '@/test-utils/type-assertions';
import { installWebLocks, removeWebLocks } from '@/test-utils/web-locks';
import { CommerceApplication } from './commerce';

const config = vi.hoisted(() => ({ mode: 'transaction-service' as string }));

vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return { ...actual, getCommerceAdapterMode: () => config.mode };
});

const LISTINGS = [
  { id: 'boots', title: 'Handmade leather boots' },
  { id: 'belt', title: 'Braided leather belt' },
  { id: 'wallet', title: 'Slim leather wallet' },
];
const RELEASE_AT = '2026-09-04T12:00:00.000Z';
const LATER_RELEASE_AT = '2026-09-06T12:00:00.000Z';

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

describe('own reviews a double-blind window withholds', () => {
  let homeserver: FakeHomeserver;
  let service: FakeMarketplaceService;
  let order: MarketplaceOrder;
  let attestations: ReturnType<typeof issuedAttestation>[];
  /** What `GET review-attestations` answers: still withheld until a test releases it. */
  let attestationAnswer: () => unknown;
  let attestationReads: ReturnType<typeof vi.spyOn>;

  const urlOfListing = (listingId: string, row?: CommerceReviewModelSchema) =>
    CommerceRecordNormalizer.reviewUri(ORDER_FIXTURE_BUYER, row?.review_id ?? `unknown-${listingId}`);
  const localRows = () => LocalCommerceService.getOwnReviewsByOrder(ORDER_FIXTURE_BUYER, order.id);
  const jobs = () => CommerceSyncJobModel.table.toArray();
  const awaitingJobs = async () => (await jobs()).filter((job) => job.status === 'awaiting_release');
  const puts = () => homeserver.log.filter((entry) => entry.startsWith(`${HttpMethod.PUT} `));
  const releasedAnswer = () => ({
    attestations: attestations.map(({ wire }, index) => ({ listingId: LISTINGS[index].id, ...wire })),
  });
  const release = () => {
    attestationAnswer = () => releasedAnswer().attestations;
  };

  /** What a withheld `review.create` / `review.update` answers: the reviews, and no attestation. */
  const withheldResultFor = (
    listingIds: string[],
    text = (id: string) => `Review of ${id}.`,
    releaseAt = RELEASE_AT,
  ) => ({
    kind: 'review',
    attestationStatus: 'pending',
    releaseAt,
    reviews: listingIds.map((id) => ({
      reviewerPubky: ORDER_FIXTURE_BUYER,
      reviewerRole: 'buyer',
      subjectPubky: ORDER_FIXTURE_SELLER,
      listingAggregateId: `listing:${ORDER_FIXTURE_SELLER}_${id}`,
      rating: 5,
      text: text(id),
      createdAt: '2026-08-21T10:00:00.000Z',
      updatedAt: '2026-08-21T10:00:00.000Z',
    })),
  });

  const hold = (listingIds = LISTINGS.map(({ id }) => id)) =>
    CommerceApplication.commitPublishOwnReviews({
      actorPubky: ORDER_FIXTURE_BUYER,
      order,
      result: withheldResultFor(listingIds),
    });

  beforeEach(async () => {
    config.mode = 'transaction-service';
    await db.table(CommerceReviewModel.table.name).clear();
    await CommerceSyncJobModel.table.clear();
    installWebLocks();
    useAuthStore.getState().setCurrentUserPubky(ORDER_FIXTURE_BUYER);
    CommerceApplication.resetOwnReviewHydrateMemo();
    CommerceApplication.resetReleaseNotificationMemo();
    homeserver = installFakeHomeserver();
    order = reviewedOrder();
    service = installFakeMarketplaceService(order, ORDER_FIXTURE_BUYER);
    attestations = LISTINGS.map(({ id }) => issuedAttestation(id));
    attestationAnswer = () => ({ status: 'pending', releaseAt: RELEASE_AT });
    attestationReads = vi
      .spyOn(MarketplaceGatewayService, 'getReviewAttestations')
      .mockImplementation(async () => attestationAnswer() as never);
  });

  afterEach(async () => {
    removeWebLocks();
    useAuthStore.getState().setCurrentUserPubky(null);
    vi.restoreAllMocks();
    await db.table(CommerceReviewModel.table.name).clear();
    await CommerceSyncJobModel.table.clear();
  });

  describe('holding the review', () => {
    it('keeps a withheld result in the outbox as awaiting release and publishes nothing', async () => {
      await expect(hold()).resolves.toEqual([]);

      expect(homeserver.log).toEqual([]);
      expect(await localRows()).toEqual([]);
      expect(await jobs()).toHaveLength(1);
      expect((await awaitingJobs())[0]).toMatchObject({
        owner_id: ORDER_FIXTURE_BUYER,
        entity_type: 'review',
        entity_id: order.id,
        operation: 'publish',
        status: 'awaiting_release',
        attempts: 0,
        last_error_code: null,
      });
    });

    it('shows the held terms and the window end for the surfaces', async () => {
      await hold();

      await expect(CommerceApplication.getAwaitingReleaseReviews(ORDER_FIXTURE_BUYER)).resolves.toEqual([
        {
          orderId: order.id,
          releaseAt: RELEASE_AT,
          reviewerRole: 'buyer',
          items: LISTINGS.map(({ id }) => ({
            listingOwnerPubky: ORDER_FIXTURE_SELLER,
            listingId: id,
            rating: 5,
            text: `Review of ${id}.`,
            updatedAt: '2026-08-21T10:00:00.000Z',
          })),
        },
      ]);
    });

    it('follows the latest terms: an edit made while withheld replaces only the item it edits', async () => {
      await hold();
      await CommerceApplication.commitPublishOwnReviews({
        actorPubky: ORDER_FIXTURE_BUYER,
        order,
        result: withheldResultFor(['belt'], () => 'Changed my mind about the belt.', LATER_RELEASE_AT),
      });

      expect(await awaitingJobs()).toHaveLength(1);
      const [held] = await CommerceApplication.getAwaitingReleaseReviews(ORDER_FIXTURE_BUYER);
      expect(held.releaseAt).toBe(LATER_RELEASE_AT);
      expect(held.items.map(({ listingId, text }) => [listingId, text])).toEqual([
        ['boots', 'Review of boots.'],
        ['belt', 'Changed my mind about the belt.'],
        ['wallet', 'Review of wallet.'],
      ]);
      expect(homeserver.log).toEqual([]);

      release();
      await CommerceApplication.resumeAwaitingReleaseReviews(ORDER_FIXTURE_BUYER);
      const rows = await localRows();
      expect(Object.fromEntries(rows.map((row) => [row.record.listingId, row.record.text]))).toEqual({
        boots: 'Review of boots.',
        belt: 'Changed my mind about the belt.',
        wallet: 'Review of wallet.',
      });
    });

    it('holds a v1 review that names no listing, and publishes it from the single attestation route', async () => {
      const single = {
        kind: 'review',
        attestationStatus: 'pending',
        releaseAt: RELEASE_AT,
        review: {
          reviewerPubky: ORDER_FIXTURE_BUYER,
          reviewerRole: 'buyer',
          subjectPubky: ORDER_FIXTURE_SELLER,
          rating: 4,
          text: 'Good boots.',
          createdAt: '2026-08-21T10:00:00.000Z',
          updatedAt: '2026-08-21T10:00:00.000Z',
        },
      };
      await expect(
        CommerceApplication.commitPublishOwnReviews({ actorPubky: ORDER_FIXTURE_BUYER, order, result: single }),
      ).resolves.toEqual([]);
      const [held] = await CommerceApplication.getAwaitingReleaseReviews(ORDER_FIXTURE_BUYER);
      expect(held.items).toEqual([expect.objectContaining({ listingId: 'boots', rating: 4, text: 'Good boots.' })]);
      const readSingle = vi
        .spyOn(MarketplaceGatewayService, 'getReviewAttestation')
        .mockResolvedValue({ status: 'pending', releaseAt: RELEASE_AT });

      await expect(CommerceApplication.resumeAwaitingReleaseReviews(ORDER_FIXTURE_BUYER)).resolves.toBe(0);
      expect(puts()).toEqual([]);

      readSingle.mockResolvedValue(attestations[0].wire);
      await expect(CommerceApplication.resumeAwaitingReleaseReviews(ORDER_FIXTURE_BUYER)).resolves.toBe(1);
      expect(await awaitingJobs()).toEqual([]);
      expect((await localRows()).map(({ record }) => [record.listingId, record.text])).toEqual([
        ['boots', 'Good boots.'],
      ]);
    });
  });

  describe('retrying while the window holds the review', () => {
    it('leaves the job as it is, without a failure or a growing backoff, and publishes nothing', async () => {
      await hold();
      const before = (await awaitingJobs())[0];

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await expect(CommerceApplication.resumeOwnReviewPublications(ORDER_FIXTURE_BUYER)).resolves.toBe(0);
      }

      expect(attestationReads).toHaveBeenCalledTimes(3);
      expect(homeserver.log).toEqual([]);
      const [after] = await jobs();
      expect(after).toMatchObject({
        id: before.id,
        status: 'awaiting_release',
        attempts: 0,
        last_error_code: null,
        next_attempt_at: before.next_attempt_at,
      });
    });

    it('records a later window end the service now names', async () => {
      await hold();
      attestationAnswer = () => ({ status: 'pending', releaseAt: LATER_RELEASE_AT });

      await CommerceApplication.resumeAwaitingReleaseReviews(ORDER_FIXTURE_BUYER);

      const [held] = await CommerceApplication.getAwaitingReleaseReviews(ORDER_FIXTURE_BUYER);
      expect(held.releaseAt).toBe(LATER_RELEASE_AT);
      expect(await awaitingJobs()).toHaveLength(1);
    });

    it('keeps the job when the attestations or the order cannot be read', async () => {
      await hold();
      release();
      attestationReads.mockRejectedValueOnce(new Error('offline'));
      await expect(CommerceApplication.resumeAwaitingReleaseReviews(ORDER_FIXTURE_BUYER)).resolves.toBe(0);
      expect(await awaitingJobs()).toHaveLength(1);

      service.failNext('getOrder');
      await expect(CommerceApplication.resumeAwaitingReleaseReviews(ORDER_FIXTURE_BUYER)).resolves.toBe(0);
      expect(await awaitingJobs()).toHaveLength(1);
      expect(homeserver.log).toEqual([]);
    });
  });

  describe('release', () => {
    it('publishes every item in line order and removes the job', async () => {
      await hold();
      release();

      await expect(CommerceApplication.resumeOwnReviewPublications(ORDER_FIXTURE_BUYER)).resolves.toBe(3);

      const rows = await localRows();
      expect(rows.map(({ record }) => record.listingId).sort()).toEqual(['belt', 'boots', 'wallet']);
      expect(rows.every((row) => row.sync_status === 'synced' && row.attestation_verified)).toBe(true);
      const byListing = new Map(rows.map((row) => [row.record.listingId, row]));
      expect(puts()).toEqual(LISTINGS.map(({ id }) => `${HttpMethod.PUT} ${urlOfListing(id, byListing.get(id))}`));
      expect(await jobs()).toEqual([]);
    });

    it('drops the job without publishing when the deployment issued no attestations', async () => {
      await hold();
      attestationAnswer = () => [];

      await expect(CommerceApplication.resumeAwaitingReleaseReviews(ORDER_FIXTURE_BUYER)).resolves.toBe(0);

      expect(await jobs()).toEqual([]);
      expect(homeserver.log).toEqual([]);
    });

    it('keeps a failed PUT pending for the resume, publishes the rest, and drops the held job', async () => {
      await hold();
      release();
      homeserver.failNext(HttpMethod.PUT, /./, 500);

      await expect(CommerceApplication.resumeAwaitingReleaseReviews(ORDER_FIXTURE_BUYER)).resolves.toBe(2);

      const rows = await localRows();
      expect(rows.map(({ record, sync_status }) => [record.listingId, sync_status])).toEqual(
        expect.arrayContaining([
          ['boots', 'pending'],
          ['belt', 'synced'],
          ['wallet', 'synced'],
        ]),
      );
      expect(await awaitingJobs()).toEqual([]);
      const outbox = await jobs();
      expect(outbox).toHaveLength(1);
      expect(outbox[0]).toMatchObject({
        operation: 'publish',
        entity_id: rows.find((r) => r.sync_status === 'pending')!.review_id,
      });

      homeserver.log.length = 0;
      await expect(CommerceApplication.resumeOwnReviewPublications(ORDER_FIXTURE_BUYER)).resolves.toBe(1);
      expect(puts()).toHaveLength(1);
      expect(await jobs()).toEqual([]);
    });

    it('keeps the job while a read the publication depends on cannot answer', async () => {
      await hold();
      release();
      service.failNext('getOrder');
      await expect(CommerceApplication.resumeAwaitingReleaseReviews(ORDER_FIXTURE_BUYER)).resolves.toBe(0);
      expect(await awaitingJobs()).toHaveLength(1);

      // The order read inside the first item's publication fails: nothing is written for it.
      let reads = 0;
      vi.spyOn(MarketplaceGatewayService, 'getOrder').mockImplementation(async () => {
        reads += 1;
        if (reads === 1) return order;
        throw new Error('offline');
      });
      await CommerceApplication.resumeAwaitingReleaseReviews(ORDER_FIXTURE_BUYER);

      expect(homeserver.log.filter((entry) => entry.startsWith(HttpMethod.PUT))).toEqual([]);
      expect(await awaitingJobs()).toHaveLength(1);
      expect(await localRows()).toEqual([]);
    });
  });

  describe('two tabs resuming one released job', () => {
    it('publish one set of records and clean the job up once', async () => {
      await hold();
      release();
      const [heldJob] = await awaitingJobs();
      const completions = vi.spyOn(LocalCommerceService, 'completeSyncJob');

      // Both tabs read the job list before either takes the order's lock.
      const listing = LocalCommerceService.getAwaitingReleaseReviewJobs.bind(LocalCommerceService);
      let arrived = 0;
      let openGate: () => void = () => {};
      const gate = new Promise<void>((resolve) => (openGate = resolve));
      vi.spyOn(LocalCommerceService, 'getAwaitingReleaseReviewJobs').mockImplementation(async (...args) => {
        const jobsListed = await listing(...args);
        arrived += 1;
        if (arrived === 2) openGate();
        await gate;
        return jobsListed;
      });
      // The tab holding the lock parks in its attestation read until the other has queued behind it.
      const parked = deferred();
      const reached = deferred();
      attestationReads.mockImplementationOnce(async () => {
        reached.resolve();
        await parked.promise;
        return releasedAnswer().attestations as never;
      });

      const tabA = CommerceApplication.resumeAwaitingReleaseReviews(ORDER_FIXTURE_BUYER);
      const tabB = CommerceApplication.resumeAwaitingReleaseReviews(ORDER_FIXTURE_BUYER);
      await reached.promise;
      expect(arrived).toBe(2);
      parked.resolve();

      const published = await Promise.all([tabA, tabB]);

      expect(published.sort()).toEqual([0, 3]);
      expect(puts()).toHaveLength(3);
      expect(new Set(puts()).size).toBe(3);
      expect(attestationReads).toHaveBeenCalledTimes(1);
      expect(completions.mock.calls.filter(([id]) => id === heldJob.id)).toHaveLength(1);
      expect(await jobs()).toEqual([]);
      expect(await localRows()).toHaveLength(3);
    });
  });

  describe('a review removed while withheld', () => {
    it('is withdrawn at the service, never publishes at release, and leaves no job', async () => {
      await hold();

      await expect(CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id)).resolves.toBe('removed');

      expect(service.withdrawals).toEqual([undefined]);
      expect(service.withdrawn()).toBe(true);
      expect(await jobs()).toEqual([]);
      await expect(CommerceApplication.getAwaitingReleaseReviews(ORDER_FIXTURE_BUYER)).resolves.toEqual([]);

      release();
      await expect(CommerceApplication.resumeOwnReviewPublications(ORDER_FIXTURE_BUYER)).resolves.toBe(0);
      expect(homeserver.log).toEqual([]);
      expect(await localRows()).toEqual([]);
    });

    it('stays withdrawn when the service withdrawal fails, and the retry finishes it without ever publishing', async () => {
      await hold();
      service.failNext('review.withdraw');

      await expect(CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id)).resolves.toBe('queued');

      expect(await awaitingJobs()).toHaveLength(1);
      expect(service.withdrawn()).toBe(false);
      await expect(CommerceApplication.getAwaitingReleaseReviews(ORDER_FIXTURE_BUYER)).resolves.toEqual([]);

      release();
      await expect(CommerceApplication.resumeOwnReviewPublications(ORDER_FIXTURE_BUYER)).resolves.toBe(0);

      expect(homeserver.log).toEqual([]);
      expect(attestationReads).not.toHaveBeenCalled();
      expect(service.withdrawn()).toBe(true);
      expect(await jobs()).toEqual([]);
    });

    it('answers absent when nothing is held and nothing is published', async () => {
      await expect(CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id)).resolves.toBe('absent');
    });

    it('skips an item withdrawn on another device and publishes the rest', async () => {
      await hold();
      service.withdraw('belt');
      release();

      await expect(CommerceApplication.resumeAwaitingReleaseReviews(ORDER_FIXTURE_BUYER)).resolves.toBe(2);

      expect((await localRows()).map(({ record }) => record.listingId).sort()).toEqual(['boots', 'wallet']);
      expect(puts()).toHaveLength(2);
      expect(await jobs()).toEqual([]);
    });

    it('takes a record back that a withdrawal overtook during its PUT', async () => {
      await hold(['boots']);
      release();
      let phase = 0;
      homeserver.onRequest = ({ entry, phase: when }) => {
        if (when === 'before' && entry.startsWith(`${HttpMethod.PUT} `) && phase === 0) {
          phase = 1;
          service.withdraw('boots');
        }
      };

      await expect(CommerceApplication.resumeAwaitingReleaseReviews(ORDER_FIXTURE_BUYER)).resolves.toBe(0);

      expect(homeserver.files.size).toBe(0);
      expect(await localRows()).toEqual([]);
      expect(await jobs()).toEqual([]);
    });

    it('does not publish an item while a removal of it is still owed on this device', async () => {
      await hold(['boots']);
      release();
      vi.spyOn(LocalCommerceService, 'hasOwedOwnReviewRemoval').mockResolvedValue(true);

      await CommerceApplication.resumeAwaitingReleaseReviews(ORDER_FIXTURE_BUYER);

      expect(homeserver.log).toEqual([]);
      expect(await jobs()).toEqual([]);
    });
  });

  describe('the review_released notification', () => {
    const released = (id: string, orderId = order.id) => ({
      id,
      type: 'review_released',
      actorPubky: 'system',
      aggregateId: `order:${orderId}`,
    });
    const notify = (rows: ReturnType<typeof released>[]) =>
      vi.spyOn(MarketplaceGatewayService, 'getNotifications').mockResolvedValue(asOpaque(rows));
    /** The retries the notification poll started, awaited to completion. */
    const settleRetries = async (retry: { mock: { results: { value: unknown }[] } }) =>
      await Promise.all(retry.mock.results.map((result) => result.value));

    it('publishes the held review once, after the orders loaded and the notification arrived, not before', async () => {
      await hold();

      // The orders surface loaded: the service still withholds it.
      await CommerceApplication.resumeOwnReviewPublications(ORDER_FIXTURE_BUYER);
      expect(homeserver.log).toEqual([]);

      // The release happens at the service; nothing here has heard of it yet.
      release();
      expect(homeserver.log).toEqual([]);
      expect(await localRows()).toEqual([]);

      const retry = vi.spyOn(CommerceApplication, 'resumeAwaitingReleaseReviews');
      notify([released('018f47d2-6a27-7c23-a49d-000000000201')]);
      await CommerceApplication.getMarketplaceNotifications(ORDER_FIXTURE_BUYER);
      await settleRetries(retry);

      expect(retry).toHaveBeenCalledTimes(1);
      expect(retry).toHaveBeenCalledWith(ORDER_FIXTURE_BUYER, order.id);
      expect(puts()).toHaveLength(3);
      expect(await jobs()).toEqual([]);
    });

    it('starts one retry per notification however often the feed is read, and one per order', async () => {
      await hold();
      const retry = vi.spyOn(CommerceApplication, 'resumeAwaitingReleaseReviews');
      const first = released('018f47d2-6a27-7c23-a49d-000000000201');
      const otherOrder = released('018f47d2-6a27-7c23-a49d-000000000202', 'another-order');
      notify([first, otherOrder]);

      await CommerceApplication.getMarketplaceNotifications(ORDER_FIXTURE_BUYER);
      await CommerceApplication.getMarketplaceNotifications(ORDER_FIXTURE_BUYER);
      await CommerceApplication.getMarketplaceNotifications(ORDER_FIXTURE_BUYER);
      await settleRetries(retry);

      expect(retry.mock.calls).toEqual([
        [ORDER_FIXTURE_BUYER, order.id],
        [ORDER_FIXTURE_BUYER, 'another-order'],
      ]);
    });

    it('retries nothing for other notification kinds or in the sandbox', async () => {
      const retry = vi.spyOn(CommerceApplication, 'resumeAwaitingReleaseReviews');
      notify([
        { ...released('018f47d2-6a27-7c23-a49d-000000000203'), type: 'review_received' },
        { ...released('018f47d2-6a27-7c23-a49d-000000000204'), type: 'review_waiting' },
      ]);
      await CommerceApplication.getMarketplaceNotifications(ORDER_FIXTURE_BUYER);

      config.mode = 'sandbox';
      notify([released('018f47d2-6a27-7c23-a49d-000000000205')]);
      await CommerceApplication.getMarketplaceNotifications(ORDER_FIXTURE_BUYER);

      expect(retry).not.toHaveBeenCalled();
    });

    it('does not hold the notifications back for the retry', async () => {
      await hold();
      release();
      const parked = deferred();
      attestationReads.mockImplementationOnce(async () => {
        await parked.promise;
        return releasedAnswer().attestations as never;
      });
      notify([released('018f47d2-6a27-7c23-a49d-000000000201')]);

      const rows = await CommerceApplication.getMarketplaceNotifications(ORDER_FIXTURE_BUYER);

      expect(rows.map(({ type }) => type)).toEqual(['review_released']);
      expect(homeserver.log).toEqual([]);
      parked.resolve();
    });
  });
});

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}
