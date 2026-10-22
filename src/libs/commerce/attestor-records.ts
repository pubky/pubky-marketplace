import {
  attestorAnnotationUriBuilder,
  attestorProfileUriBuilder,
  verifyAttestorAnnotation,
  verifyAttestorProfile,
} from 'pubky-app-specs';
import { z } from 'zod';
import type { AttestorProfileKeyWindow } from '@/libs/commerce/attestor-key-windows';

/**
 * The records an attestor publishes on its own homeserver (specs
 * `0.6.2-marketplace.16`), read from the index's copy. The index verifies
 * each record before it stores it, but the Shop does not take the index's
 * word for what a record says: it re-verifies the proof over the record the
 * index served, against the URI it builds itself (attestor and order ref),
 * and reads the profile windows and outcomes from the verified record only,
 * never from the index's derived `key_windows` and `outcomes`. A forged,
 * misplaced or unreadable record answers `null` and is treated as absent.
 */

/** What an attestor reports happened to an attested order. */
export type ReviewOutcomeKind = 'refunded' | 'returned';

/** One outcome kind of an order, with the latest date it was recorded (`YYYY-MM-DD`). */
export interface ReviewOutcome {
  kind: ReviewOutcomeKind;
  on: string;
}

const REVIEW_OUTCOME_ORDER: readonly ReviewOutcomeKind[] = ['refunded', 'returned'];

const profileRecordSchema = z.object({
  keys: z.array(
    z.object({
      pubky: z.string(),
      validUntil: z.string().optional(),
      compromisedFrom: z.string().optional(),
    }),
  ),
});

const annotationRecordSchema = z.object({
  outcomes: z.array(
    z.object({
      kind: z.enum(['refunded', 'returned']),
      on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
  ),
});

/**
 * Whole seconds, rounded up (the index's rounding, so comparisons against
 * `iat` match). `undefined` when the record states no bound; `NaN` when it
 * states one this client cannot read, so the profile counts as unreadable
 * rather than as a bound left out.
 */
function secondsCeil(instant: string | undefined): number | null {
  if (instant === undefined) return null;
  return Math.ceil(Date.parse(instant) / 1000);
}

/**
 * The key windows of an attestor's profile, after verifying its proof
 * against the profile URI of `attestorId`. `null` when the record is not
 * that attestor's validly signed profile, or states a bound this client
 * cannot read.
 */
export function verifiedAttestorProfileKeyWindows(
  attestorId: string,
  record: unknown,
): AttestorProfileKeyWindow[] | null {
  try {
    const verified: unknown = verifyAttestorProfile(attestorProfileUriBuilder(attestorId), JSON.stringify(record));
    const windows = profileRecordSchema.parse(verified).keys.map((key) => ({
      pubky: key.pubky,
      validUntil: secondsCeil(key.validUntil),
      compromisedFrom: secondsCeil(key.compromisedFrom),
    }));
    return windows.some(({ validUntil, compromisedFrom }) => Number.isNaN(validUntil) || Number.isNaN(compromisedFrom))
      ? null
      : windows;
  } catch {
    return null;
  }
}

/**
 * One kind per outcome, the latest date each was recorded, in a fixed order
 * (refunded, then returned). A kind the record repeats shows once.
 */
export function latestReviewOutcomes(outcomes: readonly ReviewOutcome[]): ReviewOutcome[] {
  const latest = new Map<ReviewOutcomeKind, string>();
  for (const { kind, on } of outcomes) {
    const known = latest.get(kind);
    if (known === undefined || on > known) latest.set(kind, on);
  }
  return REVIEW_OUTCOME_ORDER.flatMap((kind) => {
    const on = latest.get(kind);
    return on === undefined ? [] : [{ kind, on }];
  });
}

/**
 * The outcomes of an attested order from its annotation, after verifying the
 * proof against the annotation URI of `attestorId` and `orderRef`. `null`
 * when the record is not that attestor's validly signed annotation for that
 * order.
 */
export function verifiedAttestorAnnotationOutcomes(
  attestorId: string,
  orderRef: string,
  record: unknown,
): ReviewOutcome[] | null {
  try {
    const verified: unknown = verifyAttestorAnnotation(
      attestorAnnotationUriBuilder(attestorId, orderRef),
      JSON.stringify(record),
    );
    return latestReviewOutcomes(annotationRecordSchema.parse(verified).outcomes);
  } catch {
    return null;
  }
}

/** The key of one annotation in a batch result. */
export function reviewOutcomeKey(attestorId: string, orderRef: string): string {
  return `${attestorId}:${orderRef}`;
}
