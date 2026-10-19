import { COMMERCE_LISTING_MAX_QUANTITY } from '@/config/commerce';

/** The money shape of a record's variant price. */
export interface ListingVariantMoney {
  amountMinor: number;
  currency: string;
  exponent: number;
}

/** The slice of a record variant that stock and price logic reads. */
export interface ListingVariantStockInput {
  id: string;
  sku?: string;
  quantity: number;
  enabled: boolean;
  priceOverride?: ListingVariantMoney;
}

/** One enabled variant as `listing.register` carries it. */
export interface RegisterListingVariant {
  id: string;
  quantity: number;
  sku?: string;
  /** The variant's own price, when it differs from the listing's. */
  unitPrice?: ListingVariantMoney;
}

/** One size's availability as the service serves it: no quantity on the public read. */
export interface ProjectedVariantAvailability {
  variantId: string;
  soldOut: boolean;
  /** The seller's store sells this size without a stock count (print-on-demand): never sold out. */
  madeToOrder?: boolean;
}

/** The service's view of a listing's stock that the sold-out logic reads. */
export interface ServiceListingAvailability {
  state: string;
  /** Present and true while any offered size is made to order. */
  madeToOrder?: boolean;
  variants?: readonly ProjectedVariantAvailability[] | null;
}

const NONE: ReadonlySet<string> = new Set();

/** How a made-to-order listing or size reads to a buyer in place of a stock count. */
export const MADE_TO_ORDER_LABEL = 'Made to order';

/** The smallest number of enabled variants the service tracks per size. */
export const VARIANT_TRACKING_MIN_ENABLED = 2;

/** True when the record offers two or more enabled variants, which the service tracks per size. */
export function tracksVariantStock(variants: readonly ListingVariantStockInput[]): boolean {
  return variants.filter((variant) => variant.enabled).length >= VARIANT_TRACKING_MIN_ENABLED;
}

/**
 * The `variants` a `listing.register` carries: the enabled variants in
 * record order, when the record offers two or more or an enabled variant sells
 * at its own price. Otherwise the listing registers one implicit row at its
 * own price exactly as before, so the field is omitted. The listing
 * `quantity` stays the sum of every record variant and is not built here.
 */
export function buildRegisterVariants(
  variants: readonly ListingVariantStockInput[],
): RegisterListingVariant[] | undefined {
  const enabled = variants.filter((variant) => variant.enabled);
  if (!tracksVariantStock(variants) && !enabled.some((variant) => variant.priceOverride)) return undefined;
  return enabled.map((variant) => ({
    id: variant.id,
    quantity: Math.min(variant.quantity, COMMERCE_LISTING_MAX_QUANTITY),
    ...(variant.sku ? { sku: variant.sku } : {}),
    ...(variant.priceOverride
      ? {
          unitPrice: {
            amountMinor: variant.priceOverride.amountMinor,
            currency: variant.priceOverride.currency,
            exponent: variant.priceOverride.exponent,
          },
        }
      : {}),
  }));
}

/** The ids the service reports sold out; empty when it reports no per-size rows. */
export function soldOutVariantIds(
  variants: readonly ProjectedVariantAvailability[] | undefined | null,
): ReadonlySet<string> {
  return new Set((variants ?? []).filter((variant) => variant.soldOut).map((variant) => variant.variantId));
}

/**
 * The sizes a listing's projection or public read reports sold out. The
 * service flags a size once it has no free unit, held units included, so
 * while the listing is held (`reserved`) a flag cannot tell a sold size from a
 * held one and none is taken as sold out.
 */
export function listingSoldOutVariantIds(
  availability: { state: string; variants?: readonly ProjectedVariantAvailability[] | null } | null | undefined,
): ReadonlySet<string> {
  if (!availability || availability.state === 'reserved') return new Set();
  return soldOutVariantIds(availability.variants);
}

/**
 * The sizes the service sells made to order. A listing that sells one variant
 * reports it on the listing only, so then every record variant is made to order.
 */
export function madeToOrderVariantIds(
  availability: ServiceListingAvailability | null | undefined,
  variants: readonly Pick<ListingVariantStockInput, 'id'>[],
): ReadonlySet<string> {
  if (!availability) return NONE;
  const rows = availability.variants ?? [];
  if (rows.length > 0) return new Set(rows.filter((row) => row.madeToOrder === true).map((row) => row.variantId));
  return availability.madeToOrder === true ? new Set(variants.map((variant) => variant.id)) : NONE;
}

/**
 * A size is sold out when the service says so or the seller's record has none
 * left. A made-to-order size is never sold out: its record quantity is not a count.
 */
export function isVariantSoldOut(
  variant: ListingVariantStockInput,
  serviceSoldOut: ReadonlySet<string>,
  madeToOrder: ReadonlySet<string> = NONE,
): boolean {
  if (madeToOrder.has(variant.id)) return false;
  return variant.quantity === 0 || serviceSoldOut.has(variant.id);
}

/**
 * True when the listing offers sizes and every offered size is sold out. A
 * listing with no enabled variant is not judged here.
 */
export function everyOfferedVariantSoldOut(
  variants: readonly ListingVariantStockInput[],
  serviceSoldOut: ReadonlySet<string>,
  madeToOrder: ReadonlySet<string> = NONE,
): boolean {
  const offered = variants.filter((variant) => variant.enabled);
  return offered.length > 0 && offered.every((variant) => isVariantSoldOut(variant, serviceSoldOut, madeToOrder));
}

/** The first size a buyer can pick: enabled and not sold out. */
export function firstAvailableVariantId(
  variants: readonly ListingVariantStockInput[],
  serviceSoldOut: ReadonlySet<string>,
  madeToOrder: ReadonlySet<string> = NONE,
): string | undefined {
  return variants.find((variant) => variant.enabled && !isVariantSoldOut(variant, serviceSoldOut, madeToOrder))?.id;
}

/**
 * The listing reads sold out from the service's own view: its state, a zero
 * listing quantity, or every size reported sold out. A held listing
 * (`reserved`) keeps reading as held. A made-to-order listing has no count, so
 * its zero quantity is not sold out.
 */
export function projectionReadsSoldOut(
  projection: ServiceListingAvailability & { availableQuantity?: number },
): boolean {
  if (projection.state === 'sold') return true;
  if (projection.madeToOrder === true) return false;
  if (projection.state === 'available' && projection.availableQuantity === 0) return true;
  const rows = projection.variants ?? [];
  return projection.state === 'available' && rows.length > 0 && rows.every((row) => row.soldOut);
}
