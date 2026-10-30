'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { orderAmountEntry, orderRefundEntry } from '@/libs/commerce/bitcoin-payment-code';
import { buyerSellerRatings, reviewListingAggregateId, reviewsOfReviewer } from '@/libs/commerce/order-reviews';
import { resolveTrackingCarrierName } from '@/libs/commerce/order-tracking';
import { isUsdtRefundOrder, normalizeArbitrumTxHash } from '@/libs/commerce/usdt-refund';
import { toast } from '@/molecules/Toaster/use-toast';
import type { MarketplaceOrder } from '@/services/marketplace/marketplace';
import {
  formatOrderMajor,
  majorToMinor,
  type MarketplaceOrderActionData,
  marketplaceOrderActionDefaults,
  marketplaceOrderActionSchemaFor,
  paypalRefundedMinor,
  type ReviewItemDraft,
} from './useMarketplaceOrderAction.types';

export function useMarketplaceOrderAction(
  order: MarketplaceOrder,
  actOnOrder: (order: MarketplaceOrder, kind: string, payload: Record<string, unknown>) => Promise<boolean>,
) {
  const refundedMinor = paypalRefundedMinor(order);
  const entry = orderAmountEntry(order);
  const refundEntry = orderRefundEntry(order);
  const isUsdt = isUsdtRefundOrder(order);
  const rail = isUsdt ? 'usdt' : order.paymentMethod === 'paypal' ? 'paypal' : 'other';
  const form = useForm<MarketplaceOrderActionData>({
    resolver: zodResolver(marketplaceOrderActionSchemaFor(refundEntry, refundedMinor, rail)),
    defaultValues: marketplaceOrderActionDefaults,
    mode: 'onChange',
  });

  const setAction = (
    action: MarketplaceOrderActionData['action'],
    overrides: Partial<MarketplaceOrderActionData> = {},
  ) => {
    form.reset({
      ...marketplaceOrderActionDefaults,
      action,
      amount:
        action === 'refund'
          ? formatOrderMajor({
              amountMinor: Math.max(0, refundEntry.amountMinor - refundedMinor),
              exponent: refundEntry.exponent,
            })
          : formatOrderMajor(entry),
      ...overrides,
    });
  };

  const submit = async (): Promise<boolean> => {
    let succeeded = false;
    await form.handleSubmit(async (data) => {
      switch (data.action) {
        case 'cancel':
          succeeded = await actOnOrder(order, 'order.cancel_request', { reason: data.reason });
          break;
        case 'ship':
          // The service's `carrier` field is a structured free string; the
          // curated select writes the registry's canonical display name into
          // it (resolvable back to a tracking link on the buyer side), and
          // "Other" passes the seller's own carrier name through verbatim, or
          // `Other` when none was given. The tracking number is optional: a
          // blank one is left out and added later with
          // `fulfillment.update_tracking`.
          succeeded = await actOnOrder(order, 'fulfillment.ship', {
            carrier: resolveTrackingCarrierName(data.carrierChoice, data.carrier),
            ...(data.trackingNumber ? { trackingNumber: data.trackingNumber } : {}),
          });
          break;
        case 'return':
          succeeded = await actOnOrder(order, 'return.request', {
            reason: data.reason,
            requestedAmountMinor: majorToMinor(data.amount, entry.exponent),
          });
          break;
        case 'refund':
          // The record replaces PayPal's running sum, so it carries the
          // recorded total, never below what PayPal already refunded.
          succeeded = await actOnOrder(order, 'refund.record_external', {
            amountMinor: refundedMinor + majorToMinor(data.amount, refundEntry.exponent),
            transactionId: isUsdt ? normalizeArbitrumTxHash(data.transactionId) : data.transactionId,
          });
          break;
        case 'review':
          if (data.reviewItems.length > 0) {
            succeeded = await actOnOrder(order, 'review.create', {
              items: reviewItemTerms(data.reviewItems),
              ...sellerRatingTerms(data),
              // D2 both-sides consent: this is only half the gate — the
              // service includes a band only when the seller also consented.
              allowAmountBand: data.allowAmountBand,
            });
            break;
          }
          succeeded = await actOnOrder(order, 'review.create', {
            rating: Number(data.rating),
            text: data.text,
            allowAmountBand: data.allowAmountBand,
          });
          break;
        case 'review_edit': {
          // Durable service only (24h edit window). `actOnOrder` sources
          // `expected_revision` from the loaded order. A revision conflict
          // re-reads the order and succeeds when that review is already there.
          if (data.reviewItems.length === 0) {
            succeeded = await actOnOrder(order, 'review.update', {
              rating: Number(data.rating),
              text: data.text,
            });
            break;
          }
          // Only the listings whose stars or text changed are sent, so an
          // edit revises only those records. The service takes seller
          // ratings with at least one item, so a seller-only change sends the
          // first, unchanged.
          const own = reviewsOfReviewer(order, order.buyerPubky);
          const changed = data.reviewItems.filter((item) => {
            const current = own.find(
              (review) => reviewListingAggregateId(order, review) === `listing:${order.sellerPubky}_${item.listingId}`,
            );
            return current === undefined || current.rating !== Number(item.rating) || current.text !== item.text;
          });
          const rated = buyerSellerRatings(order);
          const seller = sellerRatingTerms(data);
          const sellerChanged =
            seller.seller !== undefined &&
            (rated?.shipping !== seller.seller.shipping || rated?.communication !== seller.seller.communication);
          if (changed.length === 0 && !sellerChanged) {
            toast({ variant: 'info', description: 'Nothing changed in your review.' });
            succeeded = true;
            break;
          }
          succeeded = await actOnOrder(order, 'review.update', {
            items: reviewItemTerms(changed.length > 0 ? changed : data.reviewItems.slice(0, 1)),
            ...(sellerChanged ? seller : {}),
          });
          break;
        }
      }
    })();
    return succeeded;
  };

  return { form, setAction, submit };
}

function reviewItemTerms(items: ReviewItemDraft[]) {
  return items.map(({ listingId, rating, text }) => ({ listingId, rating: Number(rating), text }));
}

/** The seller ratings of a review form: both or neither (the schema refuses one alone). */
function sellerRatingTerms(data: MarketplaceOrderActionData) {
  return data.sellerShipping === ''
    ? {}
    : { seller: { shipping: Number(data.sellerShipping), communication: Number(data.sellerCommunication) } };
}
