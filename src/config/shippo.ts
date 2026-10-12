/**
 * The Shippo REST API, called straight from the seller's browser with the
 * seller's own token (design: docs/ecommerce/encrypted-delivery-address-design.md §F).
 * Shippo answers CORS preflights for any origin with an `Authorization`
 * header, so no proxy is involved and the marketplace service never sees the
 * token or the delivery address.
 */
export const SHIPPO_API_BASE = 'https://api.goshippo.com';
