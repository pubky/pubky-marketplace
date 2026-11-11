// One-shot ops probe: check/synchronize a listing with an existing test identity.
// Grant minting requires an account on the service's configured homeserver.
// Set MARKETPLACE_PROBE_SECRET_HEX (32-byte secret hex, never logged),
// MARKETPLACE_SERVICE_URL and an allowed MARKETPLACE_GRANT_CLIENT_ID.
//   node scripts/probe-listing-registration.mjs <sellerPubky> <listingId>
import { Keypair, Pubky } from '@synonymdev/pubky';
import { mintMarketplaceGrantSessionForSigner } from './lib/marketplace-grant-session.mjs';
import { withCleanup } from './lib/with-cleanup.mjs';

const SERVICE_URL = process.env.MARKETPLACE_SERVICE_URL ?? '';
if (!SERVICE_URL) throw new Error('set MARKETPLACE_SERVICE_URL to the service to probe');
const CLIENT_ID = process.env.MARKETPLACE_GRANT_CLIENT_ID ?? 'shop.pubky.app';

const [sellerPubky, listingId] = process.argv.slice(2);
if (!sellerPubky || !listingId) {
  console.error('usage: probe-listing-registration.mjs <sellerPubky> <listingId>');
  process.exit(2);
}
const secretHex = process.env.MARKETPLACE_PROBE_SECRET_HEX ?? '';
if (!/^[0-9a-f]{64}$/i.test(secretHex)) {
  throw new Error('set MARKETPLACE_PROBE_SECRET_HEX to an existing test account secret (64 hex characters)');
}
const keypair = Keypair.fromSecret(new Uint8Array(Buffer.from(secretHex, 'hex')));
const pubky = new Pubky();
console.log(`probe identity: ${keypair.publicKey.z32()}`);
const session = await mintMarketplaceGrantSessionForSigner({
  client: pubky,
  keypair,
  clientId: CLIENT_ID,
  serviceUrl: SERVICE_URL,
});

async function probe() {
  const aggregateId = `listing:${sellerPubky}_${listingId}`;
  const readProjection = async () => {
    const response = await fetch(`${SERVICE_URL}/v1/listings/${encodeURIComponent(aggregateId)}`, {
      headers: { authorization: `Bearer ${session.token}` },
    });
    return { status: response.status, body: await response.text() };
  };

  const first = await readProjection();
  console.log(`projection read (${aggregateId}): HTTP ${first.status}`);
  console.log(first.body);
  if (first.status !== 404) return first.status === 200 ? 0 : 1;

  // Unregistered: issue `listing.sync` as this (buyer) identity — the service
  // fetches the canonical seller-signed record from the homeserver itself, so
  // the actor does not need to be the seller. Snake_case wire per ADR-0019 §3
  // (the app converts its camelCase contracts at the transport boundary).
  const syncResponse = await fetch(`${SERVICE_URL}/v1/commands`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.token}`,
    },
    body: JSON.stringify({
      version: 1,
      command_id: crypto.randomUUID(),
      aggregate_id: aggregateId,
      expected_revision: 0,
      issued_at: new Date().toISOString(),
      kind: 'listing.sync',
      payload: { seller_pubky: sellerPubky, listing_id: listingId },
    }),
  });
  console.log(`listing.sync command: HTTP ${syncResponse.status}`);
  console.log(await syncResponse.text());

  const second = await readProjection();
  console.log(`projection re-read (${aggregateId}): HTTP ${second.status}`);
  console.log(second.body);
  return second.status === 200 ? 0 : 1;
}

await withCleanup(
  async () => {
    process.exitCode = await probe();
  },
  async () => {
    const revoked = await fetch(`${SERVICE_URL}/v1/auth/sessions/${encodeURIComponent(session.sessionId)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${session.token}` },
    }).catch(() => null);
    if (!revoked?.ok)
      throw new Error(`Probe service session revocation failed: HTTP ${revoked?.status ?? 'unavailable'}`);
  },
);
