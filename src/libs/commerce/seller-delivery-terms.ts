import { COMMERCE_DEFAULT_AUTO_COMPLETE_DAYS, COMMERCE_DEFAULT_DELIVERY_ASSUME_DAYS } from '@/config/commerce';

/** The post-purchase periods a buyer is shown for one seller, in whole days. */
export interface SellerDeliveryTerms {
  deliveryAssumeDays: number;
  autoCompleteDays: number;
}

type ShopTermFields = { deliveryAssumeDays?: number; autoCompleteDays?: number };

/**
 * The periods a seller's shop record sets, with the service defaults filling
 * only the fields the seller left unset. A seller with no shop record at all
 * reads as both unset.
 */
export function resolveSellerDeliveryTerms(shop: ShopTermFields | null | undefined): SellerDeliveryTerms {
  return {
    deliveryAssumeDays: shop?.deliveryAssumeDays ?? COMMERCE_DEFAULT_DELIVERY_ASSUME_DAYS,
    autoCompleteDays: shop?.autoCompleteDays ?? COMMERCE_DEFAULT_AUTO_COMPLETE_DAYS,
  };
}

export function formatTermDays(days: number): string {
  return days === 1 ? '1 day' : `${days} days`;
}

/** The buyer-facing statement of when delivery is assumed and the order completes. */
export function sellerDeliveryTermsCopy(terms: SellerDeliveryTerms): string {
  return `Delivery is assumed after ${formatTermDays(terms.deliveryAssumeDays)}; the order completes ${formatTermDays(terms.autoCompleteDays)} after delivery unless you open a return.`;
}

export function sellerDeliveryTermsEqual(a: SellerDeliveryTerms, b: SellerDeliveryTerms): boolean {
  return a.deliveryAssumeDays === b.deliveryAssumeDays && a.autoCompleteDays === b.autoCompleteDays;
}
