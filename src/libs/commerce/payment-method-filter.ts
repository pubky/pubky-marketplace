import { z } from 'zod';
import {
  SELLER_PAYMENT_BADGE_LABELS,
  SELLER_PAYMENT_BADGES,
  type SellerPaymentBadge,
} from '@/libs/commerce/payment-badges';
import { commercePubkySchema } from '@/libs/commerce/transaction-contracts';

/** A rail buyers can filter the marketplace by; the same vocabulary as the payment badges. */
export type PaymentMethodFilter = SellerPaymentBadge;

/**
 * One page of `GET /v0/payment-methods/{method}/sellers`: the sellers whose
 * stored configuration has the method enabled (never Paykit readiness, so a
 * degraded Paykit drops nobody). Seller keys only.
 */
export const paymentMethodSellersPageSchema = z.object({
  method: z.enum(SELLER_PAYMENT_BADGES),
  sellers: z.array(commercePubkySchema),
  nextAfter: commercePubkySchema.nullable(),
});

export type PaymentMethodSellersPage = z.infer<typeof paymentMethodSellersPageSchema>;

/** Pages of 500 the Shop reads before it stops widening the seller set. */
export const PAYMENT_METHOD_SELLERS_MAX_PAGES = 4;

/**
 * Sellers whose listings one filter change discovers from Nexus (one
 * `seller_id` stream page each). Past this, the rest of the set filters only
 * what general discovery already cached; a Nexus multi-seller stream
 * parameter lifts the cap (internal/payment-method-filter-design.md).
 */
export const PAYMENT_METHOD_DISCOVERY_SELLER_CAP = 24;

/** Concurrent Nexus reads while discovering a seller set. */
export const PAYMENT_METHOD_DISCOVERY_CONCURRENCY = 4;

/** What the grid says when the seller set for an active filter cannot be read. */
export function paymentFilterUnavailableCopy(method: PaymentMethodFilter): string {
  return `We can't check which sellers accept ${SELLER_PAYMENT_BADGE_LABELS[method]} right now. Try again shortly, or clear the payment filter.`;
}

/** Keeps only the items whose seller is in the set. */
export function filterBySellerSet<T>(items: readonly T[], sellers: ReadonlySet<string>, sellerOf: (item: T) => string) {
  return items.filter((item) => sellers.has(sellerOf(item)));
}
