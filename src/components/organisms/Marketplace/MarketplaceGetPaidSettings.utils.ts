import type { SellerPaymentConfigOwnView } from '@/libs/commerce/payment-methods';
import type { UsdtSellerReadiness } from '@/libs/commerce/usdt-seller-setup';

/** Plain-language setup state shown as the status pill on each method card. */
export type PaymentMethodStatus = 'not_set_up' | 'connected' | 'email_saved' | 'needs_attention';

export const PAYMENT_METHOD_STATUS_LABELS: Record<PaymentMethodStatus, string> = {
  not_set_up: 'Not set up',
  connected: 'Connected',
  email_saved: 'Email saved',
  needs_attention: 'Needs attention',
};

/** A method counts as ready for selling only when its pill is Connected or Email saved. */
export function isReadyPaymentMethodStatus(status: PaymentMethodStatus): boolean {
  return status === 'connected' || status === 'email_saved';
}

export function countReadyPaymentMethods(statuses: readonly PaymentMethodStatus[]): number {
  return statuses.filter(isReadyPaymentMethodStatus).length;
}

export function derivePaypalStatus(config: SellerPaymentConfigOwnView | null): PaymentMethodStatus {
  return config?.paypalMerchantEmail ? 'email_saved' : 'not_set_up';
}

/**
 * The Bitcoin pill from the service's uncached `bitcoin_setup`
 * (`accountClaimed` from `useMarketplaceSellerPaymentConfig`): `ready` is
 * Connected and only a definite `setup_required` is Not set up. An unknown
 * answer (`unavailable`, a failed read, or a service without the field) needs
 * attention, like USDT's `unavailable`: Bitkit may already be connected.
 */
export function deriveBitcoinStatus(accountClaimed: boolean | null): PaymentMethodStatus {
  if (accountClaimed === true) return 'connected';
  if (accountClaimed === false) return 'not_set_up';
  return 'needs_attention';
}

/**
 * Whether the Bitkit step may offer Connect or Reconnect Bitkit: only after a
 * definite answer (`ready` or `setup_required`). An unknown answer offers
 * Check again instead, so an outage never starts a Paykit authorization.
 */
export function canOfferBitkitSetup(accountClaimed: boolean | null): accountClaimed is boolean {
  return accountClaimed !== null;
}

/** Why "Accept bitcoin" is still switched off, or null when nothing is missing. */
export type BitcoinToggleBlocker = 'bitkit' | 'bitkit-unknown';

export const BITCOIN_TOGGLE_BLOCKER_COPY: Record<BitcoinToggleBlocker, string> = {
  bitkit: 'Connect Bitkit first.',
  'bitkit-unknown': "We can't check Bitkit right now.",
};

/**
 * Names the missing step behind a disabled "Accept bitcoin" switch. An
 * unknown claim (`null`) is never reported as missing: the read failed, so
 * Bitkit may already be connected. Bitkit is named only when the service
 * answered `setup_required`.
 */
export function deriveBitcoinToggleBlocker(accountClaimed: boolean | null): BitcoinToggleBlocker | null {
  if (accountClaimed === false) return 'bitkit';
  if (accountClaimed === null) return 'bitkit-unknown';
  return null;
}

/** USDT is Connected only when the service reports it ready; a lookup it cannot make needs attention. */
export function deriveUsdtStatus(readiness: UsdtSellerReadiness): PaymentMethodStatus {
  if (readiness === 'ready') return 'connected';
  if (readiness === 'unavailable') return 'needs_attention';
  return 'not_set_up';
}

export function atLeastOneMethodSentence(readyCount: number): string {
  if (readyCount === 0) return 'Add a payment method to start selling.';
  return `${readyCount} payment ${readyCount === 1 ? 'method' : 'methods'} set up.`;
}
