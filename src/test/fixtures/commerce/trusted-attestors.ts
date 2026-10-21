import type { MarketplaceTrustedAttestor } from '@/libs/runtime-config/runtime-config.schema';

/**
 * The attestor the unit-test runtime config trusts (`src/config/test.ts` sets
 * `PUBKY_RUNTIME_MARKETPLACE_TRUSTED_ATTESTORS` to this entry). VRT files mock
 * the runtime getter with it. Not a real service key.
 */
export const TEST_TRUSTED_ATTESTOR: MarketplaceTrustedAttestor = {
  pubky: 'wj3drgzdpnf54rxf5d8qd3dqne14j8umgczgrdp95w77zuxmxfu9',
  label: 'Pubky Market',
  validFrom: '2026-01-01T00:00:00Z',
};

function base64UrlJson(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * A structurally valid purchase-attestation JWS with the given issuer and
 * `iat` (seconds). The signature is zeros: enough for `parsePurchaseAttestation`,
 * never for `verifyPurchaseAttestation`.
 */
export function purchaseAttestationJwsFixture({ iss, iat }: { iss: string; iat: number }): string {
  const header = base64UrlJson({ alg: 'EdDSA', typ: 'pubky-purchase-attestation+v1' });
  const claims = base64UrlJson({
    v: 1,
    iss,
    sub: 'b'.repeat(52),
    cpk: 's'.repeat(52),
    role: 'buyer_reviewing_seller',
    listing: `pubky://${'s'.repeat(52)}/pub/pubky.app/marketplace/v1/listings/0032SSN7Q4EVG`,
    order_ref: 'a'.repeat(64),
    completed_on: '2026-08-21',
    iat,
  });
  const zeroSignature = 'A'.repeat(86); // 64 zero bytes, base64url
  return `${header}.${claims}.${zeroSignature}`;
}
