import type { SellerPaymentConfig } from '@/libs/commerce/payment-methods';

/** The rails a buyer sees as badges on a listing or storefront, in display order. */
export const SELLER_PAYMENT_BADGES = ['bitcoin', 'usdt', 'paypal'] as const;
export type SellerPaymentBadge = (typeof SELLER_PAYMENT_BADGES)[number];

export const SELLER_PAYMENT_BADGE_LABELS: Record<SellerPaymentBadge, string> = {
  bitcoin: 'Bitcoin',
  usdt: 'USDT',
  paypal: 'PayPal',
};

/**
 * The rails a seller accepts, from the public payment config
 * (`GET /v0/sellers/{pubky}/payment-config`). Unlike checkout this ignores
 * the rail-wide `bitcoinOfferAvailable` gate: a Paykit outage is not a
 * property of the seller, and checkout explains it when the buyer pays.
 *
 * - PayPal is a stored merchant email, so the read is authoritative.
 * - Bitcoin and USDT come from the service's Paykit readiness lookups. While
 *   Paykit is degraded (`bitcoinOfferAvailable` false, or `/health` says the
 *   rail is unreachable) a `false` may only mean "could not ask", so a badge
 *   in `previous` (the last resolved set this session) is held instead of
 *   dropped. A seller first seen while degraded shows no Paykit badge: the
 *   Shop never claims a rail it could not confirm.
 * - USDT needs the caller's gate (`usdtPaymentsAvailable`: Shop flag AND
 *   service capability). `false` hides it; `null` (capability unreadable)
 *   keeps the service's answer or, failing that, the held badge.
 */
export function resolveSellerPaymentBadges(
  config: SellerPaymentConfig,
  {
    usdtPaymentsAvailable,
    previous,
  }: { usdtPaymentsAvailable: boolean | null; previous?: readonly SellerPaymentBadge[] },
): SellerPaymentBadge[] {
  const paykitDegraded = !config.bitcoinOfferAvailable || config.paykitUnreachable === true;
  const wasShown = (badge: SellerPaymentBadge) => previous?.includes(badge) === true;
  const bitcoinNow = config.acceptedAssets ? config.acceptedAssets.includes('BTC') : config.bitcoinAvailable;
  const usdtNow = config.acceptedAssets ? config.acceptedAssets.includes('USDT') : config.usdtAvailable === true;
  const shown: Record<SellerPaymentBadge, boolean> = {
    bitcoin: bitcoinNow || (paykitDegraded && wasShown('bitcoin')),
    usdt:
      usdtPaymentsAvailable === false
        ? false
        : usdtNow || ((paykitDegraded || usdtPaymentsAvailable === null) && wasShown('usdt')),
    paypal: config.paypalAvailable,
  };
  return SELLER_PAYMENT_BADGES.filter((badge) => shown[badge]);
}
