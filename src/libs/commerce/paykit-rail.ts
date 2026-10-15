import type { MarketplaceHealth } from '@/libs/commerce/pickup';

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
  /** Buyer surfaces. */
  buyerBody: 'Bitcoin checkout will unlock on its own as soon as Paykit is back. You do not need to reload.',
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
