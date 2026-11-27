import { PAID_UNLOCKS_BLOCKED_MESSAGE } from '@/libs/commerce/region-modes';
import { isAppError } from '@/libs/error/error';
import { RateLimitErrorCode } from '@/libs/error/error.codes';

/**
 * Lock Server refusals of `POST /proof-bundles` the buyer can act on. Keys are
 * the server's stable `error.code` values, the only part of the response the
 * Shop reads: its message text is never shown.
 *
 * - `reader_pubky_unresolvable` and `paykit_invoice_creation_failed` come from
 *   Lock Servers before durable invoice admission (v0.1.0-rc8) and are gone
 *   from rc9 on, where the invoice is created in the background and failures
 *   arrive on the lifecycle instead (see `locks-lifecycle.ts`).
 * - The rest are returned by every Lock Server version.
 */
export const LOCKS_SUBMIT_REFUSAL_COPY = {
  reader_pubky_unresolvable:
    'Your pubky couldn’t be looked up, so no payment request was created. Try again in a moment.',
  paykit_invoice_creation_failed: 'The payment request couldn’t be created right now. Try again in a moment.',
  content_lock_not_found:
    'The seller’s content lock couldn’t be found, so this payment can’t be requested. Contact the seller.',
  task_state_conflict:
    'This payment request doesn’t match the one already created for this order. Reload the page and try again.',
  paykit_not_configured: 'This payment method isn’t available right now. Try again later, or contact the seller.',
  unsupported_verifier_type: 'This payment method isn’t available right now. Try again later, or contact the seller.',
  invalid_request: 'The payment request wasn’t accepted. Reload the page and try again.',
} as const;

export type LocksSubmitRefusalCode = keyof typeof LOCKS_SUBMIT_REFUSAL_COPY;

export const LOCKS_SUBMIT_REFUSAL_CODES = Object.keys(LOCKS_SUBMIT_REFUSAL_COPY) as readonly LocksSubmitRefusalCode[];

/** The Lock Server answers 451 to a proof bundle from a region where paid unlocks are not available. */
export const LOCKS_REGION_REFUSAL_STATUS = 451;

/**
 * The seller changed the listing's lock after checkout, so this order was
 * prepared against a lock the listing no longer shows. No new payment request
 * is created, but an earlier request from another device may still be in
 * progress, so the copy never says that nothing was charged or that the order cannot be paid.
 * That earlier payment can also succeed and deliver the item, after which the
 * order can no longer be cancelled, so the copy never promises a cancel.
 */
export const LOCKS_PREPARED_TERMS_DIFFER_COPY =
  'The seller changed what this listing unlocks after you checked out. We didn’t send a new payment request, but an earlier one may still be in progress, so check this order’s status before you check out again. Cancel the order only if it still offers that option.';

export const LOCKS_SUBMIT_RATE_LIMITED_COPY = 'Too many payment requests. Wait a minute, then try again.';

/**
 * Buyer copy for a failed proof-bundle submit, or `fallback` for any refusal
 * the Shop has no specific copy for (network failures, 5xx, unknown codes).
 */
export function locksSubmitRefusalMessage(error: unknown, fallback: string): string {
  if (!isAppError(error)) return fallback;
  if (error.context?.preparedTermsDiffer === true) return LOCKS_PREPARED_TERMS_DIFFER_COPY;
  if (error.context?.statusCode === LOCKS_REGION_REFUSAL_STATUS) return PAID_UNLOCKS_BLOCKED_MESSAGE;
  const code = error.context?.locksCode;
  const known = LOCKS_SUBMIT_REFUSAL_CODES.find((candidate) => candidate === code);
  if (known) return LOCKS_SUBMIT_REFUSAL_COPY[known];
  if (error.code === RateLimitErrorCode.RATE_LIMITED) return LOCKS_SUBMIT_RATE_LIMITED_COPY;
  return fallback;
}
