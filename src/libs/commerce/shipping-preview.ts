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
): ListingShippingPreview {
  const countries = shippedCountries(zones, excludedCountries);
  const country = viewerCountry === null ? '' : canonicalCountryCode(viewerCountry);
  if (!/^[A-Z]{2}$/.test(country)) return { countries, destination: null };
  const quotes = quoteAllShippingRates(zones, excludedCountries, country, 1);
  return { countries, destination: { country, quotes: quotes.ok ? quotes.value : null } };
}
