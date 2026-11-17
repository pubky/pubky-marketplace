/**
 * Isolated launch fixture: real Pubky SDK approvals and browser persistence,
 * synthetic homeserver/marketplace responses. No application store or DOM is
 * seeded. This proves browser integration, not deployed-service verification.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const SELLER_SECRET_HEX = '00'.repeat(32);
const SELLER = '8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo';
const HOMESERVER = 'tkrq8zmwb8a3m9k15csu3q17qmfgqnp9dskbrg9uq1rydpyxp7qy';
const HOMESERVER_ORIGIN = 'https://legacy-cookie.test';
const RELAY = 'https://launch-relay.test/inbox/';
const SHOP_CLIENT_ID = 'shop.pubky.app';
const SHOP_CAPABILITIES = '/pub/pubky.app/:rw,/priv/pubky.app/:rw,/pub/chat/v0/:rw,/priv/chat/v0/:rw';
const SERVICE_CAPABILITIES = '/pub/pubky.app/marketplace-service/v1/:rw,/priv/pubky.app/:rw';
const SDK_PATH = '/__launch_sdk.js';
const HELPER_PATH = '/__launch_fixture';

// Public signed DNS packets for the synthetic zero-key identity and its
// synthetic homeserver. They contain neither a signer secret nor a session.
const PKARR_PACKETS = {
  [SELLER]:
    'XTDocF4Xf6HpVOBIowal9ggCGKv383XHTY9OHqmQRvRPd+0uJDBTxrKwIUzoaERgl/4+DWme0M3YTe3XfM1wBAAGZRcomIAAAACAAAAAAAEAAAAABl9wdWJreTQ4cGlueHhncXM0MW40YWlkaWRlbnc1YXBxcDF1cmZtemR6dHI4anQ0YWJya2RuNDM1ZXdvAABBAAEAAA4QADgAADR0a3JxOHptd2I4YTNtOWsxNWNzdTNxMTdxbWZncW5wOWRza2JyZzl1cTFyeWRweXhwN3F5AA==',
  [HOMESERVER]:
    'FSgcCvQf4IDHyAtpTkQvSSCN3RsLYv7QC1vNT3qOf9nhNFbL89xLKYGT7LAfAeBLX723CTWU1v5jzB2PCWZnDwAGZRcomIAAAACAAAAAAAEAAAAANHRrcnE4em13YjhhM205azE1Y3N1M3ExN3FtZmdxbnA5ZHNrYnJnOXVxMXJ5ZHB5eHA3cXkAAEEAAQAADhAAFgABDWxlZ2FjeS1jb29raWUEdGVzdAA=',
};

const EMPTY_BOOTSTRAP = {
  users: [],
  posts: [],
  files: [],
  notifications: [],
  indexed: true,
  ids: { stream: [], influencers: [], recommended: [], hot_tags: [] },
};

// The listing seller's public rails exactly as `GET /v0/sellers/{pubky}/payment-config`
// answers with `USDT_PAYMENTS_ENABLED` off: booleans only, never the PayPal email.
// Bitcoin is enabled and Paykit-ready, PayPal has a stored merchant email.
export const PUBLIC_PAYMENT_CONFIG = Object.freeze({
  bitcoin_available: true,
  bitcoin_offer_available: true,
  paypal_available: true,
});

function localOrigin(value, label) {
  const url = new URL(value);
  assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), `${label} must use a loopback fixture`);
  return url.origin;
}

function sameCapabilities(actual, expected) {
  const parts = Array.isArray(actual) ? actual : String(actual).split(',');
  return (
    parts.length === expected.split(',').length && [...parts].sort().join(',') === expected.split(',').sort().join(',')
  );
}

/**
 * `clientRegion` is the visitor country the Shop's `/api/marketplace/client-region` route answers
 * (an uppercase ISO alpha-2 code), or null when the edge cannot tell: what a launch run with a
 * region policy needs from the fixture.
 */
export async function installSyntheticLaunchFixture({
  context,
  baseUrl,
  serviceUrl,
  nexusUrl,
  root,
  clientRegion = /** @type {string | null} */ (null),
}) {
  assert(
    clientRegion === null || /^[A-Z]{2}$/.test(clientRegion),
    'The synthetic client region is null or an ISO alpha-2 code',
  );
  const origin = localOrigin(baseUrl, 'Synthetic launch app');
  const nexusOrigin = localOrigin(nexusUrl, 'Synthetic launch Nexus');
  const serviceOrigin = new URL(serviceUrl).origin;
  assert.equal(new URL(serviceUrl).protocol, 'https:', 'The inventory SDK requires an HTTPS service origin');
  const [sdkSource, appConfig, serviceConfig, parity, listingFixture] = await Promise.all([
    readFile(path.join(root, 'node_modules/@synonymdev/pubky/index.js'), 'utf8'),
    readFile(path.join(root, 'src/config/app.ts'), 'utf8'),
    readFile(path.join(root, 'src/core/services/marketplace/marketplace-session-grant.ts'), 'utf8'),
    readFile(path.join(root, 'src/test/fixtures/auth/marketplace-grant-priv-parity.staging.json'), 'utf8'),
    readFile(path.join(root, 'src/test/e2e/fixtures/nexus/canonical-listing.json'), 'utf8'),
  ]);
  assert(appConfig.includes(`CAPABILITIES = '${SHOP_CAPABILITIES}'`), 'Update the synthetic Shop capability contract');
  assert(appConfig.includes(`SHOP_GRANT_CLIENT_ID = '${SHOP_CLIENT_ID}'`), 'Update the synthetic Shop client contract');
  assert(
    serviceConfig.includes(`MARKETPLACE_SESSION_GRANT = '${SERVICE_CAPABILITIES}'`),
    'Update the synthetic service capability contract',
  );
  const serviceClientId = JSON.parse(parity).parity_request.cid;
  const publicListing = JSON.parse(listingFixture);
  const publicAvailabilityPath = `/v0/listings/${encodeURIComponent(publicListing.ownerPubky)}/${encodeURIComponent(publicListing.listingId)}/availability`;
  const publicPaymentConfigPath = `/v0/sellers/${encodeURIComponent(publicListing.ownerPubky)}/payment-config`;
  const publicConnectorStatusPath = `/v0/sellers/${encodeURIComponent(publicListing.ownerPubky)}/connector-status`;
  const counters = {
    shopApprovals: 0,
    serviceApprovals: 0,
    shopGrantExchanges: 0,
    serviceGrantExchanges: 0,
    proofUploads: 0,
    proofDeletes: 0,
    proofVerifications: 0,
    authorizedSellerListings: 0,
    publicAvailabilityReads: 0,
    publicPaymentConfigReads: 0,
    publicConnectorStatusReads: 0,
    unpublishedSellerPkarrReads: 0,
    authorizedOrderReads: 0,
    authorizedOfferReads: 0,
  };
  const violations = [];
  const relayPackets = new Map();
  const relayWaiters = new Map();
  /** Chat key and conversation records the fixture stores so a read-back after PUT succeeds. */
  const chatRecords = new Map();
  const homeserverSessions = new Map();
  const challenges = new Map();
  const serviceFlows = new Map();
  const serviceTokens = new Set();
  let helper;
  let closed = false;

  await context.addInitScript(
    ({ homeserver, homeserverOrigin, relay, marketplaceUrl, configuredNexus }) => {
      let config;
      Object.defineProperty(window, '__PUBKY_CONFIG__', {
        configurable: true,
        get: () => config,
        set: (value) => {
          config = {
            ...value,
            homeserver,
            homeserverUrl: homeserverOrigin,
            defaultHttpRelay: relay,
            marketplaceUrl,
            nexusUrl: configuredNexus,
            cdnUrl: `${configuredNexus.replace(/\/$/, '')}/static`,
            homegateUrl: configuredNexus,
            marketplaceGrantFlowEnabled: true,
            marketplaceGrantPollMilliseconds: 750,
          };
        },
      });
    },
    {
      homeserver: HOMESERVER,
      homeserverOrigin: HOMESERVER_ORIGIN,
      relay: RELAY,
      marketplaceUrl: serviceUrl,
      configuredNexus: nexusUrl,
    },
  );

  const routeHandler = async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const headers = request.headers();
    const reply = (options) =>
      route.fulfill({
        ...options,
        headers: {
          'access-control-allow-origin': origin,
          'access-control-allow-credentials': 'true',
          'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
          'access-control-allow-headers': headers['access-control-request-headers'] ?? 'authorization,content-type',
          'cache-control': 'no-store',
          ...options.headers,
        },
      });
    const reject = async (reason) => {
      // Never include query strings, relay secrets, bearer headers or bodies.
      const servicePath =
        url.origin === serviceOrigin
          ? ` ${url.pathname
              .split('/')
              .map((segment) => (segment.length > 30 ? '<id>' : segment))
              .join('/')}`
          : '';
      violations.push(`${method} ${url.origin}${servicePath} ${reason}`);
      await reply({ status: 400, json: { error: 'synthetic_fixture_rejected', reason } });
    };
    const bearer = headers.authorization?.replace(/^Bearer\s+/i, '');
    const ownedSession = homeserverSessions.get(bearer);
    try {
      if (url.origin === origin && url.pathname === SDK_PATH && method === 'GET') {
        return await reply({ contentType: 'text/javascript', body: sdkSource });
      }
      if (url.origin === origin && url.pathname === HELPER_PATH && method === 'GET') {
        return await reply({
          contentType: 'text/html',
          body: '<!doctype html><title>Synthetic launch SDK helper</title>',
        });
      }
      if (method === 'OPTIONS') return await reply({ status: 204 });
      if (['pkarr.pubky.app', 'pkarr.pubky.org'].includes(url.hostname) && method === 'GET') {
        const identity = url.pathname.slice(1);
        const packet = PKARR_PACKETS[identity];
        // The fixture listing's seller has no homeserver here; a relay answers 404 for an unpublished key.
        if (!packet && identity === publicListing.ownerPubky) {
          counters.unpublishedSellerPkarrReads += 1;
          return await reply({ status: 404, body: '' });
        }
        if (!packet) return await reject('unknown_pkarr_identity');
        return await reply({ contentType: 'application/octet-stream', body: Buffer.from(packet, 'base64') });
      }
      if (url.origin === new URL(RELAY).origin && url.pathname.startsWith('/inbox/')) {
        if (method === 'POST') {
          const bytes = request.postDataBuffer();
          if (!bytes?.length) return await reject('empty_relay_approval');
          relayPackets.set(url.href, bytes);
          for (const resolve of relayWaiters.get(url.href) ?? []) resolve(bytes);
          relayWaiters.delete(url.href);
          return await reply({ status: 200, body: '' });
        }
        if (method === 'DELETE') {
          relayPackets.delete(url.href);
          return await reply({ status: 204 });
        }
        if (method === 'GET') {
          const packet =
            relayPackets.get(url.href) ??
            (await new Promise((resolve) => {
              const waiting = relayWaiters.get(url.href) ?? [];
              waiting.push(resolve);
              relayWaiters.set(url.href, waiting);
            }));
          return await reply({
            status: packet ? 200 : 410,
            contentType: 'application/octet-stream',
            body: packet ?? '',
          });
        }
        return await reject('unexpected_relay_operation');
      }
      if (url.origin === HOMESERVER_ORIGIN) {
        if (url.pathname === '/info' && method === 'GET') return await reply({ json: { features: [] } });
        if (url.pathname === '/auth/grant/session') {
          if (method === 'POST') {
            const body = request.postDataJSON();
            const claims = JSON.parse(Buffer.from(body.grant.split('.')[1], 'base64url').toString('utf8'));
            const shop = claims.client_id === SHOP_CLIENT_ID;
            if (
              claims.iss !== SELLER ||
              (!shop && claims.client_id !== serviceClientId) ||
              !sameCapabilities(claims.caps, shop ? SHOP_CAPABILITIES : SERVICE_CAPABILITIES)
            ) {
              return await reject('unexpected_grant_identity_or_capabilities');
            }
            const token = `synthetic-homeserver-${randomUUID()}`;
            const info = {
              homeserver: HOMESERVER,
              pubky: claims.iss,
              client_id: claims.client_id,
              capabilities: claims.caps,
              grant_id: claims.jti,
              token_expires_at: Math.floor(Date.now() / 1000) + 3600,
              grant_expires_at: claims.exp,
              created_at: claims.iat,
            };
            homeserverSessions.set(token, info);
            counters[shop ? 'shopGrantExchanges' : 'serviceGrantExchanges'] += 1;
            return await reply({ json: { token, session: info } });
          }
          if (!ownedSession) return await reject('unknown_homeserver_bearer');
          if (method === 'GET') return await reply({ json: ownedSession });
          if (method === 'DELETE') {
            homeserverSessions.delete(bearer);
            return await reply({ status: 204 });
          }
        }
        const proof = [...challenges.values()].find((candidate) => candidate.proofPath === url.pathname);
        if (proof) {
          if (!ownedSession || ownedSession.client_id !== SHOP_CLIENT_ID)
            return await reject('proof_without_shop_grant');
          if (method === 'PUT') {
            if (!isDeepStrictEqual(request.postDataJSON(), proof.document))
              return await reject('proof_document_mismatch');
            proof.uploaded = true;
            counters.proofUploads += 1;
            return await reply({ status: 204 });
          }
          if (method === 'DELETE') {
            proof.deleted = true;
            counters.proofDeletes += 1;
            return await reply({ status: 204 });
          }
        }
        // Chat identity provisioning after sign-in: the private and public key
        // records are written, read back and listed like any homeserver file.
        const chatRecord = /^\/(priv|pub)\/chat\/v0\//.test(url.pathname);
        if (chatRecord && method === 'GET') {
          if (url.pathname.endsWith('/')) return await reply({ body: '' });
          const stored = chatRecords.get(url.pathname);
          return stored === undefined
            ? await reply({ status: 404, body: 'Synthetic record not found' })
            : await reply({ json: stored });
        }
        if (chatRecord && method === 'PUT' && ownedSession?.client_id === SHOP_CLIENT_ID) {
          let record;
          try {
            record = request.postDataJSON();
          } catch {
            return await reject('unexpected_homeserver_operation');
          }
          chatRecords.set(url.pathname, record);
          return await reply({ status: 204 });
        }
        if (method === 'GET') {
          if (url.pathname.endsWith('/profile.json'))
            return await reply({ json: { name: 'Synthetic launch seller', bio: 'Local fixture' } });
          if (url.pathname.endsWith('/last_read')) return await reply({ json: { timestamp: Date.now() } });
          if (url.pathname.endsWith('/feeds/') || url.pathname.endsWith('/mutes/')) return await reply({ body: '' });
          if (url.pathname === '/events-stream')
            return await reply({ contentType: 'text/event-stream', body: ': synthetic fixture\n\n' });
          return await reply({ status: 404, body: 'Synthetic record not found' });
        }
        // Normal first-login preferences and the automatic moderation follow.
        if (
          method === 'PUT' &&
          ownedSession?.client_id === SHOP_CLIENT_ID &&
          (/^\/pub\/pubky\.app\/(settings\.json|last_read)$/.test(url.pathname) ||
            /^\/pub\/pubky\.app\/follows\/[a-z0-9]{52}$/.test(url.pathname))
        ) {
          return await reply({ status: 204 });
        }
        return await reject('unexpected_homeserver_operation');
      }
      if (url.origin === origin && url.pathname.includes('/api/')) {
        const endpoint = url.pathname.slice(url.pathname.indexOf('/api/'));
        if (endpoint === '/api/fx-rate' && method === 'GET')
          return await reply({ status: 503, json: { error: 'synthetic_rate_unavailable' } });
        if (endpoint === '/api/marketplace/client-region' && method === 'GET')
          return await reply({ json: { country: clientRegion } });
        if (endpoint === '/api/marketplace/session' && method === 'DELETE') return await reply({ status: 204 });
        if (endpoint === '/api/marketplace/bootstrap-challenges' && method === 'POST') {
          if (request.postDataJSON().pubky !== SELLER) return await reject('bootstrap_identity_mismatch');
          const id = randomUUID();
          const nonce = randomBytes(32).toString('base64url');
          const proofPath = `/pub/pubky.app/marketplace/v1/cli-grant-proofs/${id}`;
          const document = { challenge_id: id, pubky: SELLER, nonce, aud: origin };
          challenges.set(id, { nonce, document, proofPath, uploaded: false, deleted: false, consumed: false });
          return await reply({
            status: 201,
            json: {
              challenge_id: id,
              expires_at: new Date(Date.now() + 120_000).toISOString(),
              nonce,
              proof_document: document,
              proof_uri: `pubky://${SELLER}${proofPath}`,
              result_cpk: 'synthetic-result-key',
              result_delivery_id: randomUUID(),
            },
          });
        }
        const verify = endpoint.match(/^\/api\/marketplace\/bootstrap-challenges\/([^/]+)\/verify$/);
        if (verify && method === 'POST') {
          const challenge = challenges.get(verify[1]);
          if (
            !challenge?.uploaded ||
            challenge.deleted ||
            challenge.consumed ||
            request.postDataJSON().nonce !== challenge.nonce
          ) {
            return await reject('bootstrap_proof_not_uploaded_or_nonce_invalid');
          }
          challenge.consumed = true;
          counters.proofVerifications += 1;
          const stateId = randomUUID();
          const authorizationUrl = await helper.evaluate(
            async ({ stateId, capabilities, clientId, relay }) => {
              const { sdk, flows } = window.__launchSdkFixture;
              const flow = await sdk.GrantAuthFlow.startDelegated(capabilities, sdk.AuthFlowKind.signin(), {
                clientId,
                relay,
                approvalFormat: 'bareGrant',
              });
              const entry = { flow, status: 'awaiting' };
              flows.set(stateId, entry);
              void flow
                .awaitApproval()
                .then(async (session) => {
                  const info = await session.grant.sessionInfo();
                  entry.status = 'connected';
                  entry.pubky = session.info.publicKey.z32();
                  entry.clientId = info.clientId;
                  entry.capabilities = [...info.capabilities];
                })
                .catch(() => {
                  if (entry.status !== 'cancelled') entry.status = 'failed';
                });
              return flow.authorizationUrl;
            },
            { stateId, capabilities: SERVICE_CAPABILITIES, clientId: serviceClientId, relay: RELAY },
          );
          const expiresAt = new Date(Date.now() + 120_000).toISOString();
          serviceFlows.set(stateId, { token: randomBytes(32).toString('base64url'), counted: false });
          return await reply({
            json: { authorization_url: authorizationUrl, expires_at: expiresAt, state_id: stateId, status: 'awaiting' },
          });
        }
        const flowRequest = endpoint.match(/^\/api\/marketplace\/bootstrap-flows\/([^/]+)\/(status|cancel)$/);
        if (flowRequest && method === 'POST') {
          const stateId = flowRequest[1];
          const flow = serviceFlows.get(stateId);
          if (!flow) return await reject('unknown_bootstrap_flow');
          if (flowRequest[2] === 'cancel') {
            await helper.evaluate((id) => {
              const entry = window.__launchSdkFixture.flows.get(id);
              if (entry && entry.status !== 'connected') {
                entry.status = 'cancelled';
                entry.flow.free();
              }
            }, stateId);
            return await reply({ json: { status: 'cancelled' } });
          }
          const result = await helper.evaluate((id) => {
            const entry = window.__launchSdkFixture.flows.get(id);
            return {
              status: entry.status,
              pubky: entry.pubky,
              clientId: entry.clientId,
              capabilities: entry.capabilities,
            };
          }, stateId);
          if (result.status !== 'connected') return await reply({ json: { status: result.status, state_id: stateId } });
          if (
            result.pubky !== SELLER ||
            result.clientId !== serviceClientId ||
            !sameCapabilities(result.capabilities, SERVICE_CAPABILITIES)
          ) {
            return await reject('approved_service_grant_mismatch');
          }
          if (!flow.counted) {
            flow.counted = true;
            counters.serviceApprovals += 1;
            serviceTokens.add(flow.token);
          }
          return await reply({
            json: {
              status: 'connected',
              state_id: stateId,
              token: flow.token,
              pubky: SELLER,
              capabilities: SERVICE_CAPABILITIES,
              expires_at: new Date(Date.now() + 3_600_000).toISOString(),
            },
          });
        }
        return await reject('unexpected_same_origin_api');
      }
      if (url.origin === serviceOrigin) {
        if (method === 'GET' && url.pathname === '/health')
          return await reply({ json: { ok: true, fixture: 'synthetic-launch' } });
        if (method === 'GET' && url.pathname === publicAvailabilityPath) {
          counters.publicAvailabilityReads += 1;
          return await reply({
            json: {
              aggregate_id: `listing:${publicListing.ownerPubky}_${publicListing.listingId}`,
              state: publicListing.state,
              server_time: new Date().toISOString(),
            },
          });
        }
        if (method === 'GET' && url.pathname.startsWith('/v0/drops/'))
          return await reply({ status: 404, json: { error: 'not_found' } });
        if (method === 'GET' && url.pathname === publicPaymentConfigPath) {
          counters.publicPaymentConfigReads += 1;
          return await reply({ json: PUBLIC_PAYMENT_CONFIG });
        }
        if (method === 'GET' && url.pathname === publicConnectorStatusPath) {
          counters.publicConnectorStatusReads += 1;
          return await reply({
            json: { kind: 'connector_status', seller_pubky: publicListing.ownerPubky, stores: [] },
          });
        }
        if (!serviceTokens.has(bearer)) return await reject('service_request_without_approved_bearer');
        if (
          method === 'GET' &&
          url.pathname === `/v1/sellers/${SELLER}/listings` &&
          url.searchParams.get('limit') === '100'
        ) {
          counters.authorizedSellerListings += 1;
          return await reply({ json: { listings: [], next_cursor: null } });
        }
        if (method === 'GET' && url.pathname === '/v1/notifications')
          return await reply({ json: { notifications: [] } });
        if (method === 'GET' && url.pathname === '/v1/orders') {
          counters.authorizedOrderReads += 1;
          return await reply({ json: { orders: [] } });
        }
        if (method === 'GET' && url.pathname === '/v1/offers') {
          counters.authorizedOfferReads += 1;
          return await reply({ json: { offers: [] } });
        }
        if (method === 'GET' && url.pathname === '/v1/me/priv-keys')
          return await reply({
            status: 503,
            json: {
              schema_version: 1,
              ok: false,
              error: { code: 'priv_keys_unavailable', message: 'Synthetic fixture has no private data keys.' },
            },
          });
        return await reject('unexpected_marketplace_operation');
      }
      if (url.origin === nexusOrigin) {
        if (method !== 'GET') return await reject('unexpected_nexus_mutation');
        if (url.pathname === `/v0/bootstrap/${SELLER}`) return await reply({ json: EMPTY_BOOTSTRAP });
        if (url.pathname.startsWith(`/v0/user/${SELLER}/`) || url.pathname === '/v0/tags/hot')
          return await reply({ json: [] });
        return await route.continue();
      }
      if (url.origin === origin && (method === 'GET' || method === 'HEAD')) return await route.continue();
      return await reject('unexpected_network_operation');
    } catch (error) {
      if (closed) return;
      violations.push(`${method} ${url.origin} fixture_handler_failed:${error?.name ?? 'Error'}`);
      await reply({ status: 500, json: { error: 'synthetic_fixture_handler_failed' } }).catch(() => undefined);
    }
  };
  await context.route('**/*', routeHandler);
  helper = await context.newPage();
  await helper.goto(`${origin}${HELPER_PATH}`);
  await helper.evaluate(async () => {
    const { default: sdk } = await import('/__launch_sdk.js');
    window.__launchSdkFixture = { sdk, flows: new Map() };
  });

  return {
    sellerSecretHex: SELLER_SECRET_HEX,
    async approveAuthRequest(secretHex, authorizationUrl) {
      assert.equal(secretHex, SELLER_SECRET_HEX, 'Synthetic approvals accept only the documented zero-key identity');
      const url = new URL(authorizationUrl);
      assert.equal(url.protocol, 'pubkyauth:');
      assert.equal(url.hostname, 'signin_grant', 'Synthetic launch rejects legacy cookie authentication');
      assert.equal(
        url.searchParams.get('relay')?.replace(/\/$/, ''),
        RELAY.replace(/\/$/, ''),
        'Synthetic approval must use the isolated relay',
      );
      const shop = url.searchParams.get('cid') === SHOP_CLIENT_ID;
      assert(shop || url.searchParams.get('cid') === serviceClientId, 'Unexpected grant client');
      assert(
        sameCapabilities(url.searchParams.get('caps'), shop ? SHOP_CAPABILITIES : SERVICE_CAPABILITIES),
        'Unexpected grant capabilities',
      );
      assert(!url.searchParams.has('af'), 'Synthetic launch uses bare grants without encryption-key delivery');
      await helper.evaluate(async (authUrl) => {
        const { sdk } = window.__launchSdkFixture;
        await new sdk.Pubky().signer(sdk.Keypair.fromSecret(new Uint8Array(32))).approveAuthRequest(authUrl);
      }, authorizationUrl);
      if (shop) counters.shopApprovals += 1;
    },
    summary() {
      const checks = {
        'shop-sdk-grant-approved': counters.shopApprovals > 0 && counters.shopGrantExchanges > 0,
        'service-sdk-grant-approved': counters.serviceApprovals > 0 && counters.serviceGrantExchanges > 0,
        'bootstrap-proof-uploaded-verified-deleted':
          counters.proofUploads > 0 && counters.proofVerifications > 0 && counters.proofDeletes > 0,
        'seller-listings-authorized': counters.authorizedSellerListings > 0,
        'listing-payment-config-read': counters.publicPaymentConfigReads > 0,
        'no-unexpected-network-operations': violations.length === 0,
      };
      return {
        mode: 'synthetic-isolated',
        checks,
        ...counters,
        violations: [...violations],
        realSdkApprovals: counters.shopApprovals > 0 && counters.serviceApprovals > 0,
        bootstrapProofVerified:
          counters.proofUploads > 0 && counters.proofVerifications > 0 && counters.proofDeletes > 0,
        authorizedInventoryRead: counters.authorizedSellerListings > 0,
        isolated: violations.length === 0,
      };
    },
    async close() {
      closed = true;
      for (const waiting of relayWaiters.values()) for (const resolve of waiting) resolve(null);
      relayWaiters.clear();
      await helper.close();
      await context.unroute('**/*', routeHandler);
    },
  };
}
