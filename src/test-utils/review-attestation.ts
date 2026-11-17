import crypto from 'node:crypto';
import { listingUriBuilder } from 'pubky-app-specs';
import { ORDER_FIXTURE_BUYER, ORDER_FIXTURE_SELLER } from '@/test/fixtures/commerce/orders';

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

/** A real EdDSA attestation, camelCased the way the wire boundary delivers it. */
export function issuedAttestation(listingId: string, orderRef = 'cd'.repeat(32)) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const iss = zbase32(publicKey.export({ type: 'spki', format: 'der' }).subarray(-32));
  const jwsClaims = {
    v: 1,
    iss,
    sub: ORDER_FIXTURE_BUYER,
    cpk: ORDER_FIXTURE_SELLER,
    role: 'buyer_reviewing_seller',
    listing: listingUriBuilder(ORDER_FIXTURE_SELLER, listingId),
    order_ref: orderRef,
    completed_on: '2026-08-21',
    iat: 1_787_654_321,
  };
  const header = { alg: 'EdDSA', typ: 'pubky-purchase-attestation+v1' };
  const signingInput = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(jwsClaims))}`;
  const jws = `${signingInput}.${b64u(crypto.sign(null, Buffer.from(signingInput), privateKey))}`;
  return {
    iss,
    jws,
    wire: {
      jws,
      claims: {
        v: 1,
        iss,
        sub: ORDER_FIXTURE_BUYER,
        cpk: ORDER_FIXTURE_SELLER,
        role: 'buyer_reviewing_seller',
        listing: jwsClaims.listing,
        orderRef: jwsClaims.order_ref,
        completedOn: jwsClaims.completed_on,
        iat: jwsClaims.iat,
      },
    },
  };
}

export function reviewResult(attestation: unknown) {
  return {
    kind: 'review',
    review: {
      reviewerPubky: ORDER_FIXTURE_BUYER,
      reviewerRole: 'buyer',
      subjectPubky: ORDER_FIXTURE_SELLER,
      rating: 5,
      text: 'Accurate and fast.',
      createdAt: '2026-08-21T10:00:00.000Z',
      updatedAt: '2026-08-21T10:00:00.000Z',
    },
    ...(attestation === null ? {} : { attestation }),
  };
}
