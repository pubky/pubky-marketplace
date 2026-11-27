import type { Session } from '@synonymdev/pubky';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/database/franky/franky';
import { clearDatabase, clearPrivateData } from '@/database/franky/franky.helpers';
import { HttpMethod } from '@/libs/http/http.types';
import { CommerceReviewModel, CommerceSyncJobModel } from '@/models/commerce/commerce.models';
import type { CommerceReviewModelSchema } from '@/models/commerce/commerce.schema';
import { CommerceRecordNormalizer } from '@/pipes/commerce/commerce.normalizer';
import { CommerceHomeserverService } from '@/services/homeserver/commerce/commerce';
import { HomeserverService } from '@/services/homeserver/homeserver';
import { installHomeserverWriteRetryDependenciesForTests } from '@/services/homeserver/write-retry';
import { LocalCommerceService } from '@/services/local/commerce/commerce';
import { MarketplaceGatewayService, type MarketplaceOrder } from '@/services/marketplace/marketplace';
import { useAuthStore } from '@/stores/auth/auth.store';
import { createOrderFixture, ORDER_FIXTURE_BUYER } from '@/test/fixtures/commerce/orders';
import { type FakeHomeserver, installFakeHomeserver } from '@/test-utils/fake-homeserver';
import { type FakeMarketplaceService, installFakeMarketplaceService } from '@/test-utils/fake-marketplace-service';
import { issuedAttestation, reviewResult } from '@/test-utils/review-attestation';
import { asOpaque } from '@/test-utils/type-assertions';
import { installWebLocks, removeWebLocks } from '@/test-utils/web-locks';
import { CommerceApplication } from './commerce';

const REVIEW_ID = '018f47d2-6a27-7c23-a49d-0000000000aa';

/** A transient failure as the Pubky SDK rejects a write with it. */
function sdkRequestError(statusCode: number): Error {
  return Object.assign(new Error(`Request failed: Server responded with an error: ${statusCode}`), {
    name: 'RequestError',
    data: { statusCode },
  });
}

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
  let service: FakeMarketplaceService;
  let order: MarketplaceOrder;
  let published: CommerceReviewModelSchema;
  let url: string;
  let wire: ReturnType<typeof issuedAttestation>['wire'];

  const localRow = () => LocalCommerceService.getOwnReviewByOrder(ORDER_FIXTURE_BUYER, order.id);
  const jobs = () => CommerceSyncJobModel.table.toArray();
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
    service = installFakeMarketplaceService(order, ORDER_FIXTURE_BUYER);
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

    it('settles a failed deletion after its owner removes the file', async () => {
      homeserver.failNext(HttpMethod.DELETE, url, 500);

      await expect(CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id)).resolves.toBe('queued');

      expect(await localRow()).toBeUndefined();
      expect(homeserver.files.has(url)).toBe(true);
      const [queued] = await jobs();
      expect(queued).toMatchObject({ entity_type: 'review', operation: 'remove', status: 'failed', attempts: 1 });
      expect(deletes()).toHaveLength(1);

      homeserver.files.delete(url);
      await expect(CommerceApplication.resumeOwnReviewRemovals(ORDER_FIXTURE_BUYER)).resolves.toBe(1);
      expect(deletes()).toHaveLength(1);
      expect(homeserver.files.has(url)).toBe(false);
      expect(await jobs()).toEqual([]);

      await expect(CommerceApplication.resumeOwnReviewRemovals(ORDER_FIXTURE_BUYER)).resolves.toBe(0);
      expect(deletes()).toHaveLength(1);
    });

    it('a retry whose scope ends during the service withdrawal sends no DEL and leaves the job as it was', async () => {
      homeserver.failNext(HttpMethod.DELETE, url, 500);
      await CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id);
      const [before] = await jobs();
      const scope = new AbortController();
      const readOrder = MarketplaceGatewayService.getOrder.bind(MarketplaceGatewayService);
      vi.spyOn(MarketplaceGatewayService, 'getOrder').mockImplementationOnce(async (...args) => {
        const read = await readOrder(...args);
        scope.abort(new DOMException('Signed out', 'AbortError'));
        return read;
      });

      await expect(CommerceApplication.resumeOwnReviewRemovals(ORDER_FIXTURE_BUYER, scope.signal)).resolves.toBe(0);

      expect(deletes()).toHaveLength(1);
      expect(homeserver.files.has(url)).toBe(true);
      expect(await jobs()).toEqual([before]);
    });

    it('a retry whose scope already ended sends nothing', async () => {
      homeserver.failNext(HttpMethod.DELETE, url, 500);
      await CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id);
      const getOrder = vi.spyOn(MarketplaceGatewayService, 'getOrder');
      getOrder.mockClear();
      const scope = new AbortController();
      scope.abort(new DOMException('Signed out', 'AbortError'));

      await expect(CommerceApplication.resumeOwnReviewRemovals(ORDER_FIXTURE_BUYER, scope.signal)).resolves.toBe(0);

      expect(getOrder).not.toHaveBeenCalled();
      expect(deletes()).toHaveLength(1);
    });

    it('keeps the job when reconciliation cannot read the public file', async () => {
      homeserver.failNext(HttpMethod.DELETE, url, 500);
      homeserver.failNext(HttpMethod.GET, url, 500);
      await CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id);

      await expect(CommerceApplication.resumeOwnReviewRemovals(ORDER_FIXTURE_BUYER)).resolves.toBe(0);

      const [queued] = await jobs();
      expect(queued.attempts).toBe(1);
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

  describe('removing a review also withdraws it at the service', () => {
    const withdraws = () => service.log.filter((entry) => entry === 'review.withdraw');

    it('records the withdrawal before the homeserver DEL', async () => {
      let withdrawnAtDelete: boolean | null = null;
      homeserver.onRequest = ({ entry, phase }) => {
        if (phase === 'before' && entry === `${HttpMethod.DELETE} ${url}`) withdrawnAtDelete = service.withdrawn();
      };

      await expect(CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id)).resolves.toBe('removed');

      expect(withdrawnAtDelete).toBe(true);
      expect(service.withdrawn()).toBe(true);
      expect(await jobs()).toEqual([]);
    });

    it('retries a failed service withdrawal without issuing a delayed homeserver deletion', async () => {
      service.failNext('review.withdraw');

      await expect(CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id)).resolves.toBe('queued');

      expect(deletes()).toEqual([]);
      expect(homeserver.files.has(url)).toBe(true);
      expect(service.withdrawn()).toBe(false);
      const [queued] = await jobs();
      expect(await jobs()).toHaveLength(1);
      expect(queued.attempts).toBe(1);

      await expect(CommerceApplication.resumeOwnReviewRemovals(ORDER_FIXTURE_BUYER)).resolves.toBe(0);

      expect(service.withdrawn()).toBe(true);
      expect(deletes()).toEqual([]);
      expect(homeserver.files.has(url)).toBe(true);
      expect(await jobs()).toHaveLength(1);
    });

    it('a retry whose scope ends while it reads the order sends no withdrawal and no DEL', async () => {
      service.failNext('review.withdraw');
      await expect(CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id)).resolves.toBe('queued');
      const [before] = await jobs();
      const scope = new AbortController();
      const parked = service.holdNext('getOrder', { afterAnswer: true });

      const retry = CommerceApplication.resumeOwnReviewRemovals(ORDER_FIXTURE_BUYER, scope.signal);
      await parked.reached;
      scope.abort(new DOMException('Signed out', 'AbortError'));
      parked.release();

      await expect(retry).resolves.toBe(0);
      expect(withdraws()).toHaveLength(1);
      expect(service.withdrawn()).toBe(false);
      expect(deletes()).toEqual([]);
      expect(await jobs()).toEqual([before]);
    });

    it('keeps the job when the order cannot be read, and sends no DEL', async () => {
      service.failNext('getOrder');

      await expect(CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id)).resolves.toBe('queued');

      expect(deletes()).toEqual([]);
      expect(await jobs()).toHaveLength(1);
    });

    it('keeps the outstanding file without sending the withdrawal again', async () => {
      homeserver.failNext(HttpMethod.DELETE, url, 500);

      await expect(CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id)).resolves.toBe('queued');

      expect(service.withdrawn()).toBe(true);
      expect(await jobs()).toHaveLength(1);

      await expect(CommerceApplication.resumeOwnReviewRemovals(ORDER_FIXTURE_BUYER)).resolves.toBe(0);

      expect(withdraws()).toHaveLength(1);
      expect(deletes()).toHaveLength(1);
      expect(homeserver.files.has(url)).toBe(true);
      expect(await jobs()).toHaveLength(1);
    });

    it('re-reads the order and tries again when its revision moved under the withdrawal', async () => {
      const parked = service.holdNext('getOrder', { afterAnswer: true });
      const removal = CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id);
      await parked.reached;
      service.touch();
      parked.release();

      await expect(removal).resolves.toBe('removed');

      expect(withdraws()).toHaveLength(2);
      expect(service.withdrawn()).toBe(true);
    });

    it('lets the DEL through when the service holds no review of the user to withdraw', async () => {
      const bare = { ...order, reviews: [] };
      vi.mocked(MarketplaceGatewayService.getOrder).mockResolvedValue(bare);

      await expect(CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id)).resolves.toBe('removed');

      expect(withdraws()).toEqual([]);
      expect(deletes()).toHaveLength(1);
    });

    describe('through the real homeserver transport', () => {
      const sdkDelete = vi.fn();

      /** Sends DELs through `HomeserverService.request` and its retry policy to a signed-in SDK session. */
      const useRealTransport = () => {
        vi.mocked(HomeserverService.request).mockRestore();
        sdkDelete.mockReset();
        useAuthStore.setState({
          session: asOpaque<Session>({
            info: { publicKey: { z32: () => ORDER_FIXTURE_BUYER } },
            storage: { delete: (...args: unknown[]) => sdkDelete(...args) },
          }),
          isLoggingOut: false,
        });
        installHomeserverWriteRetryDependenciesForTests({ sleep: async () => {}, random: () => 0, now: () => 0 });
      };

      afterEach(() => {
        installHomeserverWriteRetryDependenciesForTests(null);
        useAuthStore.setState({ session: null });
      });

      it('sends a single DELETE for an explicit removal and never repeats it on the SDK after a transient failure', async () => {
        useRealTransport();
        sdkDelete.mockRejectedValueOnce(sdkRequestError(503));
        await expect(CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id)).resolves.toBe('queued');
        await expect(
          CommerceApplication.resumeOwnReviewRemovals(ORDER_FIXTURE_BUYER, new AbortController().signal),
        ).resolves.toBe(0);
        expect(sdkDelete).toHaveBeenCalledTimes(1);
        expect(await jobs()).toHaveLength(1);
      });
    });
  });

  describe('a removed review stays removed on every device', () => {
    const puts = () => homeserver.log.filter((entry) => entry === `${HttpMethod.PUT} ${url}`);

    /** A fresh sign-in on another device: nothing local, no session memory; the homeserver and the service are shared. */
    const switchDevice = async () => {
      await db.table(CommerceReviewModel.table.name).clear();
      await CommerceSyncJobModel.table.clear();
      CommerceApplication.resetOwnReviewHydrateMemo();
      homeserver.log.length = 0;
      service.log.length = 0;
    };

    /** This order's record is gone from every path the hydrate reads: another order's review overwrote it. */
    const overwrite = async () => {
      homeserver.files.delete(url);
      await switchDevice();
    };

    describe('removed on device 1', () => {
      beforeEach(async () => {
        await expect(CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id)).resolves.toBe('removed');
        await switchDevice();
      });

      it('does not republish or show it when device 2 opens the order, and the homeserver stays empty', async () => {
        await expect(
          CommerceApplication.getOwnMarketplaceReview(ORDER_FIXTURE_BUYER, service.order()),
        ).resolves.toBeNull();

        expect(puts()).toEqual([]);
        expect(homeserver.files.size).toBe(0);
        expect(await localRow()).toBeUndefined();
        expect(await jobs()).toEqual([]);
      });

      it('still does not republish from an order read made before the removal', async () => {
        await expect(CommerceApplication.getOwnMarketplaceReview(ORDER_FIXTURE_BUYER, order)).resolves.toBeNull();

        expect(puts()).toEqual([]);
        expect(homeserver.files.size).toBe(0);
        expect(await localRow()).toBeUndefined();
        expect(await jobs()).toEqual([]);
      });

      it('republishes when device 2 edits the review', async () => {
        service.reinstate();

        const edited = await publishAgain();

        expect(edited).toMatchObject({ sync_status: 'synced', review_id: published.review_id });
        expect(puts()).toHaveLength(1);
        expect(homeserver.files.has(url)).toBe(true);
      });

      it('repairs again after the edit once another order overwrote the record', async () => {
        service.reinstate();
        await publishAgain();
        await overwrite();

        const restored = await CommerceApplication.getOwnMarketplaceReview(ORDER_FIXTURE_BUYER, service.order());

        expect(restored?.review_id).toBe(published.review_id);
        expect(puts()).toHaveLength(1);
      });
    });

    it('does not show a record the homeserver still serves once the service says it was removed', async () => {
      service.withdraw();
      await switchDevice();

      await expect(
        CommerceApplication.getOwnMarketplaceReview(ORDER_FIXTURE_BUYER, service.order()),
      ).resolves.toBeNull();

      expect(await localRow()).toBeUndefined();
      expect(puts()).toEqual([]);
    });

    it('clears the copy a second device still holds when the page refreshes after the removal', async () => {
      service.withdraw();
      homeserver.files.delete(url);

      await expect(CommerceApplication.refreshOwnReviews(ORDER_FIXTURE_BUYER, [service.order()])).resolves.toBe(1);

      expect(await localRow()).toBeUndefined();
    });

    it('keeps the local copy when the order data predates an edit that cleared the removal', async () => {
      const [own] = order.reviews ?? [];
      const stale = { ...order, reviews: [{ ...own, publicRemoved: true }] };

      await expect(CommerceApplication.refreshOwnReviews(ORDER_FIXTURE_BUYER, [stale])).resolves.toBe(0);

      expect(await localRow()).toBeDefined();
    });

    describe('the repair of a review a later order overwrote', () => {
      it('still republishes a review the service holds when no record carries it', async () => {
        await overwrite();

        const restored = await CommerceApplication.getOwnMarketplaceReview(ORDER_FIXTURE_BUYER, order);

        expect(restored?.review_id).toBe(published.review_id);
        expect(restored?.sync_status).toBe('synced');
        expect(puts()).toHaveLength(1);
        expect(await jobs()).toEqual([]);
      });

      it('publishes nothing when the order data already says the review was removed', async () => {
        service.withdraw();
        await overwrite();
        const [own] = order.reviews ?? [];

        await expect(
          CommerceApplication.getOwnMarketplaceReview(ORDER_FIXTURE_BUYER, {
            ...order,
            reviews: [{ ...own, publicRemoved: true }],
          }),
        ).resolves.toBeNull();

        expect(puts()).toEqual([]);
      });

      it('does not bring back a review whose removal is still owed on this device', async () => {
        service.failNext('review.withdraw');
        await expect(CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id)).resolves.toBe('queued');
        CommerceApplication.resetOwnReviewHydrateMemo();
        homeserver.log.length = 0;

        await expect(CommerceApplication.getOwnMarketplaceReview(ORDER_FIXTURE_BUYER, order)).resolves.toBeNull();

        expect(puts()).toEqual([]);
        expect(await jobs()).toHaveLength(1);
      });

      it('publishes nothing when the removal lands after the repair read the order and before it writes', async () => {
        await overwrite();
        const parked = service.holdNext('getOrder');
        const repair = CommerceApplication.getOwnMarketplaceReview(ORDER_FIXTURE_BUYER, order);
        await parked.reached;
        service.withdraw();
        parked.release();

        await expect(repair).resolves.toBeNull();

        expect(puts()).toEqual([]);
        expect(homeserver.files.size).toBe(0);
        expect(await localRow()).toBeUndefined();
        expect(await jobs()).toEqual([]);
      });

      it('abandons the local publication when the withdrawal landed after the check and the DEL has not run yet', async () => {
        await overwrite();
        const parked = homeserver.holdNext(HttpMethod.PUT, url);
        const repair = CommerceApplication.getOwnMarketplaceReview(ORDER_FIXTURE_BUYER, order);
        await parked.reached;
        service.withdraw();
        parked.release();

        await expect(repair).resolves.toBeNull();
        homeserver.files.delete(url);

        expect(puts()).toHaveLength(1);
        expect(deletes()).toEqual([]);
        expect(homeserver.files.size).toBe(0);
        expect(await localRow()).toBeUndefined();
        expect(await jobs()).toEqual([]);
      });

      it('retains a raced public file for inspection after the whole removal finished before the PUT landed', async () => {
        await overwrite();
        const parked = homeserver.holdNext(HttpMethod.PUT, url);
        const repair = CommerceApplication.getOwnMarketplaceReview(ORDER_FIXTURE_BUYER, order);
        await parked.reached;
        service.withdraw();
        homeserver.files.delete(url);
        parked.release();

        await expect(repair).resolves.toBeNull();

        expect(deletes()).toEqual([]);
        expect(homeserver.files.size).toBe(1);
        expect(await localRow()).toBeUndefined();
        expect(await jobs()).toEqual([]);
      });

      it('keeps its PUT when no withdrawal arrived', async () => {
        await overwrite();

        await CommerceApplication.getOwnMarketplaceReview(ORDER_FIXTURE_BUYER, order);

        expect(deletes()).toEqual([]);
        expect(homeserver.files.has(url)).toBe(true);
      });

      it('publishes nothing when the service cannot be asked, and repairs on the next visit', async () => {
        await overwrite();
        service.failNext('getOrder');

        await expect(CommerceApplication.getOwnMarketplaceReview(ORDER_FIXTURE_BUYER, order)).resolves.toBeNull();

        expect(puts()).toEqual([]);
        expect(await localRow()).toBeUndefined();
        expect(await jobs()).toEqual([]);

        const restored = await CommerceApplication.getOwnMarketplaceReview(ORDER_FIXTURE_BUYER, order);
        expect(restored?.review_id).toBe(published.review_id);
        expect(puts()).toHaveLength(1);
      });

      it('clears the local pending row after the withdrawal without deleting the public file', async () => {
        await overwrite();
        homeserver.onRequest = ({ entry, phase }) => {
          if (phase === 'after' && entry === `${HttpMethod.PUT} ${url}`) service.failNext('getOrder');
        };

        const pending = await CommerceApplication.getOwnMarketplaceReview(ORDER_FIXTURE_BUYER, order);

        expect(pending?.sync_status).toBe('pending');
        expect(await jobs()).toHaveLength(1);
        service.withdraw();

        await expect(CommerceApplication.resumeOwnReviewPublications(ORDER_FIXTURE_BUYER)).resolves.toBe(0);

        expect(deletes()).toEqual([]);
        expect(homeserver.files.size).toBe(1);
        expect(await localRow()).toBeUndefined();
        expect(await jobs()).toEqual([]);
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
  });

  describe('an interrupted review removal', () => {
    const scope = () => new AbortController().signal;
    const inspect = () => CommerceApplication.fetchReviewRemovalCopy(ORDER_FIXTURE_BUYER, order.id, 'boots', scope());
    const resume = () => CommerceApplication.resumeOwnReviewRemovals(ORDER_FIXTURE_BUYER, scope());

    async function moveToLegacyPath() {
      const { orderRef: _orderRef, ...record } = published.record;
      const { buildReview } = await import('pubky-market-specs');
      const legacy = buildReview(ORDER_FIXTURE_BUYER, { ...record, reviewId: '' });
      const model = {
        ...published,
        id: `${ORDER_FIXTURE_BUYER}:${legacy.meta.id}`,
        review_id: legacy.meta.id,
        record: CommerceRecordNormalizer.review(legacy.review.toJson()),
      };
      await CommerceReviewModel.table.clear();
      await LocalCommerceService.upsertOwnReview(model);
      homeserver.files.clear();
      url = CommerceRecordNormalizer.reviewUri(ORDER_FIXTURE_BUYER, model.review_id);
      homeserver.files.set(url, model.record);
      return model;
    }

    it.each([clearDatabase, clearPrivateData])(
      'retains the original owner job through %p and settles it after manual removal',
      async (clear) => {
        homeserver.failNext(HttpMethod.DELETE, url, 500);
        await expect(CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id)).resolves.toBe('queued');
        const [before] = await jobs();
        await clear();
        CommerceApplication.resetOwnReviewHydrateMemo();
        const [after] = await jobs();
        expect(after).toMatchObject({
          id: before.id,
          owner_id: ORDER_FIXTURE_BUYER,
          payload: { orderId: order.id, url },
        });
        useAuthStore.getState().setCurrentUserPubky(order.sellerPubky);
        await expect(CommerceApplication.getManualReviewRemovals(order.sellerPubky, order.id)).resolves.toEqual([]);
        await expect(CommerceApplication.resumeOwnReviewRemovals(order.sellerPubky, scope())).resolves.toBe(0);
        useAuthStore.getState().setCurrentUserPubky(ORDER_FIXTURE_BUYER);
        await expect(inspect()).resolves.toMatchObject({
          kind: 'checked',
          withdrawn: true,
          copy: { uri: url, text: published.record.text },
        });
        await expect(resume()).resolves.toBe(0);
        expect(deletes()).toHaveLength(1);
        homeserver.files.delete(url);
        await expect(resume()).resolves.toBe(1);
        expect(await jobs()).toEqual([]);
      },
    );

    it('never deletes the next order at a shared legacy URL, including after the last homeserver read', async () => {
      const original = await moveToLegacyPath();
      homeserver.failNext(HttpMethod.DELETE, url, 500);
      await CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id);
      await clearDatabase();
      const replacement = {
        ...original.record,
        eligibilityAttestation: issuedAttestation('boots', 'ef'.repeat(32)).jws,
        text: 'Another order',
      };
      const parked = parkAfterRead();
      const retry = resume();
      await parked.reached;
      homeserver.files.set(url, replacement);
      parked.release();
      await expect(retry).resolves.toBe(0);
      await expect(resume()).resolves.toBe(1);
      expect(deletes()).toEqual([]);
      expect(homeserver.files.get(url)).toEqual(replacement);
      await expect(inspect()).resolves.toMatchObject({ kind: 'checked', copy: null });
    });

    it('preserves a new public version with the same purchase attestation even when the service still reports the original terms', async () => {
      homeserver.failNext(HttpMethod.DELETE, url, 500);
      await CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id);
      const edit = otherDeviceEdit(2, 'Edited directly on my homeserver');
      homeserver.files.set(url, edit);
      await expect(inspect()).resolves.toEqual({ kind: 'changed' });
      await expect(resume()).resolves.toBe(1);
      expect(await jobs()).toEqual([]);
      await expect(inspect()).resolves.toEqual({ kind: 'changed' });
      expect(deletes()).toHaveLength(1);
      expect(homeserver.files.get(url)).toEqual(edit);
    });

    it('does not re-withdraw an edit that superseded an owed removal before the owner returned', async () => {
      service.failNext('getOrder');
      await CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id);
      await clearDatabase();
      const edited = otherDeviceEdit(2, 'Newer publication.');
      homeserver.files.set(url, edited);
      const fresh = { ...order, reviews: [{ ...order.reviews![0], updatedAt: edited.updatedAt }] };
      vi.spyOn(MarketplaceGatewayService, 'getOrder').mockResolvedValue(fresh);
      await expect(resume()).resolves.toBe(1);
      expect(await jobs()).toEqual([]);
      expect(service.withdrawals).toEqual([]);
      expect(deletes()).toEqual([]);
      expect(homeserver.files.get(url)).toEqual(edited);
    });

    it('keeps the service withdrawal owed before a switch and sends it with the unchanged review version', async () => {
      service.failNext('getOrder');
      await CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id);
      await clearDatabase();
      await expect(resume()).resolves.toBe(0);
      expect(service.withdrawn()).toBe(true);
      expect(deletes()).toEqual([]);
      await expect(inspect()).resolves.toMatchObject({ kind: 'checked', withdrawn: true, copy: { uri: url } });
    });

    it('preserves a pre-item job until the author confirms the service version and removes the file', async () => {
      service.failNext('getOrder');
      await CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id);
      const [job] = await jobs();
      await CommerceSyncJobModel.table.update(job.id, { payload: { orderId: order.id, url } });
      await clearDatabase();
      await expect(resume()).resolves.toBe(0);
      expect(service.withdrawn()).toBe(false);
      await expect(CommerceApplication.getManualReviewRemovals(ORDER_FIXTURE_BUYER, order.id)).resolves.toEqual([null]);
      await expect(
        CommerceApplication.confirmReviewWithdrawal(
          ORDER_FIXTURE_BUYER,
          order.id,
          'boots',
          published.record.updatedAt,
          scope(),
        ),
      ).resolves.toBe(true);
      expect(service.withdrawn()).toBe(true);
      expect(deletes()).toEqual([]);
      homeserver.files.delete(url);
      await expect(resume()).resolves.toBe(1);
    });

    it.each(['order list', 'single order'])(
      'preserves a concurrently accepted edit when a fast device opens the %s after its job was lost',
      async (entry) => {
        service.withdraw();
        await CommerceReviewModel.table.clear();
        vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2099-01-01T00:00Z'));
        vi.spyOn(MarketplaceGatewayService, 'getReviewAttestations').mockResolvedValue([
          { listingId: 'boots', ...wire },
        ]);
        const gate = service.holdNext('getOrder', { afterAnswer: true });
        const read =
          entry === 'order list'
            ? CommerceApplication.getOwnMarketplaceOrderReviews(ORDER_FIXTURE_BUYER, service.order(), scope())
            : CommerceApplication.getOwnMarketplaceReview(ORDER_FIXTURE_BUYER, service.order(), scope());
        await gate.reached;
        service.reinstate();
        const edit = otherDeviceEdit(2, 'Another device edited the review.');
        homeserver.files.set(url, edit);
        gate.release();
        await read;
        expect(deletes()).toEqual([]);
        expect(homeserver.files.get(url)).toEqual(edit);
        expect(await jobs()).toEqual([]);
      },
    );

    it('lets the owner inspect a still-public legacy withdrawal with no original job, without staging a deletion', async () => {
      const legacy = await moveToLegacyPath();
      service.withdraw();
      await CommerceReviewModel.table.clear();
      await expect(
        CommerceApplication.getOwnMarketplaceReview(ORDER_FIXTURE_BUYER, service.order(), scope()),
      ).resolves.toBeNull();
      await expect(inspect()).resolves.toMatchObject({
        kind: 'checked',
        withdrawn: true,
        copy: { uri: url, text: legacy.record.text, attestation: legacy.record.eligibilityAttestation },
      });
      expect(await jobs()).toEqual([]);
      expect(deletes()).toEqual([]);
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

    it('two tabs settle a manually removed file only once', async () => {
      homeserver.failNext(HttpMethod.DELETE, url, 500);
      await CommerceApplication.commitDeleteOwnReview(ORDER_FIXTURE_BUYER, order.id);
      expect(deletes()).toHaveLength(1);

      homeserver.files.delete(url);
      const results = await Promise.all([
        CommerceApplication.resumeOwnReviewRemovals(ORDER_FIXTURE_BUYER),
        CommerceApplication.resumeOwnReviewRemovals(ORDER_FIXTURE_BUYER),
      ]);

      expect(results.reduce((sum, count) => sum + count, 0)).toBe(1);
      expect(deletes()).toHaveLength(1);
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
