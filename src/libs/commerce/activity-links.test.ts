import { describe, expect, it } from 'vitest';
import { APP_ROUTES, MARKETPLACE_ROUTES } from '@/app/routes';
import {
  activityRowHref,
  getMarketplaceOfferRoute,
  getMarketplaceOrderRoute,
  getMarketplaceOrderViewRoute,
  readLegacyOfferFragment,
  readLegacyOrderFragment,
  readLinkedOfferId,
  readLinkedOrderId,
  readStaysOnOrder,
} from './activity-links';

const SELLER = 's'.repeat(52);
const BUYER = 'b'.repeat(52);
const CONVERSATION = `conversation:${SELLER}_${BUYER}_listing-1`;
const ORDER = '018f47d2-6a27-7c23-a62f-000000000001';

describe('activityRowHref', () => {
  it('anchors an order event on that order', () => {
    expect(activityRowHref('return_updated', `order:${ORDER}`)).toBe(`${MARKETPLACE_ROUTES.ORDERS}?order=${ORDER}`);
    expect(activityRowHref('review_received', `order:${ORDER}`)).toBe(`${MARKETPLACE_ROUTES.ORDERS}?order=${ORDER}`);
  });

  it('anchors an offer and opens a message thread', () => {
    expect(activityRowHref('offer_received', 'offer:offer-1')).toBe(`${MARKETPLACE_ROUTES.OFFERS}?offer=offer-1`);
    expect(activityRowHref('message_received', CONVERSATION)).toBe(APP_ROUTES.MESSAGES);
  });

  it('sends an auction row to the listing', () => {
    const href = activityRowHref('outbid', `listing:${SELLER}_boots`);
    expect(href).toContain(SELLER);
    expect(href).toContain('boots');
  });

  it('opens checkout started on the order, and on checkout only while that order can still be checked out', () => {
    expect(activityRowHref('order_created', `order:${ORDER}`)).toBe(`${MARKETPLACE_ROUTES.ORDERS}?order=${ORDER}`);
    expect(activityRowHref('order_created', `order:${ORDER}`, { canCheckout: false })).toBe(
      `${MARKETPLACE_ROUTES.ORDERS}?order=${ORDER}`,
    );
    expect(activityRowHref('order_created', `order:${ORDER}`, { canCheckout: true })).toBe(
      `${MARKETPLACE_ROUTES.CHECKOUT}?order=${ORDER}`,
    );
    expect(activityRowHref('order_created', null, { canCheckout: true })).toBe(MARKETPLACE_ROUTES.ORDERS);
  });
});

describe('order and offer deep links', () => {
  it('carry the id in the query, never in a fragment', () => {
    const order = new URL(getMarketplaceOrderRoute(ORDER), 'https://shop.test');
    const offer = new URL(getMarketplaceOfferRoute('offer-1'), 'https://shop.test');
    expect(order.hash).toBe('');
    expect(offer.hash).toBe('');
    expect(readLinkedOrderId(order.searchParams)).toBe(ORDER);
    expect(readLinkedOfferId(offer.searchParams)).toBe('offer-1');
    expect(readLinkedOrderId(new URLSearchParams('order=%20'))).toBeNull();
  });

  it('links an order that stays on Orders even while it is an unpaid checkout (#363)', () => {
    const view = new URL(getMarketplaceOrderViewRoute(ORDER), 'https://shop.test');
    expect(view.pathname).toBe(MARKETPLACE_ROUTES.ORDERS);
    expect(readLinkedOrderId(view.searchParams)).toBe(ORDER);
    expect(readStaysOnOrder(view.searchParams)).toBe(true);
    expect(readStaysOnOrder(new URL(getMarketplaceOrderRoute(ORDER), 'https://shop.test').searchParams)).toBe(false);
  });

  it('still reads links shared before #292', () => {
    expect(readLegacyOrderFragment(`#order-${ORDER}`)).toBe(ORDER);
    expect(readLegacyOrderFragment(`#${ORDER}`)).toBe(ORDER);
    expect(readLegacyOrderFragment(`#order-${encodeURIComponent('a b')}`)).toBe('a b');
    expect(readLegacyOrderFragment('#')).toBeNull();
    expect(readLegacyOfferFragment('#offer-offer-1')).toBe('offer-1');
    expect(readLegacyOfferFragment('#offer-')).toBeNull();
    expect(readLegacyOfferFragment(`#${ORDER}`)).toBeNull();
  });
});
