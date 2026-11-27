'use client';

import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { type CommerceAdapterMode, getCommerceAdapterMode, isTransactionalCommerceMode } from '@/config/commerce';
import { REVIEW_PENDING_COPY } from '@/config/commerce-copy';
import { captureAuthScope } from '@/controllers/auth/auth-scope';
import { CommerceController } from '@/controllers/commerce/commerce';
import { readReviewResultPending } from '@/libs/commerce/attestation';
import {
  MARKETPLACE_FAILURE_MESSAGES,
  marketplaceErrorCode,
  marketplaceFailureMessage,
} from '@/libs/commerce/failure-messages';
import {
  LOCKS_CANCEL_PAUSED_IN_PROGRESS_COPY,
  LOCKS_TASK_LIVE_REFUSAL_REASON,
} from '@/libs/commerce/locks-cancel-paused';
import { orderShowsCommandResult } from '@/libs/commerce/order-command-result';
import { formatReviewDate, isReviewWindowClosedRefusal } from '@/libs/commerce/order-reviews';
import { plainRefundRefusal } from '@/libs/commerce/partial-refund';
import { CHECKOUT_CANCEL_PAYMENT_SEEN_COPY } from '@/libs/commerce/paykit-rail';
import { pickupRefusalFailureMessage } from '@/libs/commerce/pickup';
import {
  classifyCommercePollError,
  type CommercePollOutcome,
  getAdaptiveOrderPollIntervalMs,
  startCommercePoller,
} from '@/libs/commerce/polling';
import { orderChangedMessage } from '@/libs/commerce/refund-copy';
import {
  buildMarketplaceOrderAggregateId,
  buildMarketplacePaymentAggregateId,
  classifyMarketplacePickupCommandRefusal,
  isMarketplaceRevisionConflict,
} from '@/libs/commerce/transaction-commands';
import { PAYMENT_NOT_FINAL_COPY } from '@/libs/commerce/usdt-buyer-status';
import { CONFIRM_REFUND_DESTINATION_KIND, usdtRefundRefusalMessage } from '@/libs/commerce/usdt-refund';
import { isPaymentNotFinalRefusal } from '@/libs/commerce/usdt-settlement-contract';
import { isMarketplaceCommandValidationError, isMarketplaceSessionRequiredError } from '@/libs/error/error.utils';
import { toast } from '@/molecules/Toaster/toast';
import type {
  MarketplaceOrder,
  MarketplaceOrderParseError,
  MarketplacePayment,
  MarketplaceReceipt,
} from '@/services/marketplace/marketplace';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useCommerceStore } from '@/stores/commerce/commerce.store';
import type { CommerceMarketplaceSession } from '@/stores/commerce/commerce.types';
import { ORDER_COMMAND_UNSENDABLE_COPY } from '../useMarketplaceOrderAction/useMarketplaceOrderAction.types';

export interface MarketplaceOrderView {
  order: MarketplaceOrder;
  payment: MarketplacePayment | null;
  receipt: MarketplaceReceipt | null;
}

interface OrderReadScope {
  currentUserPubky: string | null;
  marketplaceSession: CommerceMarketplaceSession | null;
  adapterMode: CommerceAdapterMode;
  auth: AbortSignal;
  receiptCache: Map<string, { receiptId: string; receipt: MarketplaceReceipt }>;
  hasActiveCheckout: boolean;
}

function createOrderReadScope(
  currentUserPubky: string | null,
  marketplaceSession: CommerceMarketplaceSession | null,
  adapterMode: CommerceAdapterMode,
): OrderReadScope {
  return {
    currentUserPubky,
    marketplaceSession,
    adapterMode,
    auth: captureAuthScope(),
    receiptCache: new Map(),
    hasActiveCheckout: false,
  };
}

function hasActiveCheckoutOrder(views: MarketplaceOrderView[]): boolean {
  return views.some(
    ({ order, payment }) =>
      order.state === 'pending_payment' || payment?.state === 'awaiting_entitlement' || payment?.state === 'detected',
  );
}

function isCurrentOrderScope(scope: OrderReadScope, active: OrderReadScope | null): boolean {
  return (
    scope === active &&
    !scope.auth.aborted &&
    useCommerceStore.getState().marketplaceSession === scope.marketplaceSession &&
    getCommerceAdapterMode() === scope.adapterMode
  );
}

interface OrderListState {
  orders: MarketplaceOrderView[];
  parseErrors: MarketplaceOrderParseError[];
  needsSession: boolean;
  error: string | null;
}

const EMPTY_ORDER_LIST: OrderListState = { orders: [], parseErrors: [], error: null, needsSession: false };

/**
 * Order timelines against whichever transactional backend the mode selects:
 * the in-memory sandbox or the durable transaction service. Post-purchase
 * commands source `expected_revision` from the freshly-loaded order. A
 * `REVISION_CONFLICT` re-reads the order: when that read already shows the
 * command's result, the action succeeded; otherwise the buyer is asked to
 * retry from the reloaded order.
 *
 * `payment.sandbox_advance` remains SANDBOX-ONLY: the durable service still
 * models payments with its sandbox adapter (no funds move anywhere), and this
 * client refuses to simulate payment progress against the authority — so in
 * `transaction-service` mode a payment can only advance if some other actor
 * (e.g. a test harness) drives it.
 */
export function useMarketplaceOrders() {
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  // Refetch trigger: connecting a session replaces this store object, so the
  // effect below re-runs immediately instead of waiting for the next poll.
  const marketplaceSession = useCommerceStore((state) => state.marketplaceSession);
  const adapterMode = getCommerceAdapterMode();
  const isTransactional = isTransactionalCommerceMode(adapterMode);
  const [scope, setScope] = useState<OrderReadScope>(() =>
    createOrderReadScope(currentUserPubky, marketplaceSession, adapterMode),
  );
  const [list, setList] = useState<OrderListState | null>(null);
  if (
    scope.currentUserPubky !== currentUserPubky ||
    scope.marketplaceSession !== marketplaceSession ||
    scope.adapterMode !== adapterMode
  ) {
    setScope(createOrderReadScope(currentUserPubky, marketplaceSession, adapterMode));
    setList(null);
  }
  const { orders, parseErrors, error, needsSession } = list ?? EMPTY_ORDER_LIST;
  const isLoading = isTransactional && Boolean(currentUserPubky) && list === null;

  // Discard previous participants' data before rendering the new account.
  // A committed scope also fences manual refreshes and reads resolving after unmount.
  const activeScope = useRef<OrderReadScope | null>(null);
  useLayoutEffect(() => {
    activeScope.current = scope;
    return () => {
      activeScope.current = null;
    };
  }, [scope]);

  const readOrders = async () => (await loadOrders(scope, activeScope, setList)).views;
  const refresh = async () => {
    await readOrders();
  };

  useEffect(() => {
    if (!scope.currentUserPubky || !isTransactionalCommerceMode(scope.adapterMode)) return;
    const poller = startCommercePoller({
      poll: async () => (await loadOrders(scope, activeScope, setList)).outcome,
      getIntervalMs: () => getAdaptiveOrderPollIntervalMs(scope.hasActiveCheckout),
    });
    return () => poller.stop();
  }, [scope]);

  const markSessionRequired = () => {
    if (isCurrentOrderScope(scope, activeScope.current)) {
      setList((previous) => ({
        ...(previous ?? EMPTY_ORDER_LIST),
        needsSession: true,
        error: MARKETPLACE_FAILURE_MESSAGES.session,
      }));
    }
  };

  const advancePayment = async (
    payment: MarketplacePayment,
    target: 'detected' | 'confirmed' | 'expired' | 'manual_review',
    confirmations: number,
  ) => {
    // Re-checked at call time: the render-time flag can go stale if the mode changes.
    if (getCommerceAdapterMode() !== 'sandbox') {
      toast({ variant: 'error', description: 'Simulated payments only exist on the sandbox service.' });
      return false;
    }
    try {
      const response = await CommerceController.executeMarketplaceCommand({
        version: 1,
        commandId: crypto.randomUUID(),
        aggregateId: buildMarketplacePaymentAggregateId(payment.id),
        expectedRevision: payment.revision,
        issuedAt: new Date().toISOString(),
        kind: 'payment.sandbox_advance',
        payload: { paymentId: payment.id, target, confirmations },
      });
      if (!response.ok) {
        if (isMarketplaceRevisionConflict(response)) {
          await refresh();
          toast({
            variant: 'error',
            description: MARKETPLACE_FAILURE_MESSAGES.paymentChanged,
          });
          return false;
        }
        toast({
          variant: 'error',
          description: marketplaceFailureMessage(response.error.code, MARKETPLACE_FAILURE_MESSAGES.sandboxPayment),
        });
        return false;
      }
      await refresh();
      return true;
    } catch (actionError) {
      if (isMarketplaceSessionRequiredError(actionError)) {
        // Expiry mid-action must surface the reconnect affordance, not a
        // generic failure: the surface swaps to the session-required card.
        markSessionRequired();
        toast({ variant: 'error', description: MARKETPLACE_FAILURE_MESSAGES.session });
        return false;
      }
      toast({ variant: 'error', description: MARKETPLACE_FAILURE_MESSAGES.sandboxPayment });
      return false;
    }
  };

  const actOnOrder = async (order: MarketplaceOrder, kind: string, payload: Record<string, unknown>) => {
    try {
      const response = await CommerceController.executeMarketplaceCommand({
        version: 1,
        commandId: crypto.randomUUID(),
        aggregateId: buildMarketplaceOrderAggregateId(order.id),
        expectedRevision: order.revision,
        issuedAt: new Date().toISOString(),
        kind,
        payload: { orderId: order.id, ...payload },
      });
      if (!response.ok) {
        if (isMarketplaceRevisionConflict(response)) {
          const fresh = await readOrders();
          const current = fresh?.find((view) => view.order.id === order.id)?.order;
          if (current && orderShowsCommandResult(current, kind, payload)) {
            return true;
          }
          toast({
            variant: 'error',
            description: orderChangedMessage(order, current),
          });
          return false;
        }
        // A second tab that submitted the same listings loses to the first: the
        // service refuses the repeat on the unique key (`INVARIANT_VIOLATION`) or
        // on the already-reviewed check (`INVALID_STATE`). When the order now
        // shows these reviews, the first tab's command did the work, and
        // that tab publishes the records, so this one publishes nothing.
        if (kind === 'review.create' && ['INVARIANT_VIOLATION', 'INVALID_STATE'].includes(response.error.code)) {
          const fresh = await readOrders();
          const current = fresh?.find((view) => view.order.id === order.id)?.order;
          if (current && orderShowsCommandResult(current, kind, payload)) return true;
        }
        if (
          kind === 'order.cancel_request' &&
          response.error.code === 'INVALID_STATE' &&
          response.error.reason === LOCKS_TASK_LIVE_REFUSAL_REASON
        ) {
          toast({ variant: 'error', description: LOCKS_CANCEL_PAUSED_IN_PROGRESS_COPY });
          return false;
        }
        // The service refuses a checkout cancel once it has seen a payment on the
        // request (#347): say so and re-read, so the cancel is no longer offered.
        if (
          kind === 'order.cancel_request' &&
          order.state === 'pending_payment' &&
          response.error.code === 'INVALID_STATE'
        ) {
          const fresh = await readOrders();
          const current = fresh?.find((view) => view.order.id === order.id)?.order;
          if (current?.state === 'cancelled') return true;
          toast({ variant: 'error', description: CHECKOUT_CANCEL_PAYMENT_SEEN_COPY });
          return false;
        }
        // The service's own words: a seller's review after the window is refused, not failed.
        if (kind === 'review.create' && isReviewWindowClosedRefusal(response)) {
          toast({ variant: 'error', description: response.error.message });
          return false;
        }
        if (isPaymentNotFinalRefusal(response)) {
          toast({ variant: 'error', description: PAYMENT_NOT_FINAL_COPY });
          return false;
        }
        const pickupRefusal = classifyMarketplacePickupCommandRefusal(response);
        const isPickupCommand =
          kind === 'fulfillment.mark_ready' ||
          kind === 'fulfillment.confirm_pickup' ||
          kind === 'pickup_details.set' ||
          kind === 'pickup_details.clear' ||
          (kind === 'order.cancel_request' && order.fulfillment === 'pickup');
        const usdtRefusal =
          kind === 'refund.record_external' || kind === CONFIRM_REFUND_DESTINATION_KIND
            ? usdtRefundRefusalMessage(response.error, { seller: kind === 'refund.record_external' })
            : null;
        const refundRefusal =
          usdtRefusal ?? (kind === 'refund.record_external' ? plainRefundRefusal(response.error.message) : null);
        toast({
          variant: 'error',
          description:
            pickupRefusal || isPickupCommand
              ? pickupRefusalFailureMessage(pickupRefusal)
              : (refundRefusal ?? marketplaceFailureMessage(response.error.code, MARKETPLACE_FAILURE_MESSAGES.order)),
        });
        return false;
      }
      if (kind === 'review.create' || kind === 'review.update') {
        await publishReviewRecord(order, response.result, order.buyerPubky === currentUserPubky ? 'buyer' : 'seller');
      }
      await refresh();
      return true;
    } catch (actionError) {
      if (isMarketplaceSessionRequiredError(actionError)) {
        markSessionRequired();
        toast({ variant: 'error', description: MARKETPLACE_FAILURE_MESSAGES.session });
        return false;
      }
      if (isMarketplaceCommandValidationError(actionError)) {
        toast({ variant: 'error', description: ORDER_COMMAND_UNSENDABLE_COPY });
        return false;
      }
      toast({ variant: 'error', description: MARKETPLACE_FAILURE_MESSAGES.order });
      return false;
    }
  };

  return { orders, parseErrors, isLoading, error, needsSession, refresh, advancePayment, actOnOrder, adapterMode };
}

/**
 * Publishes the reviewer-owned public review record (with the embedded
 * purchase attestation) after the service accepted the review. The review
 * itself already succeeded; a publication failure is reported honestly and
 * the staged record retries when the orders surface next loads.
 */
async function publishReviewRecord(
  order: MarketplaceOrder,
  result: unknown,
  reviewerRole: 'buyer' | 'seller',
): Promise<void> {
  const resultRecord = (result ?? {}) as Record<string, unknown>;
  try {
    const published = await CommerceController.publishOwnMarketplaceReviews(order, resultRecord);
    const withheld = readReviewResultPending(resultRecord);
    if (withheld !== null) {
      // A double-blind window holds the review back: it is saved and publishes at release.
      toast({
        description: REVIEW_PENDING_COPY.savedToast(
          reviewerRole,
          withheld.releaseAt === null ? null : formatReviewDate(withheld.releaseAt),
        ),
      });
      return;
    }
    if (published.length === 0) return; // No attestation issued: review stays service-only.
    toast({
      description:
        published.length === 1
          ? 'Review published to your homeserver with its purchase attestation.'
          : `${published.length} reviews published to your homeserver with their purchase attestations.`,
    });
  } catch {
    toast({
      variant: 'error',
      description:
        'Your review was saved, but publishing the public record to your homeserver failed. It will retry when your orders next load.',
    });
  }
}

async function loadOrders(
  scope: OrderReadScope,
  activeScope: RefObject<OrderReadScope | null>,
  setList: Dispatch<SetStateAction<OrderListState | null>>,
): Promise<{ views: MarketplaceOrderView[] | null; outcome: CommercePollOutcome }> {
  const isCurrent = () => isCurrentOrderScope(scope, activeScope.current);
  if (!scope.currentUserPubky || !isTransactionalCommerceMode(scope.adapterMode) || !isCurrent()) {
    return { views: null, outcome: 'stop' };
  }
  // Retryable outbox for own-review records: any publication that failed
  // mid-flight is retried whenever this surface loads. Best-effort — a
  // failure keeps the row pending and is logged inside the application.
  void CommerceController.resumeOwnReviewPublications().catch(() => undefined);
  void CommerceController.resumeOwnReviewRemovals().catch(() => undefined);
  void CommerceController.sweepOwnAuctionReserves().catch(() => undefined);
  // Same outbox semantics for own review-RESPONSE records (subject-only
  // responses published to the responder's homeserver).
  void CommerceController.resumeOwnReviewResponsePublications().catch(() => undefined);
  try {
    const { orders, parseErrors } = await CommerceController.fetchMarketplaceOrderList();
    if (!isCurrent()) return { views: null, outcome: 'stop' };
    const views = await Promise.all(
      orders.map(async (order) => {
        // The durable service embeds the payment projection in the order
        // read; the sandbox serves it from its own endpoint.
        const payment = order.payment ?? (await CommerceController.getMarketplacePayment(order.paymentId));
        let receipt: MarketplaceReceipt | null = null;
        if (order.receiptId && isCurrent()) {
          const cached = scope.receiptCache.get(order.id);
          if (cached && cached.receiptId === order.receiptId) {
            receipt = cached.receipt;
          } else {
            receipt = await CommerceController.getMarketplaceReceipt(order.receiptId);
            if (receipt !== null) {
              scope.receiptCache.set(order.id, { receiptId: order.receiptId, receipt });
            }
          }
        }
        return { order, payment, receipt };
      }),
    );
    if (!isCurrent()) return { views: null, outcome: 'stop' };
    scope.hasActiveCheckout = hasActiveCheckoutOrder(views);
    setList({ orders: views, parseErrors, error: null, needsSession: false });
    // Portable order receipts (credible exit): best-effort publication of
    // any missing signed receipt document to the user's own homeserver.
    // Failures are logged in the application layer and retry on next load.
    void CommerceController.publishOrderReceipts(orders).catch(() => undefined);
    return { views, outcome: 'ok' };
  } catch (loadError) {
    if (!isCurrent()) return { views: null, outcome: 'stop' };
    // Expired sessions offer a reconnect; transport failures retain the last views.
    setList((previous) => ({
      orders: previous?.orders ?? [],
      parseErrors: [],
      needsSession: isMarketplaceSessionRequiredError(loadError),
      error: marketplaceFailureMessage(
        marketplaceErrorCode(loadError),
        MARKETPLACE_FAILURE_MESSAGES.ordersUnavailable,
        loadError,
      ),
    }));
    return { views: null, outcome: classifyCommercePollError(loadError) };
  }
}
