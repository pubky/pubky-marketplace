import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/database/franky/franky';
import { HttpMethod } from '@/libs/http/http.types';
import { CommerceReviewModel, CommerceSyncJobModel } from '@/models/commerce/commerce.models';
import type { CommerceReviewModelSchema } from '@/models/commerce/commerce.schema';
import { CommerceRecordNormalizer } from '@/pipes/commerce/commerce.normalizer';
import { CommerceHomeserverService } from '@/services/homeserver/commerce/commerce';
import { LocalCommerceService } from '@/services/local/commerce/commerce';
import { MarketplaceGatewayService, type MarketplaceOrder } from '@/services/marketplace/marketplace';
import { useAuthStore } from '@/stores/auth/auth.store';
import { createOrderFixture, ORDER_FIXTURE_BUYER } from '@/test/fixtures/commerce/orders';
import { type FakeHomeserver, installFakeHomeserver } from '@/test-utils/fake-homeserver';
import { issuedAttestation, reviewResult } from '@/test-utils/review-attestation';
import { installWebLocks, removeWebLocks } from '@/test-utils/web-locks';
import { CommerceApplication } from './commerce';

const REVIEW_ID = '018f47d2-6a27-7c23-a49d-0000000000aa';

function withOwnReview(order: MarketplaceOrder): MarketplaceOrder {
  return {
    ...order,
    reviews: [
      {
        id: REVIEW_ID,
        reviewerPubky: ORDER_FIXTURE_BUYER,
        subjectPubky: order.sellerPubky,
        rating: 5,
        text: 'Accurate and fast.',
        createdAt: '2026-08-21T10:00:00.000Z',
      },
    ],
  };
}

describe.each([
  ['with Web Locks (two tabs share them)', true],
  ['without Web Locks (one tab queues its own writes)', false],
])('own reviews on the reviewer homeserver, %s', (_label, webLocks) => {
  let homeserver: FakeHomeserver;
  let order: MarketplaceOrder;
  let published: CommerceReviewModelSchema;
  let url: string;
  let wire: ReturnType<typeof issuedAttestation>['wire'];

  const localRow = () => LocalCommerceService.getOwnReviewByOrder(ORDER_FIXTURE_BUYER, order.id);
  const jobs = () => CommerceSyncJobModel.table.filter((job) => job.entity_type !== 'review_removed').toArray();
  const removedMarkers = () =>
    CommerceSyncJobModel.table.filter((job) => job.entity_type === 'review_removed').toArray();
  const deletes = () => homeserver.log.filter((entry) => entry === `${HttpMethod.DELETE} ${url}`);

  /** The record another device would have written: same path, a later revision. */
  const otherDeviceEdit = (revision: number, text: string, rating = 3) => ({
    ...published.record,
    revision,
    text,
    ratings: { overall: rating },
    updatedAt: '2026-08-22T10:00:00.000Z',
  });

  /** Parks the next review read after it has been answered, so its result is stale by the time it is used. */
  const parkAfterRead = () => {
    const read = CommerceHomeserverService.fetchJsonIfFound.bind(CommerceHomeserverService);
    let arrive = () => {};
    let release = () => {};
    const reached = new Promise<void>((resolve) => (arrive = resolve));
    const proceed = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(CommerceHomeserverService, 'fetchJsonIfFound').mockImplementationOnce(async (target, logUrl) => {
      const answer = await read(target, logUrl);
      arrive();
      await proceed;
      return answer;
    });
    return { reached, release };
  };

  /** Lets `operation` run to its DEL if nothing holds it back; resolves either way. */
  const letItRunIfFree = async (operation: () => boolean) => {
    await vi.waitFor(() => expect(operation()).toBe(true), { timeout: 150, interval: 5 }).catch(() => undefined);
  };

  const publishAgain = async () =>
    await CommerceApplication.commitPublishOwnReview({
      actorPubky: ORDER_FIXTURE_BUYER,
      order,
      result: reviewResult(wire),
    });

  beforeEach(async () => {
    await db.table(CommerceReviewModel.table.name).clear();
    await CommerceSyncJobModel.table.clear();
    if (webLocks) installWebLocks();
    useAuthStore.getState().setCurrentUserPubky(ORDER_FIXTURE_BUYER);
    CommerceApplication.resetOwnReviewHydrateMemo();
    homeserver = installFakeHomeserver();
    wire = issuedAttestation('boots').wire;
    vi.spyOn(MarketplaceGatewayService, 'getReviewAttestation').mockResolvedValue(wire);
    order = withOwnReview(createOrderFixture('completed'));
    published = (await publishAgain())!;
    url = CommerceRecordNormalizer.reviewUri(ORDER_FIXTURE_BUYER, published.review_id);
    homeserver.log.length = 0;
  });

  afterEach(async () => {
    removeWebLocks();
    useAuthStore.getState().setCurrentUserPubky(null);
    vi.restoreAllMocks();
    await db.table(CommerceReviewModel.table.name).clear();
    await CommerceSyncJobModel.table.clear();
  });

  describe('refreshing from the homeserver', () => {
    it('shows an edit made on another device when the page opens', async () => {
      homeserver.files.set(url, otherDeviceEdit(2, 'Changed my mind.'));

      await expect(CommerceApplication.refreshOwnReviews(ORDER_FIXTURE_BUYER, [order])).resolves.toBe(1);

      const row = await localRow();
      expect(row?.record.text).toBe('Changed my mind.');
      expect(row?.record.ratings.overall).toBe(3);
      expect(row?.record.revision).toBe(2);
      expect(row?.sync_status).toBe('synced');
      expect(homeserver.log).toEqual([`${HttpMethod.GET} ${url}`]);
    });

    it('reads the record even when this device has no local row for the order', async () => {
      await CommerceReviewModel.table.clear();
      homeserver.files.set(url, otherDeviceEdit(2, 'Written elsewhere.'));

      await expect(CommerceApplication.refreshOwnReviews(ORDER_FIXTURE_BUYER, [order])).resolves.toBe(1);

      expect((await localRow())?.record.text).toBe('Written elsewhere.');
    });

    it('leaves an unchanged review alone', async () => {
      await expect(CommerceApplication.refreshOwnReviews(ORDER_FIXTURE_BUYER, [order])).resolves.toBe(0);
      expect((await localRow())?.record.revision).toBe(1);
    });

    it('reads nothing for an order that carries no review of the user', async () => {
      const unreviewed = createOrderFixture('completed');
      await expect(CommerceApplication.refreshOwnReviews(ORDER_FIXTURE_BUYER, [unreviewed])).resolves.toBe(0);
      expect(homeserver.log).toEqual([]);
    });

    it('keeps an unsynced local edit and its outbox job over a newer homeserver record', async () => {
      homeserver.failNext(HttpMethod.PUT, url, 500);
      await expect(publishAgain()).rejects.toThrow();
      const pending = (await localRow())!;
      expect(pending.sync_status).toBe('pending');
      homeserver.files.set(url, otherDeviceEdit(9, 'Elsewhere, later.'));

      await expect(CommerceApplication.refreshOwnReviews(ORDER_FIXTURE_BUYER, [order])).resolves.toBe(0);

      expect((await localRow())?.record.revision).toBe(pending.record.revision);
      expect(await jobs()).toHaveLength(1);
    });

    it('never clears the local row on a homeserver 404, since reads lag acked writes', async () => {
      homeserver.files.delete(url);
      await expect(CommerceApplication.refreshOwnReviews(ORDER_FIXTURE_BUYER, [order])).resolves.toBe(0);
      expect(await localRow()).toBeDefined();
    });

    it('ends at the new revision when an edit on this device queues behind a refresh', async () => {
      const stale = otherDeviceEdit(1, 'Stale read.');
      homeserver.files.set(url, stale);
      const gate = homeserver.holdNext(HttpMethod.GET, url);
      const refresh = CommerceApplication.refreshOwnReviews(ORDER_FIXTURE_BUYER, [order]);
      await gate.reached;
      const edit = publishAgain();
      gate.release();
      await Promise.all([refresh, edit]);

      expect((await localRow())?.record.revision).toBe(2);
      expect((homeserver.files.get(url) as { revision: number }).revision).toBe(2);
    });
  });

  describe('removing a review', () => {
    it('sends a DEL to the review path and clears the local copy', async () => {
      await expect(CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id)).resolves.toBe('removed');

      expect(deletes()).toHaveLength(1);
      expect(homeserver.files.has(url)).toBe(false);
      expect(await localRow()).toBeUndefined();
      expect(await jobs()).toEqual([]);
    });

    it('does nothing when there is no local review to remove', async () => {
      await CommerceReviewModel.table.clear();
      await expect(CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id)).resolves.toBe('absent');
      expect(deletes()).toEqual([]);
    });

    it('keeps the outbox job when the DEL fails, and one retry sends it once', async () => {
      homeserver.failNext(HttpMethod.DELETE, url, 500);

      await expect(CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id)).resolves.toBe('queued');

      expect(await localRow()).toBeUndefined();
      expect(homeserver.files.has(url)).toBe(true);
      const [queued] = await jobs();
      expect(queued).toMatchObject({ entity_type: 'review', operation: 'remove', status: 'failed', attempts: 1 });
      expect(deletes()).toHaveLength(1);

      await expect(CommerceApplication.resumeOwnReviewRemovals(ORDER_FIXTURE_BUYER)).resolves.toBe(1);
      expect(deletes()).toHaveLength(2);
      expect(homeserver.files.has(url)).toBe(false);
      expect(await jobs()).toEqual([]);

      await expect(CommerceApplication.resumeOwnReviewRemovals(ORDER_FIXTURE_BUYER)).resolves.toBe(0);
      expect(deletes()).toHaveLength(2);
    });

    it('keeps the job and counts the attempt when the retry fails too', async () => {
      homeserver.failNext(HttpMethod.DELETE, url, 500);
      homeserver.failNext(HttpMethod.DELETE, url, 500);
      await CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id);

      await expect(CommerceApplication.resumeOwnReviewRemovals(ORDER_FIXTURE_BUYER)).resolves.toBe(0);

      const [queued] = await jobs();
      expect(queued.attempts).toBe(2);
      expect(homeserver.files.has(url)).toBe(true);
    });

    it('treats a record that is already gone as removed', async () => {
      homeserver.failNext(HttpMethod.DELETE, url, 404);
      await expect(CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id)).resolves.toBe('removed');
      expect(await jobs()).toEqual([]);
    });

    it('does not resurrect a review whose DEL is still owed when the page refreshes', async () => {
      homeserver.failNext(HttpMethod.DELETE, url, 500);
      await CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id);
      homeserver.files.set(url, otherDeviceEdit(2, 'Still public.'));

      await expect(CommerceApplication.refreshOwnReviews(ORDER_FIXTURE_BUYER, [order])).resolves.toBe(0);

      expect(await localRow()).toBeUndefined();
    });

    it('does not resurrect a deleted review from a homeserver that still serves it just after the DEL', async () => {
      await CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id);
      homeserver.files.set(url, otherDeviceEdit(1, 'Served from a lagging replica.'));

      await expect(CommerceApplication.refreshOwnReviews(ORDER_FIXTURE_BUYER, [order])).resolves.toBe(0);

      expect(await localRow()).toBeUndefined();
    });

    it('drops a pending removal when the review is published again, so the retry never deletes it', async () => {
      homeserver.failNext(HttpMethod.DELETE, url, 500);
      await CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id);
      expect(await jobs()).toHaveLength(1);

      const again = (await publishAgain())!;
      homeserver.log.length = 0;

      expect(again.sync_status).toBe('synced');
      expect((await jobs()).filter((job) => job.operation === 'remove')).toEqual([]);
      await expect(CommerceApplication.resumeOwnReviewRemovals(ORDER_FIXTURE_BUYER)).resolves.toBe(0);
      expect(deletes()).toEqual([]);
      expect(homeserver.files.has(url)).toBe(true);
    });
  });

  describe('the overwritten-review repair next to removal', () => {
    /** This order's record is gone from every path the hydrate reads: another order's review overwrote it. */
    const overwrite = async () => {
      homeserver.files.delete(url);
      await CommerceReviewModel.table.clear();
      homeserver.log.length = 0;
      CommerceApplication.resetOwnReviewHydrateMemo();
    };
    const removalJob = () => ({
      id: 'removal-job',
      owner_id: ORDER_FIXTURE_BUYER,
      entity_type: 'review' as const,
      entity_id: published.review_id,
      operation: 'remove' as const,
      status: 'pending' as const,
      attempts: 0,
      next_attempt_at: 0,
      last_error_code: null,
      payload: { url, orderId: order.id },
      created_at: 1,
      updated_at: 1,
    });
    const puts = () => homeserver.log.filter((entry) => entry === `${HttpMethod.PUT} ${url}`);

    it('still republishes a review the service holds when no record carries it', async () => {
      await overwrite();

      const restored = await CommerceApplication.getOwnMarketplaceReview(ORDER_FIXTURE_BUYER, order);

      expect(restored?.review_id).toBe(published.review_id);
      expect(restored?.sync_status).toBe('synced');
      expect(puts()).toHaveLength(1);
      expect(await jobs()).toEqual([]);
    });

    it('does not bring back a review the user removed, even after a reload', async () => {
      await expect(CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id)).resolves.toBe('removed');
      expect(await removedMarkers()).toHaveLength(1);
      homeserver.log.length = 0;
      CommerceApplication.resetOwnReviewHydrateMemo();

      await expect(CommerceApplication.getOwnMarketplaceReview(ORDER_FIXTURE_BUYER, order)).resolves.toBeNull();

      expect(puts()).toEqual([]);
      expect(await localRow()).toBeUndefined();
      expect(homeserver.files.has(url)).toBe(false);
    });

    it('does not bring back a review whose DEL is still owed', async () => {
      homeserver.failNext(HttpMethod.DELETE, url, 500);
      await expect(CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id)).resolves.toBe('queued');
      homeserver.log.length = 0;
      CommerceApplication.resetOwnReviewHydrateMemo();

      await expect(CommerceApplication.getOwnMarketplaceReview(ORDER_FIXTURE_BUYER, order)).resolves.toBeNull();

      expect(puts()).toEqual([]);
      expect(await jobs()).toHaveLength(1);
    });

    it('stops a republish that raced a removal between its tombstone check and its lock', async () => {
      await overwrite();
      const check = vi.spyOn(LocalCommerceService, 'isOwnReviewRemoved');
      check.mockImplementationOnce(async () => {
        await LocalCommerceService.stageOwnReviewRemoval(published, removalJob());
        return false;
      });

      await expect(CommerceApplication.getOwnMarketplaceReview(ORDER_FIXTURE_BUYER, order)).resolves.toBeNull();

      expect(puts()).toEqual([]);
    });

    it('repairs again after the user removes the review and then edits it', async () => {
      await CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id);
      await expect(publishAgain()).resolves.toMatchObject({ sync_status: 'synced' });
      expect(await removedMarkers()).toEqual([]);

      await overwrite();
      const restored = await CommerceApplication.getOwnMarketplaceReview(ORDER_FIXTURE_BUYER, order);

      expect(restored?.review_id).toBe(published.review_id);
      expect(puts()).toHaveLength(1);
    });

    it('yields to a local row that appeared before the repair took the lock', async () => {
      await overwrite();
      await CommerceReviewModel.table.put(published);
      homeserver.log.length = 0;

      const result = await CommerceApplication.commitPublishOwnReview({
        actorPubky: ORDER_FIXTURE_BUYER,
        order,
        repair: true,
        result: reviewResult(wire),
      });

      expect(result?.review_id).toBe(published.review_id);
      expect(puts()).toEqual([]);
    });
  });

  describe('interleavings', () => {
    it('a refresh racing a delete does not resurrect the deleted review', async () => {
      // The refresh has already read a newer record when it is parked; the
      // delete is issued while it waits. If the delete could run in that gap
      // the refresh would write the stale record back after the DEL.
      homeserver.files.set(url, otherDeviceEdit(2, 'Newer elsewhere.'));
      const gate = parkAfterRead();
      const refresh = CommerceApplication.refreshOwnReviews(ORDER_FIXTURE_BUYER, [order]);
      await gate.reached;
      const removal = CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id);
      await letItRunIfFree(() => deletes().length > 0);
      gate.release();
      await Promise.all([refresh, removal]);

      expect(await localRow()).toBeUndefined();
      expect(homeserver.files.has(url)).toBe(false);
      expect(await jobs()).toEqual([]);
    });

    it('a delete in flight finishes before a refresh starts, so the refresh cannot write the review back', async () => {
      const gate = homeserver.holdNext(HttpMethod.DELETE, url);
      const removal = CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id);
      await gate.reached;
      const refresh = CommerceApplication.refreshOwnReviews(ORDER_FIXTURE_BUYER, [order]);
      await Promise.resolve();
      gate.release();
      await Promise.all([removal, refresh]);

      expect(await localRow()).toBeUndefined();
      expect(homeserver.files.has(url)).toBe(false);
    });

    it('a publication queued behind a delete in flight lands after it, so the DEL cannot remove the new record', async () => {
      const gate = homeserver.holdNext(HttpMethod.DELETE, url);
      const removal = CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id);
      await gate.reached;
      const edit = publishAgain();
      await Promise.resolve();
      gate.release();
      await Promise.all([removal, edit]);

      expect(homeserver.files.has(url)).toBe(true);
      expect((await localRow())?.sync_status).toBe('synced');
      expect((await jobs()).filter((job) => job.operation === 'remove')).toEqual([]);
    });

    it('two tabs resuming one failed removal send one DEL', async () => {
      homeserver.failNext(HttpMethod.DELETE, url, 500);
      await CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id);
      expect(deletes()).toHaveLength(1);

      const results = await Promise.all([
        CommerceApplication.resumeOwnReviewRemovals(ORDER_FIXTURE_BUYER),
        CommerceApplication.resumeOwnReviewRemovals(ORDER_FIXTURE_BUYER),
      ]);

      expect(results.reduce((sum, count) => sum + count, 0)).toBe(1);
      expect(deletes()).toHaveLength(2);
      expect(await jobs()).toEqual([]);
    });

    it('a retried publication completes its outbox job, so a later refresh is not held back', async () => {
      homeserver.failNext(HttpMethod.PUT, url, 500);
      await expect(publishAgain()).rejects.toThrow();
      expect(await jobs()).toHaveLength(1);

      await expect(CommerceApplication.resumeOwnReviewPublications(ORDER_FIXTURE_BUYER)).resolves.toBe(1);

      expect(await jobs()).toEqual([]);
      homeserver.files.set(url, otherDeviceEdit(9, 'Elsewhere, later.'));
      await expect(CommerceApplication.refreshOwnReviews(ORDER_FIXTURE_BUYER, [order])).resolves.toBe(1);
    });
  });
});
