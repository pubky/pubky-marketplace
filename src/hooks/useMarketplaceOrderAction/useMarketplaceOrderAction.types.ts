import { z } from 'zod';
import { COMMERCE_REVIEW_TEXT_MAX_CHARS } from '@/config/commerce';
import { SHIPPING_CARRIERS } from '@/libs/commerce/carriers';
import {
  buyerSellerRatings,
  orderReviewListings,
  type OrderReviewSource,
  reviewListingAggregateId,
  reviewsOfReviewer,
  unreviewedListings,
} from '@/libs/commerce/order-reviews';
import { isArbitrumTxHash, USDT_REFUND_COPY } from '@/libs/commerce/usdt-refund';

const carrierIds = SHIPPING_CARRIERS.map(({ id }) => id) as [string, ...string[]];

const REVIEW_STARS = /^[1-5]$/;

/** One listing of the order in the buyer's review: stars are required, text is optional. */
const reviewItemDraftSchema = z.object({
  listingId: z.string(),
  title: z.string(),
  rating: z.string().trim(),
  text: z.string().trim().max(COMMERCE_REVIEW_TEXT_MAX_CHARS),
});

export type ReviewItemDraft = z.infer<typeof reviewItemDraftSchema>;

export const marketplaceOrderActionSchema = z
  .object({
    action: z.enum(['cancel', 'ship', 'return', 'refund', 'review', 'review_edit']),
    reason: z.string().trim().max(2_000),
    /** Curated carrier id from the registry, or `other` with a free-text name below. */
    carrierChoice: z.enum(carrierIds),
    carrier: z.string().trim().max(100),
    trackingNumber: z.string().trim().max(200),
    amount: z.string().trim(),
    transactionId: z.string().trim().max(200),
    /** The v1 rating and text a seller gives the buyer (and any review while `reviewItems` is empty). */
    rating: z.string().trim(),
    text: z.string().trim().max(COMMERCE_REVIEW_TEXT_MAX_CHARS),
    /** The buyer's per-listing reviews (per-item terms); empty for the v1 review. */
    reviewItems: z.array(reviewItemDraftSchema),
    /** The buyer's optional seller ratings; both or neither, empty meaning unrated. */
    sellerShipping: z.string().trim(),
    sellerCommunication: z.string().trim(),
    /**
     * Buyer-side amount-band opt-in (ratified D2): rendered only when the
     * seller's standing consent allows bands at all; the attestation carries
     * a band only when both sides agreed.
     */
    allowAmountBand: z.boolean(),
  })
  .superRefine((data, context) => {
    if (['cancel', 'return'].includes(data.action) && !data.reason) {
      context.addIssue({ code: 'custom', path: ['reason'], message: 'Reason is required.' });
    }
    if (data.action === 'refund') {
      // Up to six decimals here (USDT millionths); `marketplaceOrderActionSchemaFor` caps them at the order's units.
      if (!/^\d+(?:\.\d{1,6})?$/.test(data.amount)) {
        context.addIssue({ code: 'custom', path: ['amount'], message: 'Enter a valid refund amount.' });
      }
    }
    if (!['review', 'review_edit'].includes(data.action)) return;
    if (data.reviewItems.length === 0) {
      if (!REVIEW_STARS.test(data.rating)) {
        context.addIssue({ code: 'custom', path: ['rating'], message: 'Choose a rating.' });
      }
      if (!data.text) {
        context.addIssue({ code: 'custom', path: ['text'], message: 'Review text is required.' });
      }
      return;
    }
    data.reviewItems.forEach((item, index) => {
      if (!REVIEW_STARS.test(item.rating)) {
        context.addIssue({ code: 'custom', path: ['reviewItems', index, 'rating'], message: 'Choose a rating.' });
      }
    });
    const sellerRated = data.sellerShipping !== '' || data.sellerCommunication !== '';
    if (sellerRated && (!REVIEW_STARS.test(data.sellerShipping) || !REVIEW_STARS.test(data.sellerCommunication))) {
      context.addIssue({
        code: 'custom',
        path: ['sellerCommunication'],
        message: 'Rate both shipping and communication, or leave both blank.',
      });
    }
  });

export type MarketplaceOrderActionData = z.infer<typeof marketplaceOrderActionSchema>;

/** The amount the refund dialog is capped against. The service stores one partial refund when `1 <= amount_minor <= cap`. */
export type MarketplaceRefundCap = {
  amountMinor: number;
  exponent: number;
};

export function majorToMinor(amount: string, exponent: number): number {
  return Math.round(Number(amount) * 10 ** exponent);
}

export function formatOrderMajor(total: MarketplaceRefundCap): string {
  return (total.amountMinor / 10 ** total.exponent).toFixed(Math.max(0, total.exponent));
}

/**
 * Same action schema, plus the service rules for `refund.record_external`.
 * The entered amount is what has not been recorded yet: the whole refund,
 * or what was refunded outside PayPal after PayPal refunds (`refundedMinor`).
 * The recorded total, `refundedMinor` plus the entry, must be positive and
 * at most `total`: the order total, or for a USDT order the USDT it received.
 */
export function marketplaceOrderActionSchemaFor(
  total: MarketplaceRefundCap,
  refundedMinor = 0,
  rail: 'paypal' | 'usdt' | 'other' = 'other',
) {
  return marketplaceOrderActionSchema.superRefine((data, context) => {
    if (data.action !== 'refund') return;
    // A USDT refund is recorded with the Arbitrum transaction hash, which the
    // service checks as `0x` + 64 hex; any other rail takes free evidence.
    if (rail === 'usdt') {
      if (!isArbitrumTxHash(data.transactionId)) {
        context.addIssue({ code: 'custom', path: ['transactionId'], message: USDT_REFUND_COPY.referenceRequired });
      }
    } else if (data.transactionId.length < 8) {
      context.addIssue({ code: 'custom', path: ['transactionId'], message: 'Transaction evidence is required.' });
    }
    if (!/^\d+(?:\.\d{1,6})?$/.test(data.amount)) return;
    if (!new RegExp(`^\\d+(?:\\.\\d{1,${Math.max(total.exponent, 2)}})?$`).test(data.amount)) {
      context.addIssue({ code: 'custom', path: ['amount'], message: 'Enter a valid refund amount.' });
      return;
    }
    if (total.exponent === 0 && !/^\d+$/.test(data.amount)) {
      context.addIssue({ code: 'custom', path: ['amount'], message: 'Enter a whole number.' });
      return;
    }
    const amountMinor = majorToMinor(data.amount, total.exponent);
    if (refundedMinor === 0 && amountMinor <= 0) {
      context.addIssue({ code: 'custom', path: ['amount'], message: 'Enter a valid refund amount.' });
      return;
    }
    if (!Number.isSafeInteger(amountMinor) || refundedMinor + amountMinor > total.amountMinor) {
      context.addIssue({
        code: 'custom',
        path: ['amount'],
        message:
          rail === 'usdt'
            ? 'Enter a refund up to the USDT received.'
            : refundedMinor === 0
              ? 'Enter a refund up to the order total.'
              : rail === 'paypal'
                ? 'Enter a refund up to the amount PayPal has not refunded.'
                : 'Enter a refund up to the amount not yet recorded.',
      });
    }
  });
}

/**
 * What PayPal refund notifications already recorded on an order the seller
 * can still record a refund on. A seller's own record always moves the order
 * to `refunded_external`, so an `externalRefund` on `return_received` or
 * `cancelled` is PayPal's running sum.
 */
export function paypalRefundedMinor(order: { externalRefund?: { amountMinor: number } | null }): number {
  return order.externalRefund?.amountMinor ?? 0;
}

export const marketplaceOrderActionDefaults: MarketplaceOrderActionData = {
  action: 'cancel',
  reason: '',
  carrierChoice: 'usps',
  carrier: '',
  trackingNumber: '',
  amount: '',
  transactionId: '',
  rating: '5',
  text: '',
  reviewItems: [],
  sellerShipping: '',
  sellerCommunication: '',
  allowAmountBand: false,
};

/** Stars a listing starts at in the review dialog. */
export const REVIEW_DEFAULT_RATING = '5';

/**
 * The buyer's review dialog, as form overrides. A new review lists the
 * listings not reviewed yet; an edit lists the reviewed ones with their
 * stars and text, and the seller ratings already given. When the order
 * already carries seller ratings, a review that only adds listings leaves
 * them alone (the service copies them onto the new records), so the
 * dialog does not ask again.
 */
export function buyerReviewFormValues(
  order: OrderReviewSource,
  mode: 'review' | 'review_edit',
): Pick<MarketplaceOrderActionData, 'reviewItems' | 'sellerShipping' | 'sellerCommunication'> {
  const rated = buyerSellerRatings(order);
  if (mode === 'review') {
    return {
      reviewItems: unreviewedListings(order).map(({ listingId, title }) => ({
        listingId,
        title,
        rating: REVIEW_DEFAULT_RATING,
        text: '',
      })),
      sellerShipping: '',
      sellerCommunication: '',
    };
  }
  const own = reviewsOfReviewer(order, order.buyerPubky);
  return {
    reviewItems: orderReviewListings(order).flatMap(({ listingAggregateId, listingId, title }) => {
      const review = own.find((candidate) => reviewListingAggregateId(order, candidate) === listingAggregateId);
      return review === undefined ? [] : [{ listingId, title, rating: String(review.rating), text: review.text }];
    }),
    sellerShipping: rated === null ? '' : String(rated.shipping),
    sellerCommunication: rated === null ? '' : String(rated.communication),
  };
}
