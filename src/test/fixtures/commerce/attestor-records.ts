import crypto from 'node:crypto';

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

/** RFC 8785 for the shapes the attestor records hold: sorted members, no whitespace, integers, strings, null. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const members = Object.entries(value as Record<string, unknown>)
      .filter(([, member]) => member !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`);
    return `{${members.join(',')}}`;
  }
  return JSON.stringify(value);
}

export interface AttestorTestKey {
  /** The z-base-32 pubky of the key, which owns the records it signs. */
  pubky: string;
  /** Signs `body` as a record of the given `typ`: the body plus a detached-payload proof. */
  sign: (typ: string, body: Record<string, unknown>) => Record<string, unknown>;
}

/** A fresh Ed25519 key that signs attestor records the way the service does (specs `.16`). */
export function createAttestorTestKey(): AttestorTestKey {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pubky = zbase32(publicKey.export({ type: 'spki', format: 'der' }).subarray(-32));
  return {
    pubky,
    sign: (typ, body) => {
      const header = b64u(JSON.stringify({ alg: 'EdDSA', typ }));
      const signingInput = `${header}.${b64u(canonicalJson(body))}`;
      const signature = crypto.sign(null, Buffer.from(signingInput), privateKey);
      return { ...body, proof: `${header}..${b64u(signature)}` };
    },
  };
}

interface ProfileKeyInput {
  pubky: string;
  validFrom: string;
  validUntil?: string;
  compromisedFrom?: string;
}

/** A signed attestor profile record listing `keys`. */
export function signedAttestorProfile(key: AttestorTestKey, keys: ProfileKeyInput[]): Record<string, unknown> {
  return key.sign('pubky-attestor-profile+v1', {
    operator: { name: 'Pubky Market', url: 'https://market.example', policyUrl: 'https://market.example/policy' },
    keys,
    issuancePolicy: {
      editWindowHours: 24,
      blindWindowDays: 14,
      amountBand: 'both-sides consent',
      priceDecade: 'always',
      minOrderValue: null,
    },
  });
}

/** A signed attestor annotation record for one attested order. */
export function signedAttestorAnnotation(
  key: AttestorTestKey,
  orderRef: string,
  outcomes: { kind: 'refunded' | 'returned'; on: string }[],
  revision = 1,
): Record<string, unknown> {
  return key.sign('pubky-attestor-annotation+v1', { orderRef, outcomes, revision });
}

/** The index's wrapper around a served profile record (`GET v0/marketplace/attestor/{id}/profile`). */
export function servedAttestorProfile(attestorId: string, record: Record<string, unknown>) {
  return {
    attestor_id: attestorId,
    uri: `pubky://${attestorId}/pub/pubky.app/marketplace/v1/attestor/profile`,
    key_windows: [],
    record,
    indexed_at: 1_792_590_000_000,
  };
}

/** The index's wrapper around a served annotation record (an entry of the annotations answer). */
export function servedAttestorAnnotation(attestorId: string, orderRef: string, record: Record<string, unknown>) {
  return {
    attestor_id: attestorId,
    order_ref: orderRef,
    uri: `pubky://${attestorId}/pub/pubky.app/marketplace/v1/attestor/annotations/${orderRef}`,
    outcomes: [],
    revision: 1,
    record,
    indexed_at: 1_792_590_000_000,
  };
}
