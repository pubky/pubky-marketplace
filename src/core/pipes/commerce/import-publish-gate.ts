import { LISTING_PUBLISH_BLOCK_COPY, type ListingPublishBlockReason } from '@/libs/commerce/listing-publish-guards';
import { commerceListingFulfillmentMethods } from '@/libs/commerce/marketplace-records';

/**
 * How an import publish answers the sell composer's publish gates (payment
 * method, delivery key). The gates themselves live in
 * `@/libs/commerce/listing-publish-guards` and are reused as they are; this
 * module only decides what a block means for each imported listing.
 */

/** The sell composer's publish gates, answered once for the planned listings of an import. */
export type ImportPublishGate = {
  /** The first reason the gates block publishing, or `null` when they pass. */
  reason: ListingPublishBlockReason | null;
  /** Any planned listing ships, so the delivery key is required. */
  ships: boolean;
  /** Active listings the gate would stop that are saved paused: new ones and ones now paused. */
  pausing: number;
  /** Listings already live that stay live: only their safe content is updated. */
  keptLive: readonly { readonly listingId: string; readonly title: string }[];
};

export const NO_PUBLISH_GATE: ImportPublishGate = { reason: null, ships: false, pausing: 0, keptLive: [] };

export const PAUSED_FAILURE_PREFIX = 'paused:';
export const KEPT_LIVE_FAILURE_PREFIX = 'kept_live:';

/** Blocks that stop every listing; the others (delivery key) stop only listings that ship. */
const BLOCKS_EVERY_LISTING: readonly ListingPublishBlockReason[] = ['unsigned', 'session', 'no-method', 'unverified'];

export function gateBlocksListing(reason: ListingPublishBlockReason, ships: boolean): boolean {
  return BLOCKS_EVERY_LISTING.includes(reason) || ships;
}

type PayloadRow = { extraFields?: Record<string, string> };

/**
 * Whether a planned row's listing ships. A row that carries the listing record
 * (an export of the seller's own catalogue) says so through its fulfillment
 * methods; a row built from a shop-system file always becomes a shipped listing.
 */
export function payloadShips(row: PayloadRow): boolean {
  const json = row.extraFields?.record_json;
  if (json === undefined || json === '') return true;
  try {
    const record = JSON.parse(json) as { fulfillmentMethods?: unknown };
    if (!Array.isArray(record.fulfillmentMethods)) return true;
    return commerceListingFulfillmentMethods(
      record.fulfillmentMethods as Parameters<typeof commerceListingFulfillmentMethods>[0],
    ).includes('shipping');
  } catch {
    return true;
  }
}

const PAUSED_COPY: Partial<Record<ListingPublishBlockReason, string>> = {
  'no-method': 'no payment method set up',
  unverified: 'payment settings could not be checked',
  'no-delivery-key': 'no delivery key published',
  'delivery-key-unverified': 'delivery key could not be checked',
  session: 'selling is not enabled',
  unsigned: 'not signed in',
};

export function pausedFailureCode(reason: ListingPublishBlockReason): string {
  return `${PAUSED_FAILURE_PREFIX}${reason}`;
}

export function pausedReasonOf(failureCode: string | undefined): ListingPublishBlockReason | null {
  if (!failureCode?.startsWith(PAUSED_FAILURE_PREFIX)) return null;
  const reason = failureCode.slice(PAUSED_FAILURE_PREFIX.length) as ListingPublishBlockReason;
  return reason in LISTING_PUBLISH_BLOCK_COPY ? reason : null;
}

/** The result CSV text for a listing that was saved paused because a gate blocked it. */
export function pausedResultText(reason: ListingPublishBlockReason): string {
  return `paused, ${PAUSED_COPY[reason] ?? reason}`;
}

/**
 * The dry run's notice: what the gate does to listings, and what to fix. New
 * and paused listings are saved paused; live ones stay live.
 */
export function gateNotice(
  reason: ListingPublishBlockReason,
  counts: { pausing: number; keptLive: number } = { pausing: 1, keptLive: 0 },
): { title: string; body: string } {
  const copy = LISTING_PUBLISH_BLOCK_COPY[reason];
  let lead = 'Listings will be saved as paused.';
  if (counts.pausing > 0 && counts.keptLive > 0) lead = 'New and paused listings will be saved as paused.';
  else if (counts.pausing === 0 && counts.keptLive > 0) lead = 'Listings that are live stay live.';
  return { title: `${lead} ${copy.title}`, body: copy.body };
}

export function pausedSummary(count: number, reason: ListingPublishBlockReason): string {
  const subject = count === 1 ? '1 listing was' : `${count} listings were`;
  return `${subject} saved as paused: ${PAUSED_COPY[reason] ?? reason}.`;
}

/** What to fix, in the gate's own words (its checklist label). */
function fixLabel(reason: ListingPublishBlockReason): string {
  return LISTING_PUBLISH_BLOCK_COPY[reason].checklist.toLowerCase();
}

/** The line shown for a listing that stays live: `kept live; fix payment method to keep publishing`. */
export function keptLiveLine(reason: ListingPublishBlockReason): string {
  return `kept live; fix ${fixLabel(reason)} to keep publishing`;
}

export function keptLiveFailureCode(reason: ListingPublishBlockReason, skipped: readonly string[]): string {
  return `${KEPT_LIVE_FAILURE_PREFIX}${reason}${skipped.length > 0 ? `|${skipped.join(',')}` : ''}`;
}

export function keptLiveOf(
  failureCode: string | undefined,
): { reason: ListingPublishBlockReason; skipped: string[] } | null {
  if (!failureCode?.startsWith(KEPT_LIVE_FAILURE_PREFIX)) return null;
  const [reasonPart = '', skippedPart = ''] = failureCode.slice(KEPT_LIVE_FAILURE_PREFIX.length).split('|');
  const reason = reasonPart as ListingPublishBlockReason;
  if (!(reason in LISTING_PUBLISH_BLOCK_COPY)) return null;
  return { reason, skipped: skippedPart === '' ? [] : skippedPart.split(',') };
}

export function keptLiveSummary(count: number, reason: ListingPublishBlockReason, skippedChanges: number): string {
  const subject = count === 1 ? '1 listing' : `${count} listings`;
  const skipped =
    skippedChanges > 0 ? ` ${skippedChanges} change${skippedChanges === 1 ? ' was' : 's were'} skipped.` : '';
  return `${subject} ${count === 1 ? 'was' : 'were'} ${keptLiveLine(reason)}.${skipped}`;
}
