#!/usr/bin/env node
// Which hosts a store (`PUBKY_RUNTIME_STORE_SELLER`) reaches, from the browser and from its Next.js server, while a
// guest browses, a buyer signs in for the first time, the seller signs in to their selling tools and the grant BFF
// checks the homeserver proof of a user on the configured homeserver and of one on another homeserver. A store reads
// no Nexus and no CDN, so the check starts a production build in store mode with no Nexus, marketplace-Nexus or CDN
// URL set, and fails on any request to a host it cannot attribute, to a Nexus or CDN host, or on an error naming one
// of their URLs. It also fails unless the store shows its seller's catalog, read from the seller's homeserver.
//
// The BFF proof needs HTTPS on port 443 to a public address, which no testnet homeserver serves, so both proofs must
// be refused. The store's Pkarr relay is a recording proxy in front of the testnet relay, which shows how far each
// proof got: the user lookup through the configured relays, and for the other homeserver its own signed record. That
// homeserver is a key with a record published to the testnet relay, naming a host that does not resolve.
//
// Needs a production build (`npm run build`; this check never builds), the pubky-docker testnet (homeserver on
// :6286 with its admin API on :6288, Pkarr relay on :15411, HTTP relay on :15412, Postgres on :5432 for the BFF's
// state; see scripts/ci-chat-e2e.sh) and Playwright's Chromium. Server connections are read through
// scripts/lib/connection-log.mjs, browser requests (service worker included) through Playwright. Starts `next start`
// on STORE_TRAFFIC_PORT (default 3101) with the sandbox commerce mode, so no transaction service is needed, and the
// relay proxy on STORE_TRAFFIC_RELAY_PROXY_PORT (default 15499). Exit 0 only when every check passed.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ed25519 } from '@noble/curves/ed25519.js';
import { blake3 } from '@noble/hashes/blake3.js';
import { chromium } from 'playwright';
import postgres from 'postgres';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PORT = Number(process.env.STORE_TRAFFIC_PORT ?? 3101);
const ORIGIN = `http://localhost:${PORT}`;
const HOMESERVER = process.env.STORE_TRAFFIC_HOMESERVER ?? '8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo';
const ADMIN_URL = process.env.HOMESERVER_ADMIN_URL ?? 'http://localhost:6288/generate_signup_token';
const ADMIN_PASSWORD = process.env.HOMESERVER_ADMIN_PASSWORD ?? 'admin';
const EXCHANGE_RATE_API = 'https://api1.blocktank.to/api/fx/rates/btc';
const MARKETPLACE_URL = 'https://marketplace.invalid';
const SHOP_DATABASE = 'shop-franky';
const RELAY_URL = 'http://localhost:15411';
const RELAY_PROXY_PORT = Number(process.env.STORE_TRAFFIC_RELAY_PROXY_PORT ?? 15499);
const POSTGRES_URL = process.env.STORE_TRAFFIC_POSTGRES_URL ?? 'postgres://test_user:test_pass@localhost:5432';
const BFF_DATABASE = 'store_traffic_bff';
const OTHER_HOMESERVER_HOST = 'homeserver.other-homeserver.invalid';
const INDEX_URL_NAMES = ['PUBKY_RUNTIME_NEXUS_URL', 'PUBKY_RUNTIME_MARKETPLACE_NEXUS_URL', 'PUBKY_RUNTIME_CDN_URL'];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Every host a store may reach in this check, and why. Anything else fails it. */
const ATTRIBUTED = new Map([
  [`localhost:${PORT}`, 'the store itself'],
  ['localhost:6286', 'homeserver (profiles, shop, listings, media, sessions)'],
  ['localhost:15411', 'Pkarr relay (homeserver resolution)'],
  [`localhost:${RELAY_PROXY_PORT}`, "Pkarr relay through this check's recording proxy, PUBKY_RUNTIME_PKARR_RELAYS"],
  ['localhost:5432', 'grant BFF state, SHOP_BFF_GRANT_STATE_DATABASE_URL (server only)'],
  ['localhost:15412', 'HTTP relay (grant sign-in link)'],
  ['api1.blocktank.to:443', 'price feed, PUBKY_RUNTIME_EXCHANGE_RATE_API (server only)'],
  ['marketplace.invalid:443', "the store's marketplace service, PUBKY_RUNTIME_MARKETPLACE_URL (unreachable here)"],
]);
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const ARTIFACTS = process.env.STORE_TRAFFIC_ARTIFACTS ?? mkdtempSync(join(tmpdir(), 'store-traffic-artifacts-'));
mkdirSync(ARTIFACTS, { recursive: true });
const results = [];
function check(id, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? ` — ${detail}` : ''}`);
}

function hostKey(host, port) {
  return `${LOOPBACK.has(host) ? 'localhost' : host}:${port}`;
}

function isIndexHost(key) {
  return /nexus|cdn/iu.test(key) || key.endsWith(':8080');
}

// 1. Two accounts on the testnet homeserver; the seller publishes a profile with an avatar, a shop and listings.
const sdk = await import('@synonymdev/pubky');
const pubky = sdk.Pubky.testnet();

async function createAccount(label) {
  const keypair = sdk.Keypair.random();
  const signer = pubky.signer(keypair);
  const homeserver = sdk.PublicKey.from(HOMESERVER);
  try {
    await signer.signup(homeserver, null);
  } catch {
    const response = await fetch(ADMIN_URL, { headers: { 'X-Admin-Password': ADMIN_PASSWORD } });
    await signer.signup(homeserver, (await response.text()).trim());
  }
  return { label, keypair, id: keypair.publicKey.z32() };
}

// A 1×1 PNG, for the seller's avatar and the listing photo.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function listingRecord(seller, listingId, title, state) {
  const media = `pubky://${seller}/pub/pubky.app/marketplace/v1/media/photo_01`;
  return {
    schemaVersion: 1,
    recordType: 'listing',
    ownerPubky: seller,
    revision: 1,
    createdAt: '2026-08-19T20:00:00.000Z',
    updatedAt: '2026-08-19T21:00:00.000Z',
    listingId,
    state,
    title,
    description: 'Seeded by the store-mode traffic check.',
    taxonomyVersion: 2,
    categoryId: 'fashion-shoes-boots',
    condition: 'good',
    tags: ['traffic'],
    location: { countryCode: 'US', region: 'NY' },
    media: [
      {
        id: 'photo_01',
        type: 'image',
        url: media,
        contentHash: createHash('sha256').update(PNG).digest('hex'),
        mimeType: 'image/png',
        byteSize: PNG.byteLength,
        width: 1,
        height: 1,
        altText: title,
      },
    ],
    variants: [{ id: 'variant_01', options: { size: '42' }, quantity: 1, mediaIds: ['photo_01'], enabled: true }],
    sale: {
      format: 'fixed_price',
      unitPrice: { amountMinor: 12_500, currency: 'USD', exponent: 2 },
      acceptsOffers: true,
    },
    fulfillmentMethods: ['physical'],
    package: { weightGrams: 800, lengthMillimeters: 320, widthMillimeters: 220, heightMillimeters: 120 },
    shippingOptions: [
      {
        id: 'ship_01',
        pricing: 'flat',
        label: 'Standard shipping',
        price: { amountMinor: 1_200, currency: 'USD', exponent: 2 },
        estimatedMinDays: 3,
        estimatedMaxDays: 7,
      },
    ],
    returnPolicy: { acceptsReturns: true, returnWindowDays: 30, buyerPaysReturnShipping: true },
    adultOnly: false,
  };
}

const LISTINGS = [
  { id: 'boots_01', title: 'Traffic check boots', state: 'active' },
  { id: 'hat_01', title: 'Traffic check hat', state: 'active' },
  { id: 'lamp_01', title: 'Traffic check paused lamp', state: 'paused' },
];

async function seedSeller(seller) {
  const session = await pubky.signer(seller.keypair).signin('store-traffic-check.invalid');
  const storage = session.storage;
  const blobId = 'TRAFF1CAVATARB10B';
  const fileId = '0034TRAFF1C00';
  await storage.putBytes(`/pub/pubky.app/blobs/${blobId}`, new Uint8Array(PNG));
  await storage.putJson(`/pub/pubky.app/files/${fileId}`, {
    name: 'avatar.png',
    created_at: Date.now() * 1_000,
    src: `pubky://${seller.id}/pub/pubky.app/blobs/${blobId}`,
    content_type: 'image/png',
    size: PNG.byteLength,
  });
  await storage.putJson('/pub/pubky.app/profile.json', {
    name: 'Traffic Seller',
    bio: 'Seeded by the store-mode traffic check.',
    image: `pubky://${seller.id}/pub/pubky.app/files/${fileId}`,
    links: [],
  });
  await storage.putJson('/pub/pubky.app/marketplace/v1/shop.json', {
    schemaVersion: 1,
    recordType: 'shop',
    ownerPubky: seller.id,
    revision: 1,
    createdAt: '2026-08-19T20:00:00.000Z',
    updatedAt: '2026-08-19T21:00:00.000Z',
    name: 'Traffic Check Store',
    bio: 'A store with no index.',
    location: { countryCode: 'US', region: 'NY' },
    shippingPolicy: 'Ships within three business days.',
    returnPolicy: 'Returns accepted within 30 days.',
    vacationMode: false,
  });
  await storage.putBytes('/pub/pubky.app/marketplace/v1/media/photo_01', new Uint8Array(PNG));
  for (const { id, title, state } of LISTINGS) {
    await storage.putJson(`/pub/pubky.app/marketplace/v1/listings/${id}`, listingRecord(seller.id, id, title, state));
  }
}

// 2. Grant sign-in through the store's sign-in link, approved by a Node signer (as src/test/e2e/chat-two-accounts.mjs).
async function readAuthUrl(page) {
  await page.evaluate(() => {
    if (window.__copyHooked) return;
    window.__copyHooked = true;
    navigator.clipboard.writeText = async (text) => {
      window.__copied = text;
    };
  });
  await page.evaluate(() => {
    window.__copied = null;
  });
  const slot = page.locator('[data-testid="qr-auth-url"]').first();
  await slot.waitFor({ state: 'attached', timeout: 30_000 });
  await slot.locator('xpath=ancestor::button[1]').click();
  const handle = await page.waitForFunction(
    () => (typeof window.__copied === 'string' && window.__copied.startsWith('pubkyauth://') ? window.__copied : null),
    null,
    { timeout: 10_000 },
  );
  return await handle.jsonValue();
}

function relayChannelOf(authUrl) {
  const link = sdk.SigninGrantDeepLink.parse(authUrl);
  try {
    const secret = link.secret;
    const epk = link.ephemeralPublicKey;
    const input = secret
      ? secret
      : Buffer.concat([Buffer.from('pubky-grant-relay-channel-v1'), Buffer.from([0]), Buffer.from(epk)]);
    return { relay: link.baseRelayUrl, channel: Buffer.from(blake3(input)).toString('base64url') };
  } finally {
    link.free();
  }
}

// The first load of a profile creates the database and remounts the sign-in page, cancelling its first link.
async function loadSignInPage(page) {
  await page.goto(`${ORIGIN}/sign-in`, { waitUntil: 'domcontentloaded' });
  const deadline = Date.now() + 60_000;
  for (;;) {
    const ready = await page.evaluate(async (name) => {
      if (!(await indexedDB.databases()).some((database) => database.name === name && database.version > 1)) {
        return false;
      }
      return await new Promise((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => {
          const hasSchema = request.result.objectStoreNames.contains('chat_messages');
          request.result.close();
          resolve(hasSchema);
        };
        request.onerror = () => reject(request.error);
      });
    }, SHOP_DATABASE);
    if (ready) break;
    if (Date.now() > deadline) throw new Error(`the store never created its ${SHOP_DATABASE} database`);
    await sleep(50);
  }
  await page.goto(`${ORIGIN}/sign-in`, { waitUntil: 'domcontentloaded' });
}

// A link counts only while the page still polls it on its relay and has started no newer flow.
async function readLiveAuthUrl(page, events) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const url = await readAuthUrl(page);
    const { relay, channel } = relayChannelOf(url);
    const onRelay = events.filter((event) => event.url.startsWith(relay));
    const ownStart = onRelay.findIndex((event) => event.kind === 'start' && event.url.endsWith(`/${channel}`));
    if (ownStart !== -1) {
      const after = onRelay.slice(ownStart);
      const latestOwn = after.filter((event) => event.url.endsWith(`/${channel}`)).at(-1);
      const newer = after.some((event) => event.kind === 'start' && !event.url.endsWith(`/${channel}`));
      if (latestOwn.kind === 'start' && !newer) return url;
    }
    await sleep(200);
  }
  throw new Error('no sign-in link stayed live');
}

async function signIn(page, events, account, profileName) {
  await loadSignInPage(page);
  const url = await readLiveAuthUrl(page, events);
  await pubky.signer(account.keypair).approveAuthRequest(url);
  await page.waitForFunction(
    () => {
      try {
        const state = JSON.parse(localStorage.getItem('shop-auth-store') ?? '{}').state ?? {};
        return typeof state.grantSessionRecordId === 'string' && state.grantSessionRecordId.length > 0;
      } catch {
        return false;
      }
    },
    null,
    { timeout: 60_000 },
  );
  await page.waitForFunction(() => !location.pathname.startsWith('/sign-in'), null, { timeout: 60_000 });
  if (page.url().includes('/complete-profile')) {
    await page.getByPlaceholder('Enter your name').fill(profileName);
    await page.getByRole('button', { name: 'Finish' }).click();
    await page.waitForFunction(
      () => JSON.parse(localStorage.getItem('shop-auth-store') ?? '{}').state?.hasProfile === true,
      null,
      { timeout: 60_000 },
    );
  }
}

// The grant BFF's state lives in a scratch database on the testnet's Postgres, migrated as a deployment would be.
async function prepareBffDatabase() {
  const admin = postgres(`${POSTGRES_URL}/postgres`, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${BFF_DATABASE}`);
    await admin.unsafe(`CREATE DATABASE ${BFF_DATABASE}`);
  } finally {
    await admin.end();
  }
  const database = postgres(`${POSTGRES_URL}/${BFF_DATABASE}`, { max: 1, onnotice: () => {} });
  try {
    for (const file of ['0001_shop_grant_bff.sql', '0002_shop_grant_bff_cli.sql']) {
      await database.unsafe(readFileSync(join(ROOT, 'db/bff', file), 'utf8'));
    }
  } finally {
    await database.end();
  }
}

function bffEnv() {
  const seed = () => randomBytes(32).toString('hex');
  return {
    SHOP_BFF_GRANT_FLOW_ENABLED: 'true',
    SHOP_ALLOWED_ORIGINS: JSON.stringify([ORIGIN]),
    SHOP_PUBLIC_ORIGIN: ORIGIN,
    MARKETPLACE_SERVICE_URL: MARKETPLACE_URL,
    SHOP_BFF_GRANT_STATE_DATABASE_URL: `${POSTGRES_URL}/${BFF_DATABASE}`,
    CRON_SECRET: randomBytes(32).toString('hex'),
    SHOP_GRANT_ASSERTION_ISSUER: ORIGIN,
    SHOP_GRANT_ASSERTION_KEY_ID: 'store-traffic-assertion',
    SHOP_GRANT_ASSERTION_KEY_EPOCH: '1',
    SHOP_GRANT_ASSERTION_SIGNING_KEY: seed(),
    MARKETPLACE_SERVICE_REQUEST_KEY_ID: 'store-traffic-request',
    MARKETPLACE_SERVICE_REQUEST_KEY_EPOCH: '1',
    MARKETPLACE_SERVICE_REQUEST_SIGNING_KEY: seed(),
    SHOP_BFF_GRANT_STATE_ENCRYPTION_KEY_B64: randomBytes(32).toString('base64'),
    SHOP_BFF_GRANT_STATE_KEY_EPOCH: '1',
  };
}

// Every request the store makes to its configured Pkarr relay, forwarded to the testnet relay.
const relayRequests = [];
const relayProxy = createServer(async (request, response) => {
  relayRequests.push(`${request.method} ${new URL(request.url, RELAY_URL).pathname}`);
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const headers = Object.fromEntries(
    Object.entries(request.headers).filter(([name]) => !['host', 'connection', 'content-length'].includes(name)),
  );
  try {
    const upstream = await fetch(`${RELAY_URL}${request.url}`, {
      method: request.method,
      headers,
      body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    response.writeHead(
      upstream.status,
      Object.fromEntries(
        [...upstream.headers].filter(
          ([name]) => !['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(name),
        ),
      ),
    );
    response.end(body);
  } catch {
    response.writeHead(502).end();
  }
});

// Another homeserver: a key whose own Pkarr record names an HTTPS host that does not resolve.
function encodeName(name) {
  return [...name.split('.').flatMap((label) => [label.length, ...Buffer.from(label)]), 0];
}

function u16(value) {
  return [value >> 8, value & 0xff];
}

async function publishOtherHomeserver() {
  const keypair = sdk.Keypair.random();
  const z32 = keypair.publicKey.z32();
  const data = [...u16(1), ...encodeName(OTHER_HOMESERVER_HOST)];
  const packet = Uint8Array.from([
    ...[...u16(0), ...u16(0x8000), ...u16(0), ...u16(1), ...u16(0), ...u16(0)],
    ...encodeName(z32),
    ...[...u16(65), ...u16(1), 0, 0, 0x0e, 0x10],
    ...[...u16(data.length), ...data],
  ]);
  const timestamp = BigInt(Date.now()) * 1_000n;
  const signable = Buffer.concat([Buffer.from(`3:seqi${timestamp}e1:v${packet.length}:`), packet]);
  const time = Buffer.alloc(8);
  time.writeBigUInt64BE(timestamp);
  const payload = Buffer.concat([ed25519.sign(signable, keypair.secret()), time, packet]);
  const response = await fetch(`${RELAY_URL}/${z32}`, { method: 'PUT', body: payload });
  if (!response.ok) throw new Error(`the testnet relay refused the other homeserver's record: ${response.status}`);
  return { keypair, z32 };
}

// The browser bootstrap's challenge and verify calls, made from a store page so the browser sets Origin and
// Sec-Fetch-Site itself.
async function bffPost(page, path, body) {
  return await page.evaluate(
    async ({ path, body }) => {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      try {
        return { status: response.status, json: JSON.parse(text) };
      } catch {
        return { status: response.status, json: null, text: text.slice(0, 200) };
      }
    },
    { path, body },
  );
}

function described(result) {
  return `${result.status} ${JSON.stringify(result.json ?? result.text ?? null).slice(0, 200)}`;
}

// 3. Browser traffic and errors, per context.
const browserRequests = [];
const indexErrors = [];

function watch(context, label) {
  const events = [];
  context.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'ws:' || url.protocol === 'wss:') {
      const port = url.port || (url.protocol === 'https:' || url.protocol === 'wss:' ? '443' : '80');
      browserRequests.push({ label, key: hostKey(url.hostname, port), url: request.url() });
    }
    events.push({ kind: 'start', url: request.url() });
  });
  context.on('requestfinished', (request) => events.push({ kind: 'finished', url: request.url() }));
  context.on('requestfailed', (request) => events.push({ kind: 'failed', url: request.url() }));
  context.on('page', (page) => {
    page.on('pageerror', (error) => noteError(label, String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') noteError(label, message.text());
    });
  });
  return events;
}

function noteError(label, text) {
  if (INDEX_URL_NAMES.some((name) => text.includes(name))) indexErrors.push(`${label}: ${text.slice(0, 300)}`);
}

async function visit(page, path) {
  await page.goto(`${ORIGIN}${path}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await sleep(4_000);
}

async function shows(page, text, timeout = 30_000) {
  return await page
    .getByText(text, { exact: true })
    .first()
    .waitFor({ state: 'visible', timeout })
    .then(() => true)
    .catch(() => false);
}

async function snap(page, name) {
  await page.screenshot({ path: join(ARTIFACTS, `${name}.png`), fullPage: true }).catch(() => {});
}

async function waitForServer(server) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`next start exited with code ${server.exitCode}`);
    try {
      if ((await fetch(`${ORIGIN}/api/build`, { signal: AbortSignal.timeout(2_000) })).ok) return;
    } catch {
      // Not listening yet.
    }
    await sleep(1_000);
  }
  throw new Error(`next start did not answer ${ORIGIN}/api/build within 120s`);
}

if (!existsSync(join(ROOT, '.next', 'BUILD_ID'))) {
  console.error('No production build in .next; run `npm run build` first. This check never builds.');
  process.exit(1);
}

const seller = await createAccount('seller');
const buyer = await createAccount('buyer');
await seedSeller(seller);
const otherHomeserver = await publishOtherHomeserver();
const traveler = { keypair: sdk.Keypair.random() };
traveler.id = traveler.keypair.publicKey.z32();
await pubky.signer(traveler.keypair).pkdns.publishHomeserverForce(otherHomeserver.keypair.publicKey);
await prepareBffDatabase();
await new Promise((resolve) => relayProxy.listen(RELAY_PROXY_PORT, 'localhost', resolve));
console.log(`seller ${seller.id}, buyer ${buyer.id}, other-homeserver user ${traveler.id} on ${otherHomeserver.z32}`);

const connectionLog = join(mkdtempSync(join(tmpdir(), 'store-traffic-')), 'connections.jsonl');
writeFileSync(connectionLog, '');
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('PUBKY_RUNTIME_')));
const output = [];
const server = spawn(process.execPath, [join(ROOT, 'node_modules/next/dist/bin/next'), 'start', '-p', String(PORT)], {
  cwd: ROOT,
  env: {
    ...baseEnv,
    NODE_ENV: 'production',
    NODE_OPTIONS: `${baseEnv.NODE_OPTIONS ?? ''} --import=${pathToFileURL(join(ROOT, 'scripts/lib/connection-log.mjs')).href}`,
    CONNECTION_LOG: connectionLog,
    NEXT_TELEMETRY_DISABLED: '1',
    PUBKY_RUNTIME_ENV: 'production',
    PUBKY_RUNTIME_TESTNET: 'true',
    PUBKY_RUNTIME_HOMESERVER: HOMESERVER,
    PUBKY_RUNTIME_HOMESERVER_URL: 'http://localhost:6286',
    PUBKY_RUNTIME_HOMEGATE_URL: 'http://localhost:6300',
    PUBKY_RUNTIME_PKARR_RELAYS: JSON.stringify([`http://localhost:${RELAY_PROXY_PORT}`]),
    PUBKY_RUNTIME_DEFAULT_HTTP_RELAY: 'http://localhost:15412/link/',
    PUBKY_RUNTIME_EXCHANGE_RATE_API: EXCHANGE_RATE_API,
    PUBKY_RUNTIME_COMMERCE_ADAPTER_MODE: 'sandbox',
    PUBKY_RUNTIME_MARKETPLACE_URL: MARKETPLACE_URL,
    PUBKY_RUNTIME_STORE_SELLER: seller.id,
    ...bffEnv(),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (chunk) => output.push(chunk));
server.stderr.on('data', (chunk) => output.push(chunk));

const shopPath = `/marketplace/shop/${seller.id}`;
let browser;
try {
  await waitForServer(server);
  browser = await chromium.launch();

  // A guest opens the store and a listing.
  const guest = await browser.newContext();
  watch(guest, 'guest');
  const guestPage = await guest.newPage();
  await visit(guestPage, '/');
  check('guest lands on the store seller shop', new URL(guestPage.url()).pathname === shopPath, guestPage.url());
  check(
    'the shop shows its active listings',
    (await shows(guestPage, 'Traffic check boots')) && (await shows(guestPage, 'Traffic check hat')),
  );
  check('the shop hides its paused listing', !(await shows(guestPage, 'Traffic check paused lamp', 2_000)));
  await visit(guestPage, `/marketplace/listing/${seller.id}/boots_01`);
  const listingShown = await shows(guestPage, 'Traffic check boots');
  if (!listingShown) await snap(guestPage, 'guest-listing');
  check('a guest opens a listing', listingShown, guestPage.url());
  await guest.close();

  // A buyer signs in for the first time, completes a profile and browses.
  const buyerContext = await browser.newContext();
  const buyerEvents = watch(buyerContext, 'buyer');
  const buyerPage = await buyerContext.newPage();
  await signIn(buyerPage, buyerEvents, buyer, 'Traffic Buyer');
  check('the buyer signs in and completes a profile', true);
  for (const path of [
    '/',
    `/marketplace/listing/${seller.id}/hat_01`,
    '/marketplace/watchlist',
    '/marketplace/notifications',
    '/marketplace/cart',
    '/marketplace/orders',
    '/settings/account',
  ]) {
    await visit(buyerPage, path);
  }
  await buyerContext.close();

  // The seller signs in: their avatar comes from their homeserver and the dashboard lists every own listing.
  const sellerContext = await browser.newContext();
  const sellerEvents = watch(sellerContext, 'seller');
  const sellerPage = await sellerContext.newPage();
  await signIn(sellerPage, sellerEvents, seller, 'Traffic Seller');
  await visit(sellerPage, shopPath);
  const avatar = await sellerPage
    .waitForFunction(
      () =>
        [...document.querySelectorAll('img')].some(
          (img) => img.complete && img.naturalWidth > 0 && /^blob:|\/pub\/pubky\.app\/blobs\//u.test(img.src),
        ),
      null,
      { timeout: 30_000 },
    )
    .then(() => true)
    .catch(() => false);
  check("the seller's avatar loads from their homeserver", avatar);
  await visit(sellerPage, '/marketplace/dashboard');
  check('the dashboard lists the paused listing too', await shows(sellerPage, 'Traffic check paused lamp'));
  await visit(sellerPage, '/marketplace/storefront');
  await sellerContext.close();

  // The grant BFF checks a homeserver proof: the buyer's, published on the configured homeserver, which serves plain
  // HTTP; then that of a user on another homeserver, which a store accepts as a candidate and must resolve through
  // that homeserver's own record. Both must be refused, each only after its lookups went through the configured relay.
  const bffContext = await browser.newContext();
  watch(bffContext, 'bff');
  const bffPage = await bffContext.newPage();
  await visit(bffPage, '/');
  const buyerChallenge = await bffPost(bffPage, '/api/marketplace/bootstrap-challenges', { pubky: buyer.id });
  check('the grant BFF issues a challenge in a store', buyerChallenge.status === 201, described(buyerChallenge));
  if (buyerChallenge.status === 201) {
    const {
      challenge_id: challengeId,
      nonce,
      proof_document: proofDocument,
      proof_uri: proofUri,
    } = buyerChallenge.json;
    const session = await pubky.signer(buyer.keypair).signin('store-traffic-check.invalid');
    await session.storage.putJson(proofUri.slice(`pubky://${buyer.id}`.length), proofDocument);
    const before = relayRequests.length;
    const verify = await bffPost(bffPage, `/api/marketplace/bootstrap-challenges/${challengeId}/verify`, { nonce });
    check(
      "the BFF refuses a proof on the testnet's plain-HTTP homeserver",
      verify.status === 401 && verify.json?.error === 'homeserver_proof_invalid',
      described(verify),
    );
    check(
      "the BFF looks the buyer's homeserver up through the configured relay",
      relayRequests.slice(before).includes(`GET /${buyer.id}`),
      relayRequests.slice(before).join(', '),
    );
  }
  const travelerChallenge = await bffPost(bffPage, '/api/marketplace/bootstrap-challenges', { pubky: traveler.id });
  if (travelerChallenge.status !== 201) {
    check('the grant BFF issues a challenge to a user on another homeserver', false, described(travelerChallenge));
  } else {
    const before = relayRequests.length;
    const verify = await bffPost(
      bffPage,
      `/api/marketplace/bootstrap-challenges/${travelerChallenge.json.challenge_id}/verify`,
      { nonce: travelerChallenge.json.nonce },
    );
    const lookups = relayRequests.slice(before);
    check(
      'the BFF refuses a proof on another homeserver whose host does not resolve',
      verify.status === 401 && verify.json?.error === 'homeserver_proof_invalid',
      described(verify),
    );
    check(
      'the BFF resolves the other homeserver through its own record on the configured relay',
      lookups.includes(`GET /${traveler.id}`) && lookups.includes(`GET /${otherHomeserver.z32}`),
      lookups.join(', '),
    );
  }
  await bffContext.close();
} catch (error) {
  check('store traffic run', false, error instanceof Error ? error.message : String(error));
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  relayProxy.close();
}

// 4. The verdict: every host attributed, none an index, no error naming an index URL.
const serverConnections = readFileSync(connectionLog, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .map(({ host, port }) => ({ key: hostKey(host, port) }));
const serverLog = Buffer.concat(output).toString();

function summarize(label, entries) {
  const counts = new Map();
  for (const { key } of entries) counts.set(key, (counts.get(key) ?? 0) + 1);
  console.log(`\n${label} hosts:`);
  for (const [key, count] of [...counts].sort()) {
    console.log(`  ${key.padEnd(28)} ${String(count).padStart(5)}  ${ATTRIBUTED.get(key) ?? 'NOT ATTRIBUTED'}`);
    if (key === `localhost:${PORT}`) continue;
    const paths = new Set(
      entries.filter((entry) => entry.key === key && entry.url).map(({ url }) => new URL(url).pathname),
    );
    for (const path of [...paths].sort().slice(0, 8)) console.log(`      ${path.slice(0, 100)}`);
    if (paths.size > 8) console.log(`      … ${paths.size - 8} more paths`);
  }
  return [...counts.keys()];
}

const browserHosts = summarize('Browser', browserRequests);
const serverHosts = summarize('Next server', serverConnections);
console.log('');
check(
  'the browser reached only attributed hosts',
  browserHosts.every((key) => ATTRIBUTED.has(key)),
  browserHosts.filter((key) => !ATTRIBUTED.has(key)).join(', '),
);
check(
  'the server reached only attributed hosts',
  serverHosts.every((key) => ATTRIBUTED.has(key)),
  serverHosts.filter((key) => !ATTRIBUTED.has(key)).join(', '),
);
const indexHosts = [...browserHosts, ...serverHosts].filter(isIndexHost);
check('no request to a Nexus or CDN host', indexHosts.length === 0, indexHosts.join(', '));
const serverIndexErrors = serverLog.split('\n').filter((line) => INDEX_URL_NAMES.some((name) => line.includes(name)));
check(
  'no error names a Nexus or CDN URL',
  indexErrors.length === 0 && serverIndexErrors.length === 0,
  [...indexErrors, ...serverIndexErrors].slice(0, 5).join(' | '),
);
check('the browser made requests at all', browserRequests.length > 0, `${browserRequests.length} requests`);

if (results.includes(false)) {
  console.log(serverLog.slice(-4_000));
  process.exit(1);
}
console.log(`All ${results.length} store-mode traffic checks passed.`);
