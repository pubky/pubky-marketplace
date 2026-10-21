import { vi } from 'vitest';
import { MarketplaceGatewayService, type MarketplaceOrder } from '@/services/marketplace/marketplace';

type ServiceCall = 'getOrder' | 'review.withdraw';

export type FakeMarketplaceService = {
  /** Every call in order: `getOrder` or the command kind. */
  log: string[];
  /** The order as the service serves it to the review's author right now. */
  order: () => MarketplaceOrder;
  /** Whether the service holds the author's review as withdrawn. */
  withdrawn: () => boolean;
  /**
   * What another device's `review.withdraw` does, acting on the service
   * state directly (no call through this process's gateway).
   */
  withdraw: () => void;
  /** Another party changes the order, so the revision moves on. */
  touch: () => void;
  /** What `review.update` does to the withdrawal flag: clears it. */
  reinstate: () => void;
  /** Makes the next `getOrder` or `review.withdraw` fail with a transport error. */
  failNext: (call: ServiceCall) => void;
  /**
   * Parks the next matching call, by default before it takes effect; with
   * `afterAnswer` the call is answered first and its answer parked, so the
   * answer is stale by the time the caller gets it. `reached` resolves when
   * it arrives; `release` lets it proceed.
   */
  holdNext: (call: ServiceCall, options?: { afterAnswer?: boolean }) => { reached: Promise<void>; release: () => void };
};

/**
 * An in-memory transaction service for the author's own review of one order,
 * following the `review.withdraw` API: the command carries the order's
 * revision (a stale one answers `REVISION_CONFLICT`), is idempotent, bumps
 * the revision when it changes anything, and answers `INVALID_STATE` when the
 * caller has no review. The author's view carries `publicRemoved: true` only
 * while the review is withdrawn. Reads and commands go through
 * `MarketplaceGatewayService`.
 */
export function installFakeMarketplaceService(initial: MarketplaceOrder, authorPubky: string): FakeMarketplaceService {
  let revision = initial.revision;
  let removed = false;
  const log: string[] = [];
  const failures: ServiceCall[] = [];
  const holds: { call: ServiceCall; afterAnswer: boolean; arrive: () => void; proceed: Promise<void> }[] = [];

  const park = async (call: ServiceCall, afterAnswer: boolean) => {
    const hold = holds.findIndex((entry) => entry.call === call && entry.afterAnswer === afterAnswer);
    if (hold < 0) return;
    const [{ arrive, proceed }] = holds.splice(hold, 1);
    arrive();
    await proceed;
  };

  const settle = async (call: ServiceCall) => {
    log.push(call);
    const failure = failures.indexOf(call);
    if (failure >= 0) {
      failures.splice(failure, 1);
      throw new Error(`fake service: ${call} unavailable`);
    }
    await park(call, false);
  };

  const view = (): MarketplaceOrder => ({
    ...initial,
    revision,
    reviews: (initial.reviews ?? []).map((review) =>
      review.reviewerPubky === authorPubky && removed ? { ...review, publicRemoved: true } : { ...review },
    ),
  });
  const hasReview = () => (initial.reviews ?? []).some((review) => review.reviewerPubky === authorPubky);

  const withdraw = () => {
    if (removed) return;
    removed = true;
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
    await settle('review.withdraw');
    if (command.expectedRevision !== revision) {
      return {
        ok: false,
        error: { code: 'REVISION_CONFLICT', message: 'The order revision is stale.', currentRevision: revision },
      };
    }
    if (!hasReview()) {
      return { ok: false, error: { code: 'INVALID_STATE', message: 'There is no review to withdraw.' } };
    }
    withdraw();
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
    order: view,
    withdrawn: () => removed,
    touch: () => {
      revision += 1;
    },
    withdraw,
    reinstate: () => {
      if (!removed) return;
      removed = false;
      revision += 1;
    },
    failNext: (call) => failures.push(call),
    holdNext: (call, options) => {
      let arrive = () => {};
      let release = () => {};
      const reached = new Promise<void>((resolve) => (arrive = resolve));
      const proceed = new Promise<void>((resolve) => (release = resolve));
      holds.push({ call, afterAnswer: options?.afterAnswer === true, arrive, proceed });
      return { reached, release };
    },
  };
}
