import crypto from 'node:crypto';
import { listingUriBuilder, PubkySpecsBuilder } from 'pubky-app-specs';
import { describe, expect, it } from 'vitest';
import {
  extractReviewAttestation,
  extractReviewAttestations,
  marketplaceAttestationSchema,
  readReviewAttestationPending,
  readReviewResultPending,
  reviewAttestationIssuedAt,
  verifyOwnReviewAttestation,
} from '@/libs/commerce/attestation';
import { commerceReviewRecordSchema } from '@/libs/commerce/marketplace-records';
import { purchaseAttestationJwsFixture } from '@/test/fixtures/commerce/trusted-attestors';

const REVIEWER = 'b'.repeat(52);
const SELLER = 's'.repeat(52);
const LISTING_ID = 'boots_01';

const Z_ALPHABET = 'ybndrfg8ejkmcpqxot1uwisza345h769';
function zbase32(bytes: Uint8Array): string {
  let bits = 0;
  let accumulator = 0;
  let out = '';
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += Z_ALPHABET[(accumulator >> bits) & 31];
    }
  }
  if (bits > 0) out += Z_ALPHABET[(accumulator << (5 - bits)) & 31];
  return out;
}

const b64u = (input: Uint8Array | string): string => Buffer.from(input).toString('base64url');

/** Issues a real EdDSA purchase attestation the way the service does. */
function issueAttestation(overrides: Record<string, unknown> = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const rawPublicKey = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  const iss = zbase32(rawPublicKey);
  const claims = {
    v: 1,
    iss,
    sub: REVIEWER,
    cpk: SELLER,
    role: 'buyer_reviewing_seller',
    listing: listingUriBuilder(SELLER, LISTING_ID),
    order_ref: 'ab'.repeat(32),
    completed_on: '2026-08-21',
    amount_band: 'USD:4',
    iat: 1_787_654_321,
    ...overrides,
  };
  const header = { alg: 'EdDSA', typ: 'pubky-purchase-attestation+v1' };
  const signingInput = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(claims))}`;
  const signature = crypto.sign(null, Buffer.from(signingInput), privateKey);
  return { jws: `${signingInput}.${b64u(signature)}`, iss };
}

function publishedRecord(jws: string) {
  const built = new PubkySpecsBuilder(REVIEWER).createMarketplaceReview({
    schemaVersion: 1,
    recordType: 'review',
    ownerPubky: REVIEWER,
    revision: 1,
    createdAt: '2026-08-21T10:00:00.000Z',
    updatedAt: '2026-08-21T10:00:00.000Z',
    reviewId: '',
    subjectPubky: SELLER,
    listingOwnerPubky: SELLER,
    listingId: LISTING_ID,
    role: 'buyer_reviewing_seller',
    ratings: { overall: 5 },
    text: 'Accurate and fast.',
    eligibilityAttestation: jws,
  });
  return commerceReviewRecordSchema.parse(built.marketplace_review.toJson());
}

describe('marketplace purchase attestation', () => {
  it('accepts the wire shape review.create returns (camelCased claims)', () => {
    const { jws, iss } = issueAttestation();
    const wire = {
      jws,
      claims: {
        v: 1,
        iss,
        sub: REVIEWER,
        cpk: SELLER,
        role: 'buyer_reviewing_seller',
        listing: listingUriBuilder(SELLER, LISTING_ID),
        orderRef: 'ab'.repeat(32),
        completedOn: '2026-08-21',
        amountBand: 'USD:4',
        iat: 1_787_654_321,
      },
    };
    expect(marketplaceAttestationSchema.parse(wire)).toEqual(wire);
    // The band is optional (D2: absent without both-sides consent).
    const { amountBand: _omitted, ...bandless } = wire.claims;
    expect(marketplaceAttestationSchema.safeParse({ jws, claims: bandless }).success).toBe(true);
  });

  it('rejects unknown claims, malformed refs, and non-compact jws', () => {
    const { jws, iss } = issueAttestation();
    const claims = {
      v: 1,
      iss,
      sub: REVIEWER,
      cpk: SELLER,
      role: 'buyer_reviewing_seller',
      listing: listingUriBuilder(SELLER, LISTING_ID),
      orderRef: 'ab'.repeat(32),
      completedOn: '2026-08-21',
      iat: 1,
    };
    expect(marketplaceAttestationSchema.safeParse({ jws, claims: { ...claims, surprise: true } }).success).toBe(false);
    expect(
      marketplaceAttestationSchema.safeParse({ jws, claims: { ...claims, orderRef: 'UPPER'.repeat(13) } }).success,
    ).toBe(false);
    expect(marketplaceAttestationSchema.safeParse({ jws: 'not-a-jws', claims }).success).toBe(false);
  });

  it('extracts the attestation from a review result and answers null for honest absence', () => {
    const { jws, iss } = issueAttestation();
    const claims = {
      v: 1,
      iss,
      sub: REVIEWER,
      cpk: SELLER,
      role: 'buyer_reviewing_seller',
      listing: listingUriBuilder(SELLER, LISTING_ID),
      orderRef: 'ab'.repeat(32),
      completedOn: '2026-08-21',
      iat: 1,
    };
    expect(extractReviewAttestation({ kind: 'review', attestation: { jws, claims } })).toEqual({ jws, claims });
    // A deployment without an attestor returns no attestation at all.
    expect(extractReviewAttestation({ kind: 'review' })).toBeNull();
    // A malformed attestation is not silently accepted.
    expect(extractReviewAttestation({ kind: 'review', attestation: { jws: 'x' } })).toBeNull();
  });

  it('extracts every per-listing attestation of an item result in order and skips malformed entries', () => {
    const boots = issueAttestation();
    const belt = issueAttestation({ listing: listingUriBuilder(SELLER, 'belt') });
    const claims = (iss: string, listing: string) => ({
      v: 1,
      iss,
      sub: REVIEWER,
      cpk: SELLER,
      role: 'buyer_reviewing_seller',
      listing,
      orderRef: 'ab'.repeat(32),
      completedOn: '2026-08-21',
      priceDecade: 'USD:2',
      iat: 1,
    });

    const extracted = extractReviewAttestations({
      attestations: [
        { listingId: LISTING_ID, jws: boots.jws, claims: claims(boots.iss, listingUriBuilder(SELLER, LISTING_ID)) },
        { listingId: 'belt', jws: belt.jws, claims: claims(belt.iss, listingUriBuilder(SELLER, 'belt')) },
        { jws: 'x' },
      ],
    });

    expect(extracted.map(({ listingId }) => listingId)).toEqual([LISTING_ID, 'belt']);
    expect(extracted[0].claims.priceDecade).toBe('USD:2');
    expect(extractReviewAttestations({ kind: 'review' })).toEqual([]);
  });

  it('keeps price_decade in the pinned claims so a signed item attestation verifies', () => {
    const { jws, iss } = issueAttestation({ price_decade: 'USD:2' });

    expect(verifyOwnReviewAttestation(publishedRecord(jws))).toBe(iss);
  });

  it('verifies a genuinely signed attestation against the record offline', () => {
    const { jws, iss } = issueAttestation();
    const record = publishedRecord(jws);
    expect(verifyOwnReviewAttestation(record)).toBe(iss);
  });

  it('refuses a forged signature and a mismatched binding', () => {
    // Signature forged: claims name an honest issuer, signed by someone else.
    const honest = issueAttestation();
    const forged = issueAttestation({ iss: honest.iss });
    expect(verifyOwnReviewAttestation(publishedRecord(forged.jws))).toBeNull();

    // Binding mismatch: the attestation covers a different listing.
    const otherListing = issueAttestation({ listing: listingUriBuilder(SELLER, 'other_listing') });
    expect(verifyOwnReviewAttestation(publishedRecord(otherListing.jws))).toBeNull();
  });
});

describe('reviewAttestationIssuedAt', () => {
  it("reads the attestation's iat as the issuance instant", () => {
    const iat = Date.UTC(2026, 9, 12, 14, 30) / 1000;
    const record = { eligibilityAttestation: purchaseAttestationJwsFixture({ iss: 'o'.repeat(52), iat }) };

    expect(reviewAttestationIssuedAt(record)).toEqual(new Date('2026-10-12T14:30:00Z'));
  });

  it('is null when the embedded attestation does not parse', () => {
    expect(reviewAttestationIssuedAt({ eligibilityAttestation: 'not.a.jws' })).toBeNull();
  });
});

describe('readReviewAttestationPending', () => {
  it('reads the withheld answer of the attestation routes', () => {
    expect(readReviewAttestationPending({ status: 'pending', releaseAt: '2026-11-01T00:00:00.000Z' })).toEqual({
      status: 'pending',
      releaseAt: '2026-11-01T00:00:00.000Z',
    });
  });

  it('does not read an issued attestation, a missing release date or other statuses as pending', () => {
    expect(readReviewAttestationPending({ status: 'issued', releaseAt: '2026-11-01T00:00:00.000Z' })).toBeNull();
    expect(readReviewAttestationPending({ status: 'pending' })).toBeNull();
    expect(readReviewAttestationPending(null)).toBeNull();
    expect(readReviewAttestationPending({ attestation: 'x.y.z' })).toBeNull();
  });
});

describe('readReviewResultPending', () => {
  it('reads a withheld command result with its release date', () => {
    expect(readReviewResultPending({ attestationStatus: 'pending', releaseAt: '2026-11-01T00:00:00.000Z' })).toEqual({
      releaseAt: '2026-11-01T00:00:00.000Z',
    });
  });

  it('keeps a withheld result without a usable release date pending', () => {
    expect(readReviewResultPending({ attestationStatus: 'pending' })).toEqual({ releaseAt: null });
    expect(readReviewResultPending({ attestationStatus: 'pending', releaseAt: 5 })).toEqual({ releaseAt: null });
  });

  it('reads a result without the status, as from a service without the window, as released', () => {
    expect(readReviewResultPending({ attestation: 'x.y.z' })).toBeNull();
    expect(readReviewResultPending({ attestationStatus: 'issued' })).toBeNull();
  });
});
