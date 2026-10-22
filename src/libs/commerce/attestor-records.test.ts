import { describe, expect, it } from 'vitest';
import {
  latestReviewOutcomes,
  reviewOutcomeKey,
  verifiedAttestorAnnotationOutcomes,
  verifiedAttestorProfileKeyWindows,
} from '@/libs/commerce/attestor-records';
import {
  createAttestorTestKey,
  signedAttestorAnnotation,
  signedAttestorProfile,
} from '@/test/fixtures/commerce/attestor-records';
import vectors from '@/test/fixtures/commerce/attestor-records-v1.json';

const ORDER_REF = 'ab'.repeat(32);
const seconds = (iso: string) => Date.parse(iso) / 1000;

describe('verifiedAttestorProfileKeyWindows', () => {
  it("reads the windows of the specs vector's profile after its proof verifies", () => {
    const windows = verifiedAttestorProfileKeyWindows(vectors.attestorPubky, vectors.profile.record);

    expect(windows).toEqual([
      { pubky: vectors.attestorPubky, validUntil: null, compromisedFrom: null },
      {
        pubky: '9wm1eqn4wddis385xdgsym7b5ge9549zpcjhmdszymicopxj6acy',
        validUntil: seconds('2026-08-01T00:00:00Z'),
        compromisedFrom: seconds('2026-07-15T00:00:00Z'),
      },
    ]);
  });

  it('rounds fractional-second bounds up, as the index does', () => {
    const key = createAttestorTestKey();
    const record = signedAttestorProfile(key, [
      { pubky: key.pubky, validFrom: '2026-01-01T00:00:00Z', compromisedFrom: '2026-07-15T00:00:00.250Z' },
    ]);

    expect(verifiedAttestorProfileKeyWindows(key.pubky, record)).toEqual([
      { pubky: key.pubky, validUntil: null, compromisedFrom: seconds('2026-07-15T00:00:01Z') },
    ]);
  });

  it('answers null for a profile whose body changed after it was signed', () => {
    const forged = {
      ...vectors.profile.record,
      keys: [{ pubky: vectors.attestorPubky, validFrom: '2026-08-01T00:00:00Z', validUntil: '2026-08-02T00:00:00Z' }],
    };

    expect(verifiedAttestorProfileKeyWindows(vectors.attestorPubky, forged)).toBeNull();
  });

  it("answers null for an honest profile read as another attestor's (a copy on someone else's homeserver)", () => {
    const other = createAttestorTestKey();

    expect(verifiedAttestorProfileKeyWindows(other.pubky, vectors.profile.record)).toBeNull();
  });

  it('answers null for a record without a proof, with an annotation proof, or that is not an object', () => {
    const key = createAttestorTestKey();
    const profile = signedAttestorProfile(key, [{ pubky: key.pubky, validFrom: '2026-01-01T00:00:00Z' }]);
    const { proof: _proof, ...unsigned } = profile;

    expect(verifiedAttestorProfileKeyWindows(key.pubky, unsigned)).toBeNull();
    expect(verifiedAttestorProfileKeyWindows(key.pubky, signedAttestorAnnotation(key, ORDER_REF, []))).toBeNull();
    expect(verifiedAttestorProfileKeyWindows(key.pubky, 'not a record')).toBeNull();
    expect(verifiedAttestorProfileKeyWindows(key.pubky, null)).toBeNull();
  });
});

describe('verifiedAttestorAnnotationOutcomes', () => {
  it("reads the specs vector's outcomes, one entry per kind, refunded first", () => {
    expect(
      verifiedAttestorAnnotationOutcomes(
        vectors.attestorPubky,
        vectors.annotation.record.orderRef,
        vectors.annotation.record,
      ),
    ).toEqual([
      { kind: 'refunded', on: '2026-10-14' },
      { kind: 'returned', on: '2026-10-12' },
    ]);
  });

  it('answers null when the body changed, when it is read for another order, or for another attestor', () => {
    const { record } = vectors.annotation;
    const other = createAttestorTestKey();

    expect(
      verifiedAttestorAnnotationOutcomes(vectors.attestorPubky, record.orderRef, {
        ...record,
        outcomes: [{ kind: 'refunded', on: '2026-10-30' }],
      }),
    ).toBeNull();
    expect(verifiedAttestorAnnotationOutcomes(vectors.attestorPubky, ORDER_REF, record)).toBeNull();
    expect(verifiedAttestorAnnotationOutcomes(other.pubky, record.orderRef, record)).toBeNull();
  });

  it('reads an annotation with no outcomes as an empty list', () => {
    const key = createAttestorTestKey();

    expect(
      verifiedAttestorAnnotationOutcomes(key.pubky, ORDER_REF, signedAttestorAnnotation(key, ORDER_REF, [])),
    ).toEqual([]);
  });
});

describe('latestReviewOutcomes', () => {
  it('shows each kind once with its latest date, refunded then returned', () => {
    expect(
      latestReviewOutcomes([
        { kind: 'returned', on: '2026-10-12' },
        { kind: 'refunded', on: '2026-10-14' },
        { kind: 'refunded', on: '2026-10-20' },
        { kind: 'refunded', on: '2026-10-02' },
      ]),
    ).toEqual([
      { kind: 'refunded', on: '2026-10-20' },
      { kind: 'returned', on: '2026-10-12' },
    ]);
  });

  it('keeps a single kind alone', () => {
    expect(latestReviewOutcomes([{ kind: 'returned', on: '2026-10-12' }])).toEqual([
      { kind: 'returned', on: '2026-10-12' },
    ]);
    expect(latestReviewOutcomes([])).toEqual([]);
  });
});

describe('reviewOutcomeKey', () => {
  it('joins the attestor and the order ref', () => {
    expect(reviewOutcomeKey('att', 'ref')).toBe('att:ref');
  });
});
