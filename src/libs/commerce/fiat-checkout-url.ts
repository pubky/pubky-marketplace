/**
 * Origins a bound order's `fiatCheckoutUrl` may send the buyer to. They are
 * the two hosts marketplace-service accepts for `PAYPAL_CHECKOUT_URL`, which
 * is the only source of the URL; the Shop checks again so a response that
 * names any other page is refused instead of followed.
 */
export const FIAT_CHECKOUT_ORIGINS: ReadonlySet<string> = new Set([
  'https://www.paypal.com',
  'https://www.sandbox.paypal.com',
]);

export const PAYPAL_CHECKOUT_URL_REFUSED_COPY =
  'PayPal checkout can\u2019t open: the payment link for this order doesn\u2019t point to PayPal. Cancel the order and check out again.';

/**
 * The URL to open for hosted fiat checkout, or null when it is missing, not
 * absolute, not `https:`, or on an origin outside {@link FIAT_CHECKOUT_ORIGINS}.
 */
export function trustedFiatCheckoutUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || !FIAT_CHECKOUT_ORIGINS.has(parsed.origin)) return null;
  return parsed.href;
}
