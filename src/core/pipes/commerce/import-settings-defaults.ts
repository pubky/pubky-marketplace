import { type CommerceListingRecord, type CommerceShopRecord } from '@/libs/commerce/marketplace-records';
import { DEFAULT_SHOP_COUNTRY_CODE } from './default-shop';
import { currencyExponent, type ImportShipping } from './import-settings';

/**
 * What the dry run can prefill from the seller's own Shop data, so the import
 * never invents a shipping option or a country.
 */

/**
 * The country the seller's shop is in, or `null` when the shop never said.
 * A shop record at revision 1 was written by the Shop itself (the default
 * shop, built on first selling), and its country is the Shop's fallback
 * unless it came from a listing; the seller's first settings save is
 * revision 2 or later.
 */
export function shopCountryForImport(shop: Pick<CommerceShopRecord, 'revision' | 'location'> | null): string | null {
  if (!shop) return null;
  const code = shop.location.countryCode;
  if (shop.revision >= 2) return code;
  return code === DEFAULT_SHOP_COUNTRY_CODE ? null : code;
}

export type ImportShippingDefault = {
  readonly shipping: ImportShipping;
  /** The currency of the listing it came from, so a flat price keeps its meaning. */
  readonly currency: string;
};

/**
 * The shipping option of the seller's most recently updated listing that has
 * a free or flat one. The Shop's shop settings hold only a free-text shipping
 * policy, so an existing listing is the seller's own structured choice.
 */
export function shippingDefaultFromListings(
  records: readonly Pick<CommerceListingRecord, 'updatedAt' | 'sale' | 'shippingOptions'>[],
): ImportShippingDefault | null {
  const newestFirst = [...records].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  for (const record of newestFirst) {
    const unit = record.sale.format === 'fixed_price' ? record.sale.unitPrice : record.sale.startingPrice;
    for (const option of record.shippingOptions ?? []) {
      const days = { minDays: option.estimatedMinDays, maxDays: option.estimatedMaxDays };
      if (option.pricing === 'free') return { shipping: { mode: 'free', ...days }, currency: unit.currency };
      if (
        option.pricing === 'flat' &&
        option.price.currency === unit.currency &&
        option.price.exponent === currencyExponent(unit.currency) &&
        option.price.amountMinor > 0
      ) {
        return {
          shipping: { mode: 'flat', priceMinor: option.price.amountMinor, ...days },
          currency: option.price.currency,
        };
      }
    }
  }
  return null;
}
