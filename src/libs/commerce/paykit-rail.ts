import { PAYMENT_ASSETS, type PaymentAsset } from '@/libs/commerce/payment-options';
import type { MarketplaceHealth } from '@/libs/commerce/pickup';

/**
 * One Paykit checkout entry ("Bitcoin via Bitkit") carries every asset the seller accepts;
 * the buyer picks Bitcoin or USDT in Bitkit. The order therefore binds the
 * method `paykit`, and the rail is known only from the OBSERVED asset
 * (`paymentAsset`, null until the service sees a payment). Orders placed
 * before the single bind carry `bitcoin` or `usdt` as the method and keep
 * rendering through the same helpers.
 *
 * Every rail-keyed copy table (`bitcoin-buyer-status.ts`, `usdt-buyer-status.ts`,
 * the refund and review copy) is reached through `observedPaymentRail`; nothing
 * here duplicates one.
 */

/** The rail a Paykit payment settled on. */
export type PaymentRail = 'bitcoin' | 'usdt';

type RailOrder = {
  paymentMethod?: string | null;
  paymentAsset?: string | null;
};

export const PAYKIT_PAYMENT_METHOD = 'paykit';

/**
 * The rail the buyer actually paid on: the observed `paymentAsset`, else the
 * legacy method label of an order placed before the single bind. Null for a
 * `paykit` order nothing has been paid on yet, and for PayPal and unbound
 * orders.
 */
export function observedPaymentRail(order: RailOrder): PaymentRail | null {
  if (order.paymentAsset === 'USDT') return 'usdt';
  if (order.paymentAsset === 'BTC') return 'bitcoin';
  if (order.paymentMethod === 'usdt') return 'usdt';
  if (order.paymentMethod === 'bitcoin') return 'bitcoin';
  return null;
}

/** Any Paykit order, single-bind or legacy. */
export function isPaykitOrder(order: RailOrder): boolean {
  return order.paymentMethod === PAYKIT_PAYMENT_METHOD || observedPaymentRail(order) !== null;
}

/** A single-bind order whose payment the service has not yet observed on either rail. */
export function isUnobservedPaykitOrder(order: RailOrder): boolean {
  return order.paymentMethod === PAYKIT_PAYMENT_METHOD && observedPaymentRail(order) === null;
}

/**
 * Bitcoin is, or still may become, the rail: observed Bitcoin, or a single-bind
 * order nothing has been paid on yet (the amount the buyer would send in Bitcoin
 * is already on the order).
 */
export function mayPayInBitcoin(order: RailOrder): boolean {
  return observedPaymentRail(order) === 'bitcoin' || isUnobservedPaykitOrder(order);
}

/** Request states that mean the service has already seen a Bitcoin payment. */
const BITCOIN_SEEN_REQUEST_STATES = new Set(['detected', 'awaiting_seller_confirmation', 'confirmed']);

/**
 * Bitcoin is paid through a seller-confirmation window, so the service sees the
 * payment (request state `detected`) before `paymentAsset` is recorded. Such a
 * `paykit` order already follows the Bitcoin tables.
 */
export function followsBitcoinFlow(order: RailOrder & { paykitRequestState?: string | null }): boolean {
  const rail = observedPaymentRail(order);
  if (rail !== null) return rail === 'bitcoin';
  return (
    order.paymentMethod === PAYKIT_PAYMENT_METHOD &&
    order.paykitRequestState != null &&
    BITCOIN_SEEN_REQUEST_STATES.has(order.paykitRequestState)
  );
}

const ASSET_WORD: Record<PaymentAsset, string> = { BTC: 'Bitcoin', USDT: 'USDT' };

/** "Bitcoin", "USDT", "Bitcoin or USDT"; "Bitkit" when no asset is known. */
export function paykitAssetsLabel(assets: readonly PaymentAsset[]): string {
  const words = PAYMENT_ASSETS.filter((asset) => assets.includes(asset)).map((asset) => ASSET_WORD[asset]);
  return words.length === 0 ? 'Bitkit' : words.join(' or ');
}

/**
 * The assets a single-bind order offered, from its own `acceptedAssets`. An
 * order that carries none was bound before the service reported them, which
 * only ever meant Bitcoin.
 */
export function orderOfferedAssets(order: { acceptedAssets?: readonly PaymentAsset[] | null }): PaymentAsset[] {
  const assets = order.acceptedAssets ?? [];
  return assets.length > 0 ? [...assets] : ['BTC'];
}

/** A Paykit order the buyer may pay, or did pay, in USDT. */
export function orderMayPayInUsdt(order: RailOrder & { acceptedAssets?: readonly PaymentAsset[] | null }): boolean {
  if (observedPaymentRail(order) === 'usdt') return true;
  return isUnobservedPaykitOrder(order) && orderOfferedAssets(order).includes('USDT');
}

/**
 * An order with no method bound yet pays on whatever the picker beside it
 * offers. `offeredAssets` is null until those assets load, when USDT may still
 * be among them.
 */
export function unboundOrderMayPayInUsdt(order: RailOrder, offeredAssets: readonly PaymentAsset[] | null): boolean {
  if (order.paymentMethod) return false;
  return offeredAssets === null || offeredAssets.includes('USDT');
}

/**
 * Staging runs Bitcoin on regtest, but Bitkit has no test USDT: its USDT is
 * real USDT0 on Arbitrum One on staging builds too. The staging note claims no
 * real funds move only when USDT cannot be paid.
 */
export const STAGING_USDT_FUNDS_NOTE =
  'Staging environment. Bitcoin payments use test funds; USDT is real USDT0 on Arbitrum One.';

/** The assets every seller in a cart accepts, Bitcoin first: what one entry can honestly name. */
export function sharedPaykitAssets(assetSets: readonly (readonly PaymentAsset[])[]): PaymentAsset[] {
  if (assetSets.length === 0) return [];
  return PAYMENT_ASSETS.filter((asset) => assetSets.every((assets) => assets.includes(asset)));
}

/**
 * The checkout method tile names what the buyer pays with and where, so it
 * never reads like the submit button: "Bitcoin via Bitkit", "Bitcoin or USDT
 * via Bitkit". The two parts render on separate lines to fit a half-width tile.
 */
export function paykitPickerLabel(assets: readonly PaymentAsset[]): { assets: string; wallet: string } {
  return { assets: paykitAssetsLabel(assets.length > 0 ? assets : ['BTC']), wallet: 'via Bitkit' };
}

/** The checkout submit button says where the buyer goes next, per selected rail. */
export const CHECKOUT_SUBMIT_LABEL: Record<'paykit' | 'paypal', string> = {
  paykit: 'Continue to Bitkit',
  paypal: 'Continue to PayPal',
};

/**
 * Why checkout says Bitkit is needed. A Bitcoin-only entry keeps the existing
 * on-chain wording; an entry that also offers USDT says the buyer chooses the
 * asset in Bitkit.
 */
export function paykitRequirementCopy(assets: readonly PaymentAsset[]): string {
  if (assets.includes('USDT') && assets.includes('BTC')) {
    return 'Paykit payments require Bitkit. You choose Bitcoin or USDT there.';
  }
  if (assets.includes('USDT')) return 'Paykit payments require Bitkit. You pay in USDT there.';
  return 'Bitcoin payments require Bitkit. Market currently supports on-chain bitcoin payments only.';
}

/** The neutral status before any payment is seen: the buyer has not chosen an asset yet. */
export function paykitAwaitingTitle(assets: readonly PaymentAsset[]): string {
  return `Pay in Bitkit (${paykitAssetsLabel(assets)})`;
}

export function paykitAwaitingBody(assets: readonly PaymentAsset[]): string {
  return assets.length > 1
    ? `Open Bitkit, approve the payment request and choose ${paykitAssetsLabel(assets)}. This page updates when the payment is seen.`
    : 'Open Bitkit and approve the payment request. This page updates when the payment is seen.';
}

/** Order-card and payment-card badge for the rail actually paid; the neutral Paykit badge before. */
export const PAYMENT_RAIL_BADGE: Record<PaymentRail | 'paykit', string> = {
  bitcoin: '₿ Bitcoin',
  usdt: 'USDT',
  paykit: 'Paykit',
};

/**
 * The Bitcoin rail runs through Paykit. While Paykit is down the service stops
 * offering Bitcoin everywhere (`bitcoin_offer_available: false`, and after its
 * stale window `bitcoin_available: false` as well), so a seller's public
 * payment config alone cannot tell "not set up" from "Paykit is down". The
 * service's `/health` carries the last rail probe, which can.
 */
export type PaykitRailStatus = 'ready' | 'unreachable' | 'unknown';

/**
 * The service serves the last known rail value for `PAYKIT_RAIL_STALE_SECONDS`
 * (default 60) after a failed probe, and `/health` reports that value with its
 * age. A last good probe older than this means every probe since has failed.
 */
export const PAYKIT_RAIL_STALE_AGE_SECONDS = 120;

export const PAYKIT_OUTAGE_COPY = {
  title: 'Paykit is temporarily unreachable, retrying…',
  /** Seller surfaces: nothing about the seller's own setup is implied. */
  sellerBody:
    'Your payment settings are unchanged. You can keep preparing drafts; publishing unlocks on its own as soon as Paykit is back.',
  /** Buyer surfaces: the single Paykit entry names no rail. */
  buyerBody: 'Paying with Paykit will unlock on its own as soon as Paykit is back. You do not need to reload.',
  /** Buyer line beside the options that stay available. */
  buyerOthers: 'Paykit returns on its own; PayPal is unaffected.',
  /** Where nothing is retrying on its own, such as a one-off toast. */
  tryAgain: 'Paykit is temporarily unreachable. Try again in a moment.',
} as const;

export function paykitRailStatusFromHealth(health: Pick<MarketplaceHealth, 'paykitRail'>): PaykitRailStatus {
  const rail = health.paykitRail;
  if (!rail || rail.bitcoinOfferAvailable === null || rail.bitcoinOfferAvailable === undefined) return 'unknown';
  if (!rail.bitcoinOfferAvailable) return 'unreachable';
  if (typeof rail.ageSeconds === 'number' && rail.ageSeconds > PAYKIT_RAIL_STALE_AGE_SECONDS) return 'unreachable';
  return 'ready';
}

const PAYKIT_RETRY_BASE_MS = 5_000;
const PAYKIT_RETRY_MAX_MS = 30_000;

/** Delay before retry number `failures` (0-based): 5s, 10s, 20s, then 30s. */
export function paykitRetryDelayMs(failures: number): number {
  return Math.min(PAYKIT_RETRY_BASE_MS * 2 ** Math.max(0, failures), PAYKIT_RETRY_MAX_MS);
}
