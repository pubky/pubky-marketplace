import { canonicalCountryCode } from './postal-address';
import type { ShippingQuote, ShippingZone } from './shipping-zones';
import { quoteAllShippingRates, shippedCountries } from './shipping-zones';

export type ListingShippingPreview = {
  /** Countries the listing ships to; `null` when it ships to the rest of the world. */
  countries: string[] | null;
  /** The rates for one unit to the viewer's country, when it is known: quotes, or `null` when no zone serves it. */
  destination: { country: string; quotes: ShippingQuote[] | null } | null;
};

/**
 * What a product page shows for a zone-priced listing: where it ships and, once the viewer's country is known,
 * the rate for one unit. Nothing here is a commitment: checkout prices the whole group and pins it.
 */
export function previewListingShipping(
  zones: readonly ShippingZone[],
  excludedCountries: readonly string[],
  viewerCountry: string | null,
  shopCountries: readonly string[] | null = null,
): ListingShippingPreview {
  const shop = shopCountries === null ? null : shopCountries.map(canonicalCountryCode);
  const zoned = shippedCountries(zones, excludedCountries);
  // A shop that lists where it ships narrows every listing: checkout refuses anything outside the list.
  const countries =
    shop === null ? zoned : zoned === null ? [...shop] : zoned.filter((country) => shop.includes(country));
  const country = viewerCountry === null ? '' : canonicalCountryCode(viewerCountry);
  if (!/^[A-Z]{2}$/.test(country)) return { countries, destination: null };
  if (shop !== null && !shop.includes(country)) return { countries, destination: { country, quotes: null } };
  const quotes = quoteAllShippingRates(zones, excludedCountries, country, 1);
  return { countries, destination: { country, quotes: quotes.ok ? quotes.value : null } };
}
