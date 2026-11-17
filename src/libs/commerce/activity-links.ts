import { APP_ROUTES, MARKETPLACE_ROUTES } from '@/app/routes';
import { getMarketplaceCheckoutRoute } from '@/libs/commerce/checkout-phase';
import { MarketplaceNotificationNormalizer } from '@/pipes/marketplaceNotification/marketplaceNotification.normalizer';
import type { MarketplaceNotification } from '@/services/marketplace/marketplace';

const OFFER_TYPES = new Set<MarketplaceNotification['type']>([
  'offer_received',
  'offer_countered',
  'offer_accepted',
  'offer_rejected',
]);

/**
 * Where an Activity row goes. Order rows land on that order. A checkout-started
 * row lands on checkout while that order is still the buyer's unpaid checkout,
 * and on the order otherwise. Offer rows land on that offer. A message row
 * opens the messages inbox. Everything else uses the same surface as the
 * notification deep link.
 */
export function activityRowHref(
  type: MarketplaceNotification['type'],
  aggregateId: string | null,
  options?: { canCheckout?: boolean },
): string {
  if (type === 'message_received') {
    return APP_ROUTES.MESSAGES;
  }
  if (OFFER_TYPES.has(type) && aggregateId?.startsWith('offer:')) {
    const offerId = aggregateId.slice('offer:'.length);
    return offerId ? getMarketplaceOfferRoute(offerId) : MARKETPLACE_ROUTES.OFFERS;
  }
  if (type === 'order_created') {
    const orderId = aggregateId?.startsWith('order:') ? aggregateId.slice('order:'.length) : '';
    if (!orderId) return MARKETPLACE_ROUTES.ORDERS;
    if (options?.canCheckout) return getMarketplaceCheckoutRoute(orderId);
    return getMarketplaceOrderRoute(orderId);
  }
  const base = MarketplaceNotificationNormalizer.toDeepLink(type, aggregateId ?? '');
  if (base === MARKETPLACE_ROUTES.ORDERS && aggregateId?.startsWith('order:')) {
    const orderId = aggregateId.slice('order:'.length);
    return orderId ? getMarketplaceOrderRoute(orderId) : base;
  }
  return base;
}

export function orderAnchorId(orderId: string): string {
  return `order-${orderId}`;
}

const ORDER_LINK_PARAM = 'order';
const OFFER_LINK_PARAM = 'offer';

/**
 * Orders and Offers deep links carry the id in the query, never a `#fragment`: after a
 * document load with a fragment, Next appends it to every later in-app navigation to the
 * same page (#292). An order link opens the buyer's own unpaid checkout on its payment step.
 */
export function getMarketplaceOrderRoute(orderId: string): string {
  return `${MARKETPLACE_ROUTES.ORDERS}?${new URLSearchParams({ [ORDER_LINK_PARAM]: orderId })}`;
}

const ORDER_VIEW_PARAM = 'view';

/**
 * Orders on that order, even while it is the buyer's unpaid checkout: the
 * checkout's own order card links here (#363), so Orders must not send it back.
 */
export function getMarketplaceOrderViewRoute(orderId: string): string {
  return `${MARKETPLACE_ROUTES.ORDERS}?${new URLSearchParams({ [ORDER_LINK_PARAM]: orderId, [ORDER_VIEW_PARAM]: 'order' })}`;
}

export function readStaysOnOrder(searchParams: Pick<URLSearchParams, 'get'>): boolean {
  return searchParams.get(ORDER_VIEW_PARAM) === 'order';
}

export function getMarketplaceOfferRoute(offerId: string): string {
  return `${MARKETPLACE_ROUTES.OFFERS}?${new URLSearchParams({ [OFFER_LINK_PARAM]: offerId })}`;
}

export function readLinkedOrderId(searchParams: Pick<URLSearchParams, 'get'>): string | null {
  return readLinkedId(searchParams, ORDER_LINK_PARAM);
}

export function readLinkedOfferId(searchParams: Pick<URLSearchParams, 'get'>): string | null {
  return readLinkedId(searchParams, OFFER_LINK_PARAM);
}

/** Links shared before #292: `#order-<id>` from Activity and chat, and a bare `#<id>` from Offers. */
export function readLegacyOrderFragment(hash: string): string | null {
  const value = decodeFragment(hash);
  return value.startsWith('order-') ? nonEmpty(value.slice('order-'.length)) : nonEmpty(value);
}

/** Links shared before #292: `#offer-<id>` from Activity. */
export function readLegacyOfferFragment(hash: string): string | null {
  const value = decodeFragment(hash);
  return value.startsWith('offer-') ? nonEmpty(value.slice('offer-'.length)) : null;
}

function readLinkedId(searchParams: Pick<URLSearchParams, 'get'>, name: string): string | null {
  return nonEmpty(searchParams.get(name) ?? '');
}

function decodeFragment(hash: string): string {
  const value = hash.startsWith('#') ? hash.slice(1) : hash;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function nonEmpty(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
