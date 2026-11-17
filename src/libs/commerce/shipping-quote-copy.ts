import type { ShippingQuoteErrorCode } from './shipping-zones';

/** What a refused quote means for one shipping group, in words the buyer can act on. */
export function groupQuoteRefusalCopy(code: ShippingQuoteErrorCode): string {
  switch (code) {
    case 'SHIPPING_UNAVAILABLE_TO_COUNTRY':
      return 'This seller does not ship to your country.';
    case 'INVALID_DESTINATION':
      return 'The delivery country is not a valid two-letter country code.';
    case 'INVALID_QUANTITY':
      return 'This quantity cannot be shipped in one parcel. Lower the quantity or split the order.';
    case 'SHIPPING_OVERFLOW':
      return 'The shipping price for this quantity is too large to charge. Lower the quantity.';
    case 'UNKNOWN_SHIPPING_RATE':
      return 'The shipping rate you chose is no longer offered. Choose another.';
  }
}

/** The same refusal as a message about the whole order. */
export function orderQuoteRefusalCopy(code: ShippingQuoteErrorCode): string {
  return code === 'SHIPPING_UNAVAILABLE_TO_COUNTRY'
    ? 'A seller in your cart does not ship to that country. Choose another address or remove their items.'
    : `Shipping cannot be priced yet. ${groupQuoteRefusalCopy(code)}`;
}
