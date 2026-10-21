'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ExternalLink, ReceiptText } from 'lucide-react';
import { Badge } from '@/atoms/Badge/Badge';
import { Button } from '@/atoms/Button/Button';
import { Card, CardContent } from '@/atoms/Card/Card';
import { Container } from '@/atoms/Container/Container';
import { Heading } from '@/atoms/Heading/Heading';
import { Link } from '@/atoms/Link/Link';
import { Skeleton } from '@/atoms/Skeleton/Skeleton';
import { Typography } from '@/atoms/Typography/Typography';
import { withBasePath } from '@/config/base-path';
import { isTransactionalCommerceMode } from '@/config/commerce';
import { type MarketplaceOrderView, useMarketplaceOrders } from '@/hooks/useMarketplaceOrders/useMarketplaceOrders';
import { useMarkMarketplaceOrdersSeen } from '@/hooks/useMarkMarketplaceOrdersSeen/useMarkMarketplaceOrdersSeen';
import { useNowMs } from '@/hooks/useNowMs/useNowMs';
import { CHAT_COPY } from '@/libs/chat/copy';
import {
  getMarketplaceOrderRoute,
  orderAnchorId,
  readLegacyOrderFragment,
  readLinkedOrderId,
  readStaysOnOrder,
} from '@/libs/commerce/activity-links';
import {
  bitcoinPaymentHasBeenSeen,
  buyerCheckoutBadgeLabel,
  buyerCheckoutProgressCopy,
  PAYMENT_SEEN_LABEL,
  sellerBitcoinDecision,
} from '@/libs/commerce/bitcoin-buyer-status';
import { bitcoinPaymentBreakdown, formatBitcoinAwareMoney } from '@/libs/commerce/bitcoin-payment-code';
import { CHECKOUT_HOLD_COPY, isHoldExpiredNoLateMoney } from '@/libs/commerce/checkout-hold';
import {
  getMarketplaceCheckoutRoute,
  isAbandonedCheckout,
  isBuyerCheckoutInProgress,
  isBuyerOrderHistory,
  isPendingPaymentState,
  isSellerReservation,
  isSellerSalesOrder,
  isSellerUsdtReviewOrder,
  sellerReservationCopy,
  unlistedOrderStateLabel,
} from '@/libs/commerce/checkout-phase';
import {
  DIGITAL_ORDER_COPY,
  DIGITAL_SELLER_COPY,
  digitalOrderManualChannels,
  isInstantDigitalDeliveryKind,
} from '@/libs/commerce/digital';
import { formatCommerceMoney } from '@/libs/commerce/format';
import { listingIdFromOrder } from '@/libs/commerce/listing-aggregate';
import { buyerVisiblePaymentStatus } from '@/libs/commerce/locks-payment';
import { buyerShipmentTracking } from '@/libs/commerce/order-tracking';
import { observedPaymentRail } from '@/libs/commerce/paykit-rail';
import { formatBitcoinAmount } from '@/libs/commerce/pricing';
import {
  REFUND_ORDER_NOTICES,
  refundOrderNotices,
  refundRecordLine,
  refundStateLabel,
} from '@/libs/commerce/refund-copy';
import { usdtPaidAsLine } from '@/libs/commerce/usdt-buyer-status';
import { isUsdtRefundOrder } from '@/libs/commerce/usdt-refund';
import { takeDocumentFragment } from '@/libs/navigation/document-fragment';
import { ArbiscanLookupLink } from '@/molecules/Marketplace/ArbiscanLookupLink';
import { MarketplaceCheckoutStatusLabels } from '@/molecules/Marketplace/MarketplaceCheckoutStatusLabels';
import { MarketplaceEmptyState } from '@/molecules/Marketplace/MarketplaceEmptyState';
import { MarketplacePaymentStatusLabels } from '@/molecules/Marketplace/MarketplacePaymentStatusBadge';
import { ChatEntryButton } from '@/organisms/Chat/ChatEntryButton';
import { ContentLayout } from '@/organisms/ContentLayout/ContentLayout';
import { DropEditionBadge, DropEditionReceiptLine } from '@/organisms/Marketplace/DropEditionBadge';
import { MarketplaceBitcoinAmountBreakdown } from '@/organisms/Marketplace/MarketplaceBitcoinAmountBreakdown';
import { MarketplaceCheckoutItem } from '@/organisms/Marketplace/MarketplaceCheckoutItem';
import { MarketplaceConnectorPushStatus } from '@/organisms/Marketplace/MarketplaceConnectorPushStatus';
import { MarketplaceIndicativePrice } from '@/organisms/Marketplace/MarketplaceIndicativePrice';
import { MarketplaceMyReviews } from '@/organisms/Marketplace/MarketplaceMyReviews';
import { MarketplaceOrderActions } from '@/organisms/Marketplace/MarketplaceOrderActions';
import { MarketplaceOrderDigitalPanel } from '@/organisms/Marketplace/MarketplaceOrderDigitalPanel';
import { MarketplaceOrderReference } from '@/organisms/Marketplace/MarketplaceOrderReference';
import { MarketplacePaymentStatusCard } from '@/organisms/Marketplace/MarketplacePaymentStatusCard';
import { MarketplaceReauthDialog } from '@/organisms/Marketplace/MarketplaceReauthDialog';
import { MarketplaceSectionNav } from '@/organisms/Marketplace/MarketplaceSectionNav';
import { MarketplaceSellerDigitalPanel } from '@/organisms/Marketplace/MarketplaceSellerDigitalPanel';
import { MarketplaceSessionConnectDialog } from '@/organisms/Marketplace/MarketplaceSessionConnectDialog';
import { MarketplaceUsdtPaymentSummary } from '@/organisms/Marketplace/MarketplaceUsdtPaymentSummary';
import { MarketplaceUsdtRefundAddress } from '@/organisms/Marketplace/MarketplaceUsdtRefundAddress';
import type { MarketplaceOrder, MarketplacePayment } from '@/services/marketplace/marketplace';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useCommerceStore } from '@/stores/commerce/commerce.store';

type OrdersTab = 'needs_action' | 'waiting_other' | 'in_transit' | 'completed' | 'cancelled' | 'all';

const ORDER_TABS: { id: OrdersTab; label: string }[] = [
  { id: 'needs_action', label: 'Needs my action' },
  { id: 'waiting_other', label: 'Waiting on seller' },
  { id: 'in_transit', label: 'In transit' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'all', label: 'All' },
];

export function MarketplaceOrders() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const anchorOrderId = readLinkedOrderId(searchParams);
  const staysOnOrder = readStaysOnOrder(searchParams);
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  const receiptsPublicationStatus = useCommerceStore((state) => state.receiptsPublicationStatus);
  const { orders, isLoading, error, needsSession, refresh, advancePayment, actOnOrder, adapterMode } =
    useMarketplaceOrders();
  const isSandbox = adapterMode === 'sandbox';
  const hasTransactionBackend = isTransactionalCommerceMode(adapterMode);
  const [activeTab, setActiveTab] = useState<OrdersTab>('all');
  const [hasSelectedTab, setHasSelectedTab] = useState(false);
  const tabListRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Partial<Record<OrdersTab, HTMLButtonElement | null>>>({});
  const redirectedOrderRef = useRef<string | null>(null);
  const scrolledAnchorRef = useRef<string | null>(null);
  const [legacyOrderId, setLegacyOrderId] = useState<string | null>(null);
  const nowMs = useNowMs(orders.some(({ order }) => order.state === 'pending_payment' && Boolean(order.holdExpiresAt)));
  const buyerCheckouts = orders.filter(({ order }) => isBuyerCheckoutInProgress(order, currentUserPubky));
  const sellerReservations = orders.filter(({ order, payment }) =>
    isSellerReservation(order, currentUserPubky, payment),
  );
  const abandonedCheckouts = orders.filter(({ order }) => isAbandonedCheckout(order, currentUserPubky));
  const historyOrders = orders.filter(
    ({ order, payment }) =>
      isBuyerOrderHistory(order, currentUserPubky) || isSellerSalesOrder(order, currentUserPubky, payment),
  );
  const orderCounts = getOrderTabCounts(historyOrders, currentUserPubky);
  const visibleOrders = historyOrders.filter((view) => isOrderInTab(view, activeTab, currentUserPubky));
  const waitingLabel = waitingTabLabel(historyOrders, currentUserPubky);
  const orderTabs = ORDER_TABS.map((tab) => (tab.id === 'waiting_other' ? { ...tab, label: waitingLabel } : tab));
  const listedOrderIds = new Set(
    [...buyerCheckouts, ...sellerReservations, ...historyOrders, ...abandonedCheckouts].map(({ order }) => order.id),
  );
  const anchoredOrder =
    anchorOrderId && !listedOrderIds.has(anchorOrderId)
      ? (orders.find(({ order }) => order.id === anchorOrderId)?.order ?? null)
      : null;
  const linkedUnlistedOrder =
    anchoredOrder && isOrderParticipant(anchoredOrder, currentUserPubky) ? anchoredOrder : null;

  useMarkMarketplaceOrdersSeen(!isLoading && !error && !needsSession);

  useEffect(() => {
    const fragment = takeDocumentFragment(window.location);
    const id = fragment ? readLegacyOrderFragment(fragment) : null;
    if (id) setLegacyOrderId(id);
  }, []);

  useEffect(() => {
    if (isLoading || !legacyOrderId) return;
    setLegacyOrderId(null);
    if (orders.some(({ order }) => order.id === legacyOrderId)) {
      window.history.replaceState(null, '', withBasePath(getMarketplaceOrderRoute(legacyOrderId)));
    }
  }, [isLoading, legacyOrderId, orders]);

  useEffect(() => {
    if (isLoading) return;
    const anchorId = anchorOrderId;
    if (!anchorId) return;
    const view = orders.find((candidate) => candidate.order.id === anchorId);
    if (!view) return;
    // A checkout in progress sits above the tabs, in its own list (#363).
    const inCheckoutList = isBuyerCheckoutInProgress(view.order, currentUserPubky);
    if (!inCheckoutList && !isOrderInTab(view, activeTab, currentUserPubky)) {
      if (activeTab !== 'all') {
        setActiveTab('all');
        setHasSelectedTab(true);
      }
      return;
    }
    // Once per anchor: the orders poll would otherwise pull the page back to this order every few
    // seconds, under the reader's scroll or an open sheet with the keyboard up.
    if (scrolledAnchorRef.current === anchorId) return;
    const anchor = document.getElementById(orderAnchorId(anchorId));
    if (!anchor) return;
    scrolledAnchorRef.current = anchorId;
    anchor.scrollIntoView({ block: 'center' });
  }, [activeTab, anchorOrderId, currentUserPubky, isLoading, orders]);

  useEffect(() => {
    if (isLoading) return;
    const id = anchorOrderId;
    if (!id || staysOnOrder || redirectedOrderRef.current === id) return;
    const view = orders.find((candidate) => candidate.order.id === id);
    if (view && isBuyerCheckoutInProgress(view.order, currentUserPubky)) {
      redirectedOrderRef.current = id;
      router.replace(getMarketplaceCheckoutRoute(id));
    }
  }, [anchorOrderId, currentUserPubky, isLoading, orders, router, staysOnOrder]);

  useEffect(() => {
    if (hasSelectedTab || !historyOrders.length) return;
    setActiveTab(
      orderCounts.needs_action > 0 ? 'needs_action' : orderCounts.waiting_other > 0 ? 'waiting_other' : 'all',
    );
  }, [currentUserPubky, hasSelectedTab, historyOrders.length, orderCounts.needs_action, orderCounts.waiting_other]);

  useEffect(() => {
    const tabList = tabListRef.current;
    const activeTabButton = tabRefs.current[activeTab];
    if (!tabList || !activeTabButton) return;

    const isClipped =
      activeTabButton.offsetLeft < tabList.scrollLeft ||
      activeTabButton.offsetLeft + activeTabButton.offsetWidth > tabList.scrollLeft + tabList.clientWidth;
    if (!isClipped) return;

    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    tabList.scrollTo({
      left: Math.max(0, activeTabButton.offsetLeft - (tabList.clientWidth - activeTabButton.offsetWidth) / 2),
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });
  }, [activeTab]);

  const chooseTab = (tab: OrdersTab) => {
    setHasSelectedTab(true);
    setActiveTab(tab);
  };

  return (
    <ContentLayout
      showLeftSidebar={false}
      showRightSidebar={false}
      showLeftMobileButton={false}
      showRightMobileButton={false}
      disableMainContentOverflow
      className="pb-28"
    >
      <Container overrideDefaults className="flex w-full flex-col gap-6" data-surface="marketplace-orders">
        <MarketplaceSectionNav />
        <div>
          <Heading level={1} size="xl" className="text-4xl sm:text-6xl">
            Orders
          </Heading>
          <Typography as="p" className="mt-2 text-muted-foreground">
            {isSandbox
              ? 'Track your simulated purchases and sales. No real funds move.'
              : 'Track your purchases and sales.'}
          </Typography>
        </div>

        {hasTransactionBackend && <MarketplaceConnectorPushStatus />}

        {!hasTransactionBackend ? (
          <div className="flex min-h-64 flex-col items-center justify-center rounded-md px-6 text-center">
            <ReceiptText className="mb-3 size-10 text-muted-foreground" />
            <Heading level={2} size="md">
              Order timelines are not available here
            </Heading>
            <Typography as="p" className="mt-2 max-w-lg text-sm text-muted-foreground">
              Order history is unavailable here.
            </Typography>
          </div>
        ) : isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : needsSession && error ? (
          // A missing or expired marketplace session is not an empty history:
          // the orders load once the session is approved again.
          <MarketplaceEmptyState
            icon={ReceiptText}
            title="Approve the marketplace to see your orders"
            description="Your purchases and sales show here after one approval."
            action={<MarketplaceSessionConnectDialog triggerLabel="Approve" onConnected={refresh} />}
          />
        ) : error ? (
          <div role="alert" className="rounded-md border border-destructive/40 p-4">
            {error}
          </div>
        ) : orders.length ? (
          <>
            {linkedUnlistedOrder && (
              <div className="grid gap-3" data-testid="marketplace-linked-order">
                <Heading level={2} size="sm" className="text-xl font-semibold">
                  From Activity
                </Heading>
                <Card id={orderAnchorId(linkedUnlistedOrder.id)} className="scroll-mt-24 rounded-md p-0">
                  <CardContent className="grid min-w-0 gap-4 p-6">
                    <MarketplaceOrderReference
                      order={linkedUnlistedOrder}
                      isBuyer={currentUserPubky === linkedUnlistedOrder.buyerPubky}
                      showPlacedAt
                    />
                    {linkedUnlistedOrder.lines.map((line, index) => (
                      <MarketplaceCheckoutItem
                        key={`${line.listingAggregateId}:${line.variantId ?? index}`}
                        line={line}
                        showEstimate={showsLineEstimate(linkedUnlistedOrder)}
                      />
                    ))}
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">
                        {currentUserPubky === linkedUnlistedOrder.buyerPubky ? 'Your purchase' : 'Your sale'}
                      </Badge>
                      <Badge variant="outline" data-testid="marketplace-linked-order-state">
                        {unlistedOrderStateLabel(linkedUnlistedOrder)}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
            {buyerCheckouts.length > 0 && (
              <div className="grid gap-3" data-testid="marketplace-continue-checkout">
                <Heading level={2} size="sm" className="text-xl font-semibold">
                  Checkout in progress
                </Heading>
                {buyerCheckouts.map(({ order, payment }) => (
                  <Card key={order.id} id={orderAnchorId(order.id)} className="scroll-mt-24 rounded-md p-0">
                    <CardContent className="grid min-w-0 gap-4 p-6">
                      <MarketplaceOrderReference order={order} isBuyer showPlacedAt />
                      <MarketplaceCheckoutStatusLabels
                        order={order}
                        payment={payment}
                        isSandbox={isSandbox}
                        showCheckoutPhase={false}
                      />
                      {order.lines.map((line, index) => (
                        <MarketplaceCheckoutItem
                          key={`${line.listingAggregateId}:${line.variantId ?? index}`}
                          line={line}
                          showEstimate={showsLineEstimate(order)}
                        />
                      ))}
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        {order.paymentMethod && (
                          <Typography as="p" className="text-sm text-muted-foreground">
                            {buyerCheckoutProgressCopy(order, payment, nowMs)}
                          </Typography>
                        )}
                        <Button asChild size="default" className="ml-auto rounded-full">
                          <Link href={getMarketplaceCheckoutRoute(order.id)} overrideDefaults>
                            {bitcoinPaymentHasBeenSeen(order, payment) ? 'View payment' : 'Continue checkout'}
                          </Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
            {sellerReservations.length > 0 && (
              <div className="grid gap-3" data-testid="marketplace-reservations">
                <Heading level={2} size="sm" className="text-xl font-semibold">
                  Reservations
                </Heading>
                {sellerReservations.map(({ order, payment }) => {
                  const decision = sellerBitcoinDecision(order, payment);
                  return (
                    <Card key={order.id} className="rounded-md p-0">
                      <CardContent className="grid min-w-0 gap-4 p-6">
                        <MarketplaceOrderReference order={order} isBuyer={false} showPlacedAt />
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="outline">Reservation</Badge>
                          <Badge variant="outline">{decision ? PAYMENT_SEEN_LABEL : 'Held'}</Badge>
                        </div>
                        {order.lines.map((line, index) => (
                          <MarketplaceCheckoutItem
                            key={`${line.listingAggregateId}:${line.variantId ?? index}`}
                            line={line}
                            showEstimate={showsLineEstimate(order)}
                          />
                        ))}
                        <Typography as="p" className="text-sm text-muted-foreground">
                          {decision ? PAYMENT_SEEN_LABEL : sellerReservationCopy(order.holdExpiresAt)}
                        </Typography>
                        <MarketplaceUsdtPaymentSummary order={order} payment={payment} isBuyer={false} />
                        {decision && (
                          <MarketplacePaymentStatusCard
                            order={order}
                            payment={payment}
                            isBuyer={false}
                            adapterMode={adapterMode}
                            advancePayment={advancePayment}
                            onPaymentChanged={refresh}
                          />
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
            {historyOrders.length > 0 && (
              <>
                <div
                  ref={tabListRef}
                  className="flex flex-nowrap gap-2 overflow-x-auto pb-2 sm:flex-wrap sm:overflow-visible"
                  role="tablist"
                  aria-label="Order filters"
                >
                  {orderTabs.map((tab) => (
                    <Button
                      key={tab.id}
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="rounded-none border-0 border-b border-solid border-transparent bg-transparent shadow-none aria-selected:border-white aria-selected:text-white"
                      role="tab"
                      aria-selected={activeTab === tab.id}
                      aria-label={`${tab.label} ${orderCounts[tab.id]}`}
                      ref={(element) => {
                        tabRefs.current[tab.id] = element;
                      }}
                      onClick={() => chooseTab(tab.id)}
                    >
                      {tab.label}
                      <span className={activeTab === tab.id ? 'text-xs text-white' : 'text-xs text-muted-foreground'}>
                        {orderCounts[tab.id]}
                      </span>
                    </Button>
                  ))}
                </div>
                <div className="grid gap-4">
                  {visibleOrders.map(({ order, payment, receipt }) => {
                    const isBuyer = currentUserPubky === order.buyerPubky;
                    const refundRecord = refundRecordLine(order);
                    const nextActorHint = getNextActorHint(order, payment, isBuyer);
                    const nextActorBadge = nextActorHint && (
                      <Badge
                        variant="outline"
                        className={nextActorHint.isCurrentUser ? 'bg-orange-400 text-primary-foreground' : undefined}
                      >
                        {nextActorHint.label}
                      </Badge>
                    );
                    const paymentConfirmed =
                      payment !== null && buyerVisiblePaymentStatus(payment.state) === 'confirmed';
                    const bitcoinBreakdown = bitcoinPaymentBreakdown(order);
                    return (
                      <Card key={order.id} id={orderAnchorId(order.id)} className="scroll-mt-24 rounded-md p-0">
                        <CardContent className="grid min-w-0 gap-4 p-6">
                          <MarketplaceOrderReference order={order} isBuyer={isBuyer} showPlacedAt />
                          <div
                            className="flex flex-wrap items-center gap-2"
                            data-testid="marketplace-order-status-labels"
                          >
                            {paymentConfirmed ? (
                              <MarketplacePaymentStatusLabels
                                order={order}
                                payment={payment}
                                isBuyer={isBuyer}
                                isSandbox={adapterMode === 'sandbox'}
                                statusHint={nextActorBadge}
                              />
                            ) : (
                              nextActorBadge
                            )}
                            <Badge variant="outline">{isBuyer ? 'Bought' : 'Sold'}</Badge>
                            <Badge variant="outline">
                              {isPendingPaymentState(order.state)
                                ? isBuyer
                                  ? buyerCheckoutBadgeLabel(order, payment)
                                  : 'Held'
                                : orderStateLabel(order)}
                            </Badge>
                            {order.fulfillment === 'pickup' && <Badge variant="outline">Local pickup</Badge>}
                            {order.fulfillment === 'digital' && <Badge variant="outline">Digital delivery</Badge>}
                            <DropEditionBadge order={order} />
                            {order.pricedFrom === 'offer' && (
                              <Badge variant="outline">Priced from your accepted offer</Badge>
                            )}
                          </div>
                          {order.lines.map((line, index) => (
                            <MarketplaceCheckoutItem
                              key={`${line.listingAggregateId}:${line.variantId ?? index}`}
                              line={line}
                              showEstimate={showsLineEstimate(order)}
                            />
                          ))}
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <Typography
                                as="p"
                                className="flex flex-wrap items-baseline gap-x-2 text-lg font-semibold text-brand"
                              >
                                {bitcoinBreakdown
                                  ? formatBitcoinAwareMoney(bitcoinBreakdown.payable)
                                  : formatCommerceMoney(order.total)}{' '}
                                <MarketplaceOrderBitcoinAmount order={order} />
                              </Typography>
                              {bitcoinBreakdown ? (
                                <MarketplaceBitcoinAmountBreakdown order={order} className="mt-1" />
                              ) : (
                                <div className="mt-1 grid gap-1 text-xs text-muted-foreground">
                                  <span>Items: {formatCommerceMoney(order.subtotal)}</span>
                                  {order.fulfillment !== 'digital' && (
                                    <span>Shipping: {formatCommerceMoney(order.shipping)}</span>
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="flex flex-col items-end">
                              <MarketplaceOrderActions
                                order={order}
                                isBuyer={isBuyer}
                                canEditReview={adapterMode === 'transaction-service'}
                                actOnOrder={actOnOrder}
                                onChanged={refresh}
                                messageAction={<MarketplaceOrderMessageCta order={order} />}
                              />
                            </div>
                          </div>
                          <div className="min-w-0 empty:hidden">
                            {order.state === 'pending_payment' &&
                              order.holdExpiresAt &&
                              (isBuyer ||
                                !(
                                  sellerBitcoinDecision(order, payment) || isSellerUsdtReviewOrder(order, payment)
                                )) && (
                                <Typography as="p" className="mt-2 text-sm text-muted-foreground">
                                  {isBuyer
                                    ? buyerCheckoutProgressCopy(order, payment, nowMs)
                                    : sellerReservationCopy(order.holdExpiresAt)}
                                </Typography>
                              )}
                            {/* A post-payment terms change (§A3): the buyer is told
                            plainly, and their unilateral exit is named. */}
                            {isBuyer && order.fulfillment === 'pickup' && order.pickupTermsChanged && (
                              <div
                                className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3"
                                role="status"
                              >
                                <Typography as="p" className="text-sm text-amber-200">
                                  The seller changed the pickup terms since you paid. Show the meeting point to see the
                                  terms you paid against — you can cancel this order instantly from the order actions.
                                </Typography>
                              </div>
                            )}
                            {receipt && (
                              <details
                                className="mt-3 [&:not([open])>:not(summary)]:!hidden"
                                data-testid="order-receipt-details"
                              >
                                <summary className="cursor-pointer text-sm text-muted-foreground">Receipt</summary>
                                <MarketplaceBitcoinAmountBreakdown order={order} className="mt-2" />
                                {usdtPaidAsLine(order) && (
                                  <Typography as="p" className="mt-2 text-sm" data-testid="order-receipt-usdt-paid-as">
                                    {usdtPaidAsLine(order)}
                                  </Typography>
                                )}
                                <div
                                  className="mt-1 flex items-center gap-2 text-sm break-all text-muted-foreground"
                                  data-testid="order-receipt-hash"
                                >
                                  <ReceiptText className="size-4 shrink-0 text-brand" />
                                  Receipt integrity {receipt.contentHash.slice(0, 12)}…
                                </div>
                              </details>
                            )}
                            <DropEditionReceiptLine order={order} />
                            {receipt && receiptsPublicationStatus === 'needs_reauth' && (
                              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                                <Typography as="p" className="text-sm text-muted-foreground">
                                  Receipt not saved to your private storage yet — reconnect to save it
                                </Typography>
                                <MarketplaceReauthDialog
                                  triggerLabel="Sign in again"
                                  refusal="homeserver"
                                  onReauthenticated={refresh}
                                />
                              </div>
                            )}
                            {receipt && receiptsPublicationStatus === 'needs_marketplace_approval' && (
                              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                                <Typography as="p" className="text-sm text-muted-foreground">
                                  Receipt not saved to your private storage yet — approve the marketplace to save it
                                </Typography>
                                <MarketplaceReauthDialog
                                  triggerLabel="Approve private storage"
                                  refusal="purchase_session"
                                  onReauthenticated={refresh}
                                />
                              </div>
                            )}
                            {order.shipment && order.fulfillment !== 'digital' && (
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                                {(() => {
                                  const tracking = buyerShipmentTracking(order.shipment);
                                  if (tracking.kind === 'pending') {
                                    return <Typography as="p">{tracking.label}</Typography>;
                                  }
                                  return (
                                    <>
                                      <Typography as="p">
                                        {tracking.carrier} · {tracking.trackingNumber} · {order.shipment.state}
                                      </Typography>
                                      {/* Only carriers the curated registry can resolve get a
                                    link — an unrecognized carrier stays plain text
                                    instead of risking a dead tracking URL. */}
                                      {tracking.url && (
                                        <Link
                                          href={tracking.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          overrideDefaults
                                          className="inline-flex items-center gap-1 font-medium text-brand hover:underline"
                                        >
                                          Track package
                                          <ExternalLink className="size-3.5" />
                                        </Link>
                                      )}
                                    </>
                                  );
                                })()}
                              </div>
                            )}
                            {order.deliveryAssumed && (
                              <div className="mt-3 rounded-md bg-brand/5 p-3">
                                <Typography as="p" className="text-sm text-foreground">
                                  Marked delivered automatically after the delivery window; tell the seller if it
                                  hasn&apos;t arrived.
                                </Typography>
                              </div>
                            )}
                            {order.state === 'delivered' && order.fulfillment !== 'digital' && (
                              <Typography as="p" className="mt-2 text-sm text-muted-foreground">
                                Completes automatically after the return window unless a return is requested.
                              </Typography>
                            )}
                            {order.returnRequest && (
                              <Typography as="p" className="mt-2 text-sm text-muted-foreground">
                                Return {order.returnRequest.state}: {order.returnRequest.reason}
                              </Typography>
                            )}
                            {refundRecord && (
                              <Typography
                                as="p"
                                className="mt-2 text-sm [overflow-wrap:anywhere] text-brand"
                                data-testid="order-refund-record"
                              >
                                {/* Only ever externally evidenced: Paykit Server cannot spend, so
                              the app records the seller's transaction evidence and never
                              claims it moved funds itself. */}
                                {refundRecord}
                              </Typography>
                            )}
                            {refundRecord && isUsdtRefundOrder(order) && (
                              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1" data-testid="order-refund-lookups">
                                <ArbiscanLookupLink kind="transaction" value={order.externalRefund?.transactionId} />
                                <ArbiscanLookupLink kind="address" value={order.refundDestination?.address} />
                              </div>
                            )}
                            {refundOrderNotices(order).map((notice) => (
                              <Typography
                                key={notice}
                                as="p"
                                className="mt-2 text-sm text-muted-foreground"
                                data-testid={`order-refund-notice-${notice}`}
                              >
                                {REFUND_ORDER_NOTICES[notice]}
                              </Typography>
                            ))}
                            <MarketplaceUsdtRefundAddress
                              order={order}
                              isBuyer={isBuyer}
                              paymentInReview={payment?.state === 'manual_review'}
                              actOnOrder={actOnOrder}
                            />
                            {isBuyer && order.fulfillment === 'digital' && (
                              <MarketplaceOrderDigitalPanel order={order} onChanged={refresh} />
                            )}
                            {!isBuyer && order.fulfillment === 'digital' && (
                              <MarketplaceSellerDigitalPanel order={order} onChanged={refresh} />
                            )}
                            <MarketplacePaymentStatusCard
                              order={order}
                              payment={payment}
                              isBuyer={isBuyer}
                              adapterMode={adapterMode}
                              advancePayment={advancePayment}
                              onPaymentChanged={refresh}
                              confirmedStatusInOrderLabels={paymentConfirmed}
                              className="mt-4"
                            />
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </>
            )}
            {abandonedCheckouts.length > 0 && (
              <div className="grid gap-3" data-testid="marketplace-abandoned-checkouts">
                <Heading level={2} size="sm" className="text-xl font-semibold">
                  Abandoned
                </Heading>
                {abandonedCheckouts.map(({ order }) => (
                  <Card key={order.id} className="rounded-md p-0">
                    <CardContent className="grid min-w-0 gap-4 p-6">
                      <MarketplaceOrderReference
                        order={order}
                        isBuyer={currentUserPubky === order.buyerPubky}
                        showPlacedAt
                      />
                      {order.lines.map((line, index) => (
                        <MarketplaceCheckoutItem
                          key={`${line.listingAggregateId}:${line.variantId ?? index}`}
                          line={line}
                          showEstimate={showsLineEstimate(order)}
                        />
                      ))}
                      <Typography as="p" className="text-sm text-muted-foreground">
                        Checkout ended before payment.
                      </Typography>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        ) : (
          <MarketplaceEmptyState
            icon={ReceiptText}
            title="No orders yet"
            description="Your purchases and sales will appear here."
          />
        )}

        <MarketplaceMyReviews />
      </Container>
    </ContentLayout>
  );
}

function MarketplaceOrderMessageCta({ order }: { order: MarketplaceOrder }) {
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  if (!currentUserPubky) return null;
  const peerPubky = currentUserPubky === order.sellerPubky ? order.buyerPubky : order.sellerPubky;
  return (
    <div data-surface="marketplace-order-message-cta">
      <ChatEntryButton
        peerPubky={peerPubky}
        context={{ orderId: order.id, listingId: listingIdFromOrder(order) ?? undefined }}
        label={CHAT_COPY.orderCta}
        size="default"
        className="w-full rounded-full sm:w-auto"
      />
    </div>
  );
}

function showsLineEstimate(order: MarketplaceOrder): boolean {
  const rail = observedPaymentRail(order);
  return rail !== 'usdt' && !(rail === 'bitcoin' && order.bitcoinQuote?.quotedSats != null);
}

function MarketplaceOrderBitcoinAmount({ order }: { order: MarketplaceOrder }): ReactNode {
  if (bitcoinPaymentBreakdown(order)) return null;
  // A USDT payment settles in USDT; a bitcoin estimate would mislead.
  const rail = observedPaymentRail(order);
  if (rail === 'usdt') return null;
  const quote = rail === 'bitcoin' ? order.bitcoinQuote : null;
  if (quote?.quotedSats !== null && quote?.quotedSats !== undefined) {
    return (
      <Typography as="span" className="text-sm font-normal">
        Locked Bitcoin amount: {formatBitcoinAmount(quote.quotedSats)}
        {order.state === 'pending_payment' && isMarketplaceBitcoinQuoteExpired(quote.expiresAt)
          ? ' · Bitcoin quote expired'
          : ''}
      </Typography>
    );
  }

  return <MarketplaceIndicativePrice money={order.total} className="text-sm font-normal" />;
}

function isMarketplaceBitcoinQuoteExpired(expiresAt: string | null): boolean {
  const parsedExpiresAt = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  return Number.isFinite(parsedExpiresAt) && parsedExpiresAt <= Date.now();
}

function getOrderTabCounts(orders: MarketplaceOrderView[], currentUserPubky: string | null): Record<OrdersTab, number> {
  return {
    needs_action: orders.filter((view) => isOrderInTab(view, 'needs_action', currentUserPubky)).length,
    waiting_other: orders.filter((view) => isOrderInTab(view, 'waiting_other', currentUserPubky)).length,
    in_transit: orders.filter((view) => isOrderInTab(view, 'in_transit', currentUserPubky)).length,
    completed: orders.filter((view) => isOrderInTab(view, 'completed', currentUserPubky)).length,
    cancelled: orders.filter((view) => isOrderInTab(view, 'cancelled', currentUserPubky)).length,
    all: orders.length,
  };
}

function isOrderInTab(
  { order, payment }: MarketplaceOrderView,
  tab: OrdersTab,
  currentUserPubky: string | null,
): boolean {
  switch (tab) {
    case 'needs_action':
      return isOrderNeedingCurrentUser(order, currentUserPubky);
    case 'waiting_other':
      return isOrderWaitingOnOtherSide({ order, payment }, currentUserPubky);
    case 'in_transit':
      return ['shipped', 'delivered'].includes(order.state);
    case 'completed':
      return ['completed', 'refunded_external', 'refunded_partial', 'closed'].includes(order.state);
    case 'cancelled':
      return order.state === 'cancelled';
    case 'all':
      return true;
  }
}

function isCurrentUserSeller(order: MarketplaceOrder, currentUserPubky: string | null): boolean {
  return currentUserPubky !== null && order.sellerPubky === currentUserPubky;
}

function isCurrentUserBuyer(order: MarketplaceOrder, currentUserPubky: string | null): boolean {
  return currentUserPubky !== null && order.buyerPubky === currentUserPubky;
}

function isOrderParticipant(order: MarketplaceOrder, currentUserPubky: string | null): boolean {
  return isCurrentUserBuyer(order, currentUserPubky) || isCurrentUserSeller(order, currentUserPubky);
}

function isSellerAwaitingPayment(
  { order, payment }: Pick<MarketplaceOrderView, 'order' | 'payment'>,
  currentUserPubky: string | null,
): boolean {
  return (
    isCurrentUserSeller(order, currentUserPubky) &&
    !isCurrentUserBuyer(order, currentUserPubky) &&
    order.state === 'pending_payment' &&
    payment !== null &&
    buyerVisiblePaymentStatus(payment.state) === 'awaiting_entitlement'
  );
}

function isOrderNeedingCurrentUser(order: MarketplaceOrder, currentUserPubky: string | null): boolean {
  if (currentUserPubky === null) return false;
  if (order.nextActor === 'buyer') return isCurrentUserBuyer(order, currentUserPubky);
  if (order.nextActor === 'seller') return isCurrentUserSeller(order, currentUserPubky);
  return false;
}

/**
 * The waiting tab names the side its orders wait on, from the viewer's seat: a
 * buyer's orders wait on the seller, a seller's unpaid sales on the buyer, and
 * an account with both reads "Waiting on others". An empty tab follows whether
 * the viewer buys, sells or both.
 */
function waitingTabLabel(orders: MarketplaceOrderView[], currentUserPubky: string | null): string {
  const waiting = orders.filter((view) => isOrderWaitingOnOtherSide(view, currentUserPubky));
  // With nothing waiting, the viewer's own roles in their orders pick the side.
  const onSeller =
    waiting.length > 0
      ? waiting.some(({ order }) => order.nextActor === 'seller')
      : orders.some(({ order }) => isCurrentUserBuyer(order, currentUserPubky));
  const onBuyer =
    waiting.length > 0
      ? waiting.some(({ order }) => order.nextActor === 'buyer')
      : orders.some(
          ({ order }) => isCurrentUserSeller(order, currentUserPubky) && !isCurrentUserBuyer(order, currentUserPubky),
        );
  if (onSeller && onBuyer) return 'Waiting on others';
  if (onBuyer) return 'Waiting on buyer';
  return 'Waiting on seller';
}

function isOrderWaitingOnOtherSide(
  { order, payment }: Pick<MarketplaceOrderView, 'order' | 'payment'>,
  currentUserPubky: string | null,
): boolean {
  if (currentUserPubky === null) return false;
  if (order.nextActor === 'buyer') return isSellerAwaitingPayment({ order, payment }, currentUserPubky);
  if (order.nextActor === 'seller') return isCurrentUserBuyer(order, currentUserPubky);
  return false;
}

/**
 * The state pill. Pickup orders get plain-language labels for their path
 * (§A6): paid means paid-and-not-yet-collected, ready_for_pickup speaks for
 * itself, and a delivered pickup order was handed over in person.
 */
function orderStateLabel(order: MarketplaceOrder): string {
  const refund = refundStateLabel(order);
  if (refund) return refund;
  if (
    order.fulfillment === 'digital' &&
    order.state === 'delivered' &&
    order.lines.some((line) => line.digitalKind !== undefined && isInstantDigitalDeliveryKind(line.digitalKind))
  ) {
    return DIGITAL_ORDER_COPY.readyToDownload;
  }
  if (order.fulfillment === 'pickup') {
    switch (order.state) {
      case 'paid':
        return 'Paid';
      case 'ready_for_pickup':
        return 'Ready for pickup';
      case 'delivered':
        return 'Picked up';
    }
  }
  const label = order.state.replaceAll('_', ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function getNextActorHint(
  order: MarketplaceOrder,
  payment: MarketplacePayment | null,
  isBuyer: boolean,
): { label: string; isCurrentUser: boolean } | null {
  if (order.state === 'pending_payment') {
    return null;
  }
  if (isHoldExpiredNoLateMoney(order, payment)) {
    return { label: CHECKOUT_HOLD_COPY.expiredNoLateMoney, isCurrentUser: false };
  }
  if (order.nextActor === 'buyer') {
    return isBuyer
      ? { label: 'Needs action', isCurrentUser: true }
      : { label: 'Waiting on buyer', isCurrentUser: false };
  }
  if (order.nextActor === 'seller') {
    if (isBuyer) return { label: 'Waiting on seller', isCurrentUser: false };
    // Digital delivery design §3 "Seller's orders": a paid digital order the seller sends by hand.
    if (
      order.fulfillment === 'digital' &&
      order.state === 'paid' &&
      digitalOrderManualChannels(order.lines).length > 0
    ) {
      return { label: DIGITAL_SELLER_COPY.toDeliver, isCurrentUser: true };
    }
    return { label: 'Needs action', isCurrentUser: true };
  }
  return null;
}
