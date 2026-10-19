import { COMMERCE_CART_STOCK_MIN_INTERVAL_MS, COMMERCE_CART_STOCK_READS_PER_MINUTE } from '@/config/commerce';
import {
  everyOfferedVariantSoldOut,
  isVariantSoldOut,
  listingSoldOutVariantIds,
  type ListingVariantStockInput,
  madeToOrderVariantIds,
  type ProjectedVariantAvailability,
  projectionReadsSoldOut,
  tracksVariantStock,
} from '@/libs/commerce/listing-variants';

/** Why a cart line cannot be bought: the whole listing, or only the size in the cart. */
export type CartLineStock = 'listing_sold_out' | 'variant_sold_out';

/** The service's public availability for one listing, as the cart reads it. */
export interface CartListingAvailability {
  state: string;
  madeToOrder?: boolean;
  variants?: readonly ProjectedVariantAvailability[] | null;
}

export const SOLD_OUT_COPY = {
  listingSoldOut: 'Sold out',
  variantSoldOut: 'This size is sold out',
  cartBlocked: 'Remove sold-out items to check out.',
  payBlocked: 'Remove sold-out items from your cart to pay.',
} as const;

/** How often the cart rereads stock for this many listings, one read per listing a pass. */
export function cartStockPollIntervalMs(listingCount: number): number {
  return Math.max(
    COMMERCE_CART_STOCK_MIN_INTERVAL_MS,
    Math.ceil((listingCount * 60_000) / COMMERCE_CART_STOCK_READS_PER_MINUTE),
  );
}

export function cartLineStockLabel(stock: CartLineStock): string {
  return stock === 'listing_sold_out' ? SOLD_OUT_COPY.listingSoldOut : SOLD_OUT_COPY.variantSoldOut;
}

/**
 * A line is sold out when the service reads the listing sold out, or when its
 * size is sold out by the service or by the seller's record. A listing without
 * sizes, or with every size gone, reads sold out as a whole. Null while the
 * service has not answered and the record still has the size in stock.
 */
export function cartLineStock(
  variants: readonly ListingVariantStockInput[],
  variantId: string,
  availability: CartListingAvailability | null | undefined,
): CartLineStock | null {
  if (availability && projectionReadsSoldOut(availability)) return 'listing_sold_out';
  const serviceSoldOut = listingSoldOutVariantIds(availability);
  const madeToOrder = madeToOrderVariantIds(availability, variants);
  const variant = variants.find(({ id }) => id === variantId);
  if (!variant || !isVariantSoldOut(variant, serviceSoldOut, madeToOrder)) return null;
  return tracksVariantStock(variants) && !everyOfferedVariantSoldOut(variants, serviceSoldOut, madeToOrder)
    ? 'variant_sold_out'
    : 'listing_sold_out';
}
