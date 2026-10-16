import { COMMERCE_LISTING_MAX_QUANTITY } from '@/config/commerce';

/** The slice of a record variant that stock logic reads. */
export interface ListingVariantStockInput {
  id: string;
  sku?: string;
  quantity: number;
  enabled: boolean;
}

/** One enabled variant as `listing.register` carries it. */
export interface RegisterListingVariant {
  id: string;
  quantity: number;
  sku?: string;
}

/** One size's availability as the service serves it: no quantity on the public read. */
export interface ProjectedVariantAvailability {
  variantId: string;
  soldOut: boolean;
}

/** The smallest number of enabled variants the service tracks per size. */
export const VARIANT_TRACKING_MIN_ENABLED = 2;

/** True when the record offers two or more enabled variants, which the service tracks per size. */
export function tracksVariantStock(variants: readonly ListingVariantStockInput[]): boolean {
  return variants.filter((variant) => variant.enabled).length >= VARIANT_TRACKING_MIN_ENABLED;
}

/**
 * The `variants` a `listing.register` carries: the enabled variants in record
 * order, only when the record offers two or more. Fewer than two registers
 * one implicit row exactly as before, so the field is omitted. The listing
 * `quantity` stays the sum of every record variant and is not built here.
 */
export function buildRegisterVariants(
  variants: readonly ListingVariantStockInput[],
): RegisterListingVariant[] | undefined {
  if (!tracksVariantStock(variants)) return undefined;
  return variants
    .filter((variant) => variant.enabled)
    .map((variant) => ({
      id: variant.id,
      quantity: Math.min(variant.quantity, COMMERCE_LISTING_MAX_QUANTITY),
      ...(variant.sku ? { sku: variant.sku } : {}),
    }));
}

/** The ids the service reports sold out; empty when it reports no per-size rows. */
export function soldOutVariantIds(
  variants: readonly ProjectedVariantAvailability[] | undefined | null,
): ReadonlySet<string> {
  return new Set((variants ?? []).filter((variant) => variant.soldOut).map((variant) => variant.variantId));
}

/** A size is sold out when the service says so or the seller's record has none left. */
export function isVariantSoldOut(variant: ListingVariantStockInput, serviceSoldOut: ReadonlySet<string>): boolean {
  return variant.quantity === 0 || serviceSoldOut.has(variant.id);
}

/**
 * True when the listing offers sizes and every offered size is sold out. A
 * listing with no enabled variant is not judged here.
 */
export function everyOfferedVariantSoldOut(
  variants: readonly ListingVariantStockInput[],
  serviceSoldOut: ReadonlySet<string>,
): boolean {
  const offered = variants.filter((variant) => variant.enabled);
  return offered.length > 0 && offered.every((variant) => isVariantSoldOut(variant, serviceSoldOut));
}

/** The first size a buyer can pick: enabled and not sold out. */
export function firstAvailableVariantId(
  variants: readonly ListingVariantStockInput[],
  serviceSoldOut: ReadonlySet<string>,
): string | undefined {
  return variants.find((variant) => variant.enabled && !isVariantSoldOut(variant, serviceSoldOut))?.id;
}

/**
 * The listing reads sold out from the service's own view: its state, a zero
 * listing quantity, or every size reported sold out. A held listing
 * (`reserved`) keeps reading as held.
 */
export function projectionReadsSoldOut(projection: {
  state: string;
  availableQuantity?: number;
  variants?: readonly ProjectedVariantAvailability[] | null;
}): boolean {
  if (projection.state === 'sold') return true;
  if (projection.state === 'available' && projection.availableQuantity === 0) return true;
  const rows = projection.variants ?? [];
  return projection.state === 'available' && rows.length > 0 && rows.every((row) => row.soldOut);
}
