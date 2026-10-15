import type { SellerPaymentConfigOwnView } from '@/libs/commerce/payment-methods';
import type { UsdtSellerReadiness } from '@/libs/commerce/usdt-seller-setup';
import { locksCreatorMatchesShopPubky } from '@/services/locks/locks-frontend-session';

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
 * Whether bitcoin setup still shows the Lock Server step. Only an upstream
 * deployment needs it, and only to confirm Bitkit setup when the service's own
 * Paykit lookups cannot (`paykitAccountKnown` false) and nothing else has
 * confirmed it. Without a marketplace session or loaded config the answer is
 * not known yet, so the step stays hidden instead of flashing.
 */
export function isLockServerStepRequired(args: {
  paykitServerApi: 'fork' | 'upstream';
  hasMarketplaceSession: boolean;
  configLoaded: boolean;
  paykitAccountKnown: boolean;
  accountClaimed: boolean | null;
}): boolean {
  if (args.paykitServerApi !== 'upstream') return true;
  if (!args.hasMarketplaceSession || !args.configLoaded) return false;
  return !args.paykitAccountKnown && args.accountClaimed !== true;
}

/**
 * Bitcoin is connected when the Paykit claim is present (`accountClaimed ===
 * true` from `useMarketplaceSellerPaymentConfig`) and, while the Lock Server
 * step is required, its authorization too: `connectedCreator` from
 * `useMarketplaceLocksConnect` (restored from localStorage and revalidated with
 * the Lock Server after reload).
 */
export function deriveBitcoinStatus(args: {
  connectedCreator: string | null;
  accountPubky: string | null | undefined;
  accountClaimed: boolean | null;
  locksError: string | null;
  claimError: string | null;
  lockServerRequired: boolean;
}): PaymentMethodStatus {
  const paykitClaimed = args.accountClaimed === true;
  if (!args.lockServerRequired) {
    if (args.claimError) return 'needs_attention';
    return paykitClaimed ? 'connected' : 'not_set_up';
  }
  if (args.locksError || args.claimError) return 'needs_attention';
  const locksAuthorized = locksCreatorMatchesShopPubky(args.connectedCreator, args.accountPubky);
  if (locksAuthorized && paykitClaimed) return 'connected';
  if (!locksAuthorized && !paykitClaimed) return 'not_set_up';
  return 'needs_attention';
}

/** The bitcoin step that still keeps "Accept bitcoin" switched off, or null when nothing is missing. */
export type BitcoinToggleBlocker = 'lock-server' | 'bitkit' | 'both' | 'bitkit-unknown';

export const BITCOIN_TOGGLE_BLOCKER_COPY: Record<BitcoinToggleBlocker, string> = {
  'lock-server': 'Connect the Lock Server first.',
  bitkit: 'Connect Bitkit first.',
  both: 'Connect the Lock Server and Bitkit first.',
  'bitkit-unknown': "We can't check Bitkit right now.",
};

/**
 * Names the missing step behind a disabled "Accept bitcoin" switch. A Lock
 * Server error counts as step 1 missing. An unknown claim (`null`) is never
 * reported as missing: the read failed, so Bitkit may already be connected.
 * Bitkit is named only when the claim read answered `false`.
 */
export function deriveBitcoinToggleBlocker(args: {
  lockServerConnected: boolean;
  locksError: string | null;
  accountClaimed: boolean | null;
  lockServerRequired: boolean;
}): BitcoinToggleBlocker | null {
  const lockServerMissing = args.lockServerRequired && (!args.lockServerConnected || Boolean(args.locksError));
  if (lockServerMissing) return args.accountClaimed === false ? 'both' : 'lock-server';
  if (args.accountClaimed === false) return 'bitkit';
  if (args.accountClaimed === null) return 'bitkit-unknown';
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
