import { vi } from 'vitest';
import { MarketplaceGatewayService, type MarketplaceOrder } from '@/services/marketplace/marketplace';

type ServiceCall = 'getOrder' | 'review.withdraw';

type CallOptions = {
  /**
   * Narrows a `review.withdraw` to the one that names this listing (the
   * seller's record id, as the command carries it).
   */
  listingId?: string;
};

export type FakeMarketplaceService = {
  /** Every call in order: `getOrder` or the command kind. */
  log: string[];
  /** The listing each `review.withdraw` named, in order; `undefined` when it covered the order. */
  withdrawals: (string | undefined)[];
  /** The order as the service serves it to the review's author right now. */
  order: () => MarketplaceOrder;
  /**
   * Whether the service holds the author's review as withdrawn: that
   * listing's review when named, else every review of the author's.
   */
  withdrawn: (listingId?: string) => boolean;
  /**
   * What another device's `review.withdraw` does, acting on the service
   * state directly (no call through this process's gateway): one listing's
   * review, or all of the author's.
   */
  withdraw: (listingId?: string) => void;
  /** Another party changes the order, so the revision moves on. */
  touch: () => void;
  /** What `review.update` does to the withdrawal flag: clears it, for one listing or all. */
  reinstate: (listingId?: string) => void;
  /** Makes the next `getOrder` or `review.withdraw` fail with a transport error. */
  failNext: (call: ServiceCall, options?: CallOptions) => void;
  /**
   * Parks the next matching call, by default before it takes effect; with
   * `afterAnswer` the call is answered first and its answer parked, so the
   * answer is stale by the time the caller gets it. `reached` resolves when
   * it arrives; `release` lets it proceed.
   */
  holdNext: (
    call: ServiceCall,
    options?: CallOptions & { afterAnswer?: boolean },
  ) => { reached: Promise<void>; release: () => void };
};

/**
 * An in-memory transaction service for the author's own reviews of one
 * order, following the `review.withdraw` API: the command carries the
 * order's revision (a stale one answers `REVISION_CONFLICT`), is idempotent,
 * bumps the revision when it changes anything, and answers `INVALID_STATE`
 * when the caller has no review (of the named listing). With `listing_id` it
 * withdraws that item's review only; without, all of the author's reviews of
 * the order. The author's view carries `publicRemoved: true` on a review only
 * while it is withdrawn. Reads and commands go through
 * `MarketplaceGatewayService`.
 */
export function installFakeMarketplaceService(initial: MarketplaceOrder, authorPubky: string): FakeMarketplaceService {
  let revision = initial.revision;
  const removed = new Set<number>();
  const log: string[] = [];
  const withdrawals: (string | undefined)[] = [];
  const failures: { call: ServiceCall; listingId?: string }[] = [];
  const holds: {
    call: ServiceCall;
    afterAnswer: boolean;
    listingId?: string;
    arrive: () => void;
    proceed: Promise<void>;
  }[] = [];

  const authored = () =>
    (initial.reviews ?? []).flatMap((review, index) => (review.reviewerPubky === authorPubky ? [{ review, index }] : []));
  const listingOf = (review: { listingAggregateId?: string }) =>
    review.listingAggregateId?.slice(`listing:${initial.sellerPubky}_`.length);
  const targets = (listingId?: string) =>
    authored().filter(({ review }) => listingId === undefined || listingOf(review) === listingId);

  const park = async (call: ServiceCall, afterAnswer: boolean, listingId?: string) => {
    const hold = holds.findIndex(
      (entry) =>
        entry.call === call &&
        entry.afterAnswer === afterAnswer &&
        (entry.listingId === undefined || entry.listingId === listingId),
    );
    if (hold < 0) return;
    const [{ arrive, proceed }] = holds.splice(hold, 1);
    arrive();
    await proceed;
  };

  const settle = async (call: ServiceCall, listingId?: string) => {
    log.push(call);
    const failure = failures.findIndex(
      (entry) => entry.call === call && (entry.listingId === undefined || entry.listingId === listingId),
    );
    if (failure >= 0) {
      failures.splice(failure, 1);
      throw new Error(`fake service: ${call} unavailable`);
    }
    await park(call, false, listingId);
  };

  const view = (): MarketplaceOrder => ({
    ...initial,
    revision,
    reviews: (initial.reviews ?? []).map((review, index) =>
      review.reviewerPubky === authorPubky && removed.has(index) ? { ...review, publicRemoved: true } : { ...review },
    ),
  });

  const withdraw = (listingId?: string) => {
    const fresh = targets(listingId).filter(({ index }) => !removed.has(index));
    if (fresh.length === 0) return;
    for (const { index } of fresh) removed.add(index);
    revision += 1;
  };

  vi.spyOn(MarketplaceGatewayService, 'getOrder').mockImplementation(async (actor, orderId) => {
    await settle('getOrder');
    const answer = actor === authorPubky && orderId === initial.id ? view() : null;
    await park('getOrder', true);
    return answer;
  });

  vi.spyOn(MarketplaceGatewayService, 'execute').mockImplementation(async (_actor, command) => {
    if (command.kind !== 'review.withdraw') throw new Error(`fake service: unexpected command ${command.kind}`);
    const { listingId } = command.payload;
    withdrawals.push(listingId);
    await settle('review.withdraw', listingId);
    if (command.expectedRevision !== revision) {
      return {
        ok: false,
        error: { code: 'REVISION_CONFLICT', message: 'The order revision is stale.', currentRevision: revision },
      };
    }
    if (targets(listingId).length === 0) {
      return { ok: false, error: { code: 'INVALID_STATE', message: 'There is no review to withdraw.' } };
    }
    withdraw(listingId);
    return {
      ok: true,
      version: 1,
      commandId: command.commandId,
      aggregateId: command.aggregateId,
      revision,
      eventIds: [],
      result: { kind: 'order', order: view() },
    };
  });

  return {
    log,
    withdrawals,
    order: view,
    withdrawn: (listingId) => {
      const covered = targets(listingId);
      return covered.length > 0 && covered.every(({ index }) => removed.has(index));
    },
    touch: () => {
      revision += 1;
    },
    withdraw,
    reinstate: (listingId) => {
      const flagged = targets(listingId).filter(({ index }) => removed.has(index));
      if (flagged.length === 0) return;
      for (const { index } of flagged) removed.delete(index);
      revision += 1;
    },
    failNext: (call, options) => failures.push({ call, listingId: options?.listingId }),
    holdNext: (call, options) => {
      let arrive = () => {};
      let release = () => {};
      const reached = new Promise<void>((resolve) => (arrive = resolve));
      const proceed = new Promise<void>((resolve) => (release = resolve));
      holds.push({ call, afterAnswer: options?.afterAnswer === true, listingId: options?.listingId, arrive, proceed });
      return { reached, release };
    },
  };
}
