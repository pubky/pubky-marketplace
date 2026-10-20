#!/usr/bin/env node
// Paid digital delivery proof (design decision DD4): one real Bitcoin purchase per delivery kind, with the
// release-proof test seats. ON PRODUCTION THIS SPENDS REAL MONEY. Every mode but `plan` refuses unless PROOF_ORIGIN,
// PROOF_SERVICE and PROOF_NEXUS are the staging stack (digital-proof.mjs, STAGING_TARGET), or PROOF_ALLOW_PRODUCTION=1
// says otherwise on purpose. Modes that spend or publish also need EXPECTED_DPL to be what the origin serves right
// now, and today's go-ahead token from the product owner (PROOF_DIGITAL_GO=GO-<UTC date>). Run `plan` first: it
// touches nothing.
//
// What it automates: publishing one "SMOKE FIXTURE, do not buy" digital listing per kind from the seller seat and setting
// its delivery; checkout, Bitcoin and Pay as the buyer seat; waiting for the order to be paid; then the delivery
// checks on both sides; then teardown and verification.
// What it cannot automate, by design: paying the Bitkit Payment Request (a real wallet holds the buyer's funds),
// emailing the tester mailbox, and sending a message in chat. Those are the operator's, and the script waits for
// each and prints exactly what to do.
//
//   node production-digital-fixture.mjs plan                 print the plan and check the environment; no network
//   node production-digital-fixture.mjs proof               setup, then per kind buy + settle, then teardown + verify
//   node production-digital-fixture.mjs setup               publish the listings and set their delivery
//   node production-digital-fixture.mjs buy <kind>          buyer checkout, Pay, wait for the operator's payment
//   node production-digital-fixture.mjs settle <kind>       delivery checks for a paid order
//   node production-digital-fixture.mjs teardown            delete listings and ciphertext, revoke run sessions, verify
//   node production-digital-fixture.mjs verify              verification only
//
// External buyer (PROOF_EXTERNAL_BUYER=1, no buyer seat): a person pays from their own wallet.
//   node production-digital-fixture.mjs prepare             make the fixture file and the state file; reads only service health and the FX feed
//   node production-digital-fixture.mjs publish             publish the prepared listing(s); the first step that touches the Shop
//   node production-digital-fixture.mjs await-buyer         as the seller: wait for the order, confirm the seen Bitcoin payment,
//                                                           wait for the buyer's delivery evidence (PROOF_DIGITAL_WAIT_MIN, default 90)
// Rehearsal on a stack where a buyer seat exists: PROOF_SELLER_CONFIRMS_ELSEWHERE=1 lets `buy` pay without confirming as
// the seller, so a second process running await-buyer is the seller.
//
// Env: PROOF_EVIDENCE (state and results; outside the repository), seats and both PROOF_*_PREFIX values (see
// seats.mjs), EXPECTED_DPL, PROOF_DIGITAL_GO, PROOF_DIGITAL_KINDS (default file), PROOF_DIGITAL_PRICE_USD (default
// 2.00), PROOF_DIGITAL_PAY_TIMEOUT_MIN (default 25), PROOF_DIGITAL_BUYER_EMAIL (required for the email kind: a
// mailbox the tester controls; redacted from the log and the evidence JSON, masked in screenshots), PROOF_ORIGIN, PROOF_SERVICE, PROOF_NEXUS, PROOF_RELAY,
// PROOF_FIXTURE_PHOTO, PROOF_ALLOW_PRODUCTION (1 to run against anything but staging), PROOF_DIGITAL_EMAIL_SCREENSHOTS
// (1 to save the email kind's screenshots; they are not saved by default, and any saved screenshot has the mailbox masked).
// Exit 0 only when every check passed. Paid orders cannot be deleted; they stay as the proof's evidence.
// Also driven by the service's hold-smoke (HOLD_SMOKE_DIGITAL_FIXTURE_CMD): prepare + publish before a run, teardown after.
// Runbook: docs/ecommerce/release.md, "Paid digital delivery proof".
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import {
  DELIVERABLES_PREFIX,
  deploymentRefusal,
  describePlan,
  DIGITAL_KINDS,
  expectedCheckoutLine,
  expectedCurrentSummary,
  extractDpl,
  formatSizeLabel,
  hasGoAhead,
  isInstantKind,
  isStagingTarget,
  KIND_RADIO_LABEL,
  listingTitle,
  makeFixtureFile,
  maskedScreenshot,
  newDeliverablePaths,
  newRunId,
  parseBtcUsdRate,
  parseKinds,
  parsePayTimeoutMinutes,
  parsePositiveMinutes,
  parsePriceUsd,
  pathFromPubkyUrl,
  payOutcome,
  priceClearsMinimum,
  redactSensitive,
  screenshotPolicy,
  sha256Hex,
  targetRefusal,
} from './digital-proof.mjs';
import { evidenceDir, loadBuyerSeat, loadSellerSeat, prefix, repoRequire, shopCapabilities } from './seats.mjs';

const { chromium } = repoRequire('playwright');
const { AuthFlowKind, Pubky } = repoRequire('@synonymdev/pubky');

const ORIGIN = process.env.PROOF_ORIGIN ?? 'https://shop.pubky.app';
const SERVICE = process.env.PROOF_SERVICE ?? 'https://marketplace-service-production-ce23.up.railway.app';
const NEXUS = process.env.PROOF_NEXUS ?? 'https://nexusd-production-7108.up.railway.app';
const RELAY = process.env.PROOF_RELAY ?? 'https://httprelay.pubky.app/inbox';
const FX_FEED = process.env.PROOF_FX_FEED ?? 'https://api1.blocktank.to/api/fx/rates/btc';
const PHOTO = process.env.PROOF_FIXTURE_PHOTO ?? join(dirname(fileURLToPath(import.meta.url)), 'fixture-photo.png');
const CLIENT_ID = 'release-proof-digital';

const mode = process.argv[2] ?? '';
const kindArg = process.argv[3] ?? '';
const MODES = ['plan', 'proof', 'setup', 'prepare', 'publish', 'await-buyer', 'buy', 'settle', 'teardown', 'verify'];
const EXTERNAL = process.env.PROOF_EXTERNAL_BUYER === '1';
if (EXTERNAL && ['proof', 'buy', 'settle'].includes(mode)) {
  throw new Error('PROOF_EXTERNAL_BUYER=1 has no buyer seat: use prepare, publish, await-buyer, teardown, verify');
}
if (!MODES.includes(mode)) throw new Error(`usage: production-digital-fixture.mjs ${MODES.join('|')} [kind]`);
if ((mode === 'buy' || mode === 'settle') && !DIGITAL_KINDS.includes(kindArg)) {
  throw new Error(`usage: production-digital-fixture.mjs ${mode} <${DIGITAL_KINDS.join('|')}>`);
}

const TARGET = { origin: ORIGIN, service: SERVICE, nexus: NEXUS };
if (mode !== 'plan') {
  const refusal = targetRefusal(TARGET, process.env);
  if (refusal) throw new Error(refusal);
}

const kinds = parseKinds(process.env.PROOF_DIGITAL_KINDS);
const price = parsePriceUsd(process.env.PROOF_DIGITAL_PRICE_USD);
const payTimeoutMs = parsePayTimeoutMinutes(process.env.PROOF_DIGITAL_PAY_TIMEOUT_MIN) * 60_000;
const buyerEmail = process.env.PROOF_DIGITAL_BUYER_EMAIL ?? '';
const spends = ['proof', 'setup', 'publish', 'await-buyer', 'buy', 'settle'].includes(mode);
const waitMs = parsePositiveMinutes(process.env.PROOF_DIGITAL_WAIT_MIN, 90) * 60_000;

if (mode === 'plan') {
  console.log(describePlan({ kinds, priceText: price.text, origin: ORIGIN, service: SERVICE }).join('\n'));
  console.log(
    isStagingTarget(TARGET)
      ? 'target: the staging stack'
      : `target: NOT the staging stack (nexus ${NEXUS}); every mode but plan refuses unless PROOF_ALLOW_PRODUCTION=1`,
  );
  console.log(
    "go-ahead needed to run: PROOF_DIGITAL_GO=GO-<today, UTC, YYYY-MM-DD>, set only on the product owner's instruction; it expires at the end of that UTC day",
  );
  if (!process.env.EXPECTED_DPL) console.log('NOTE: EXPECTED_DPL is not set; a run needs it');
  if (kinds.includes('email') && !buyerEmail)
    console.log('NOTE: PROOF_DIGITAL_BUYER_EMAIL is not set; the email kind needs it');
  process.exit(0);
}
if (spends && !hasGoAhead(process.env)) {
  throw new Error(
    "refusing to start: this run spends real money. PROOF_DIGITAL_GO must be GO-<today's UTC date>, and is set only on the product owner's go-ahead",
  );
}
if (spends && !process.env.EXPECTED_DPL) throw new Error('set EXPECTED_DPL to the dpl_… id now aliased to the origin');
if (spends && (!process.env.PROOF_SELLER_PREFIX || (!EXTERNAL && !process.env.PROOF_BUYER_PREFIX))) {
  throw new Error('set PROOF_SELLER_PREFIX and PROOF_BUYER_PREFIX: a paid run must not start on a swapped seat');
}
if (spends && (kinds.includes('email') || kindArg === 'email') && !buyerEmail) {
  throw new Error('set PROOF_DIGITAL_BUYER_EMAIL to the tester mailbox for the email kind');
}
if (spends && !existsSync(PHOTO)) throw new Error(`fixture photo missing: ${PHOTO}`);

const CAPABILITIES = shopCapabilities();
const OUT = evidenceDir();
const STATE_PATH = join(OUT, 'digital-fixture-state.json');
const FILE_PATH = join(OUT, 'digital-fixture-file.bin');

const redact = (text) => redactSensitive(text, buyerEmail);
const log = (line) => console.log(redact(line));

const seller = loadSellerSeat();
const buyer = EXTERNAL ? null : loadBuyerSeat();
const sellerPubky = seller.publicKey.z32();
const buyerPubky = buyer ? buyer.publicKey.z32() : null;
if (sellerPubky === buyerPubky) throw new Error('the seller and buyer seats are the same identity');

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail: redact(detail) });
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  return Boolean(ok);
};
const notes = [];
const note = (name, detail) => {
  notes.push({ name, detail: redact(detail) });
  log(`NOTE ${name} — ${detail}`);
};

const readState = () => (existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, 'utf8')) : null);
const writeState = (state) => {
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  chmodSync(STATE_PATH, 0o600);
};
const listingPath = (id) => `/marketplace/listing/${sellerPubky}/${id}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const EMAIL_SCREENSHOTS = process.env.PROOF_DIGITAL_EMAIL_SCREENSHOTS === '1';

// Every screenshot goes through here. Screenshots are not redacted like the log, so the tester mailbox is painted
// over, and the email kind saves none unless PROOF_DIGITAL_EMAIL_SCREENSHOTS=1.
async function shot(target, file, { kind = null, fullPage = false } = {}) {
  const policy = screenshotPolicy({ kind, email: buyerEmail, optIn: EMAIL_SCREENSHOTS });
  if (!policy.save) {
    log(
      `screenshot ${file} not saved: it would show the tester mailbox (PROOF_DIGITAL_EMAIL_SCREENSHOTS=1 saves it masked)`,
    );
    return;
  }
  await maskedScreenshot(target, { path: join(OUT, file), email: policy.mask ? buyerEmail : '', fullPage });
}

// The origin must be serving the deployment the run was authorized against.
async function expectedDeploymentRefusal() {
  const found = extractDpl(
    await (await fetch(`${ORIGIN}/marketplace`, { signal: AbortSignal.timeout(30_000) })).text(),
  );
  return { found, refusal: deploymentRefusal({ found, expected: process.env.EXPECTED_DPL }) };
}

async function operator(prompt) {
  if (!process.stdin.isTTY) {
    throw new Error(`an operator step is needed and there is no terminal to answer it: ${prompt}`);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    log(`\n>>> OPERATOR: ${prompt}`);
    await rl.question('>>> press Enter when done, or Ctrl-C to stop (teardown still runs on the next teardown): ');
  } finally {
    rl.close();
  }
}

// ---- browser helpers ---------------------------------------------------------------------------

async function openBrowser() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
  const page = await context.newPage();
  const commands = [];
  page.on('response', (response) => {
    const request = response.request();
    if (request.method() !== 'POST' || !/\/v1\/commands/.test(new URL(request.url()).pathname)) return;
    const kind = ((request.postData() || '').match(/"kind"\s*:\s*"([^"]+)"/) || [])[1] || 'unknown';
    commands.push({ kind, status: response.status() });
  });
  return { browser, page, commands };
}

async function waitForAppReady(page) {
  await page.waitForFunction(
    () =>
      !/^\s*Loading\.{0,3}\s*$/.test(document.body?.innerText ?? '') && (document.body?.innerText ?? '').length > 40,
    null,
    { timeout: 180_000 },
  );
}

async function copyAuthUrl(page, label) {
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await page.getByRole('button', { name: label }).first().click();
  const handle = await page.waitForFunction(
    async () => {
      const text = await navigator.clipboard.readText();
      return text.startsWith('pubkyauth://') ? text : null;
    },
    null,
    { timeout: 20_000 },
  );
  return handle.jsonValue();
}

async function ringSignIn(page, seat) {
  await page.goto(`${ORIGIN}/sign-in`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  await waitForAppReady(page);
  await new Pubky().signer(seat).approveAuthRequest(await copyAuthUrl(page, 'Copy authentication link'));
  await page.waitForFunction(
    (expected) => {
      const raw = localStorage.getItem('shop-auth-store') ?? localStorage.getItem('auth-store');
      const state = raw ? (JSON.parse(raw).state ?? {}) : {};
      return (
        state.currentUserPubky === expected &&
        (typeof state.grantSessionRecordId === 'string' || typeof state.sessionExport === 'string')
      );
    },
    seat.publicKey.z32(),
    { timeout: 180_000 },
  );
  await page.waitForTimeout(2500);
}

async function approveMarketplaceSession(page, seat) {
  for (let i = 0; i < 4; i += 1) {
    if (
      !(await page
        .getByRole('dialog')
        .isVisible()
        .catch(() => false))
    )
      break;
    const copy = page.getByRole('button', { name: /Copy (authentication|authorization) link/i }).first();
    if (!(await copy.isVisible().catch(() => false))) break;
    const label = ((await copy.innerText()).match(/Copy (?:authentication|authorization) link/i) || [
      'Copy authorization link',
    ])[0];
    await new Pubky().signer(seat).approveAuthRequest(await copyAuthUrl(page, label));
    await page.waitForTimeout(5000);
  }
}

async function signOut(page) {
  await page.goto(`${ORIGIN}/settings/account`, { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
  const button = page.locator('#sign-out-btn');
  await button.waitFor({ state: 'visible', timeout: 30_000 });
  await button.click();
  await page.waitForURL(/\/sign-in/, { timeout: 60_000 }).catch(() => {});
  const raw = await page.evaluate(() => localStorage.getItem('shop-auth-store') ?? localStorage.getItem('auth-store'));
  return raw === null || !JSON.parse(raw)?.state?.currentUserPubky;
}

async function pickCategoryLeaf(page) {
  const trigger = page.locator('#marketplace-category-level-0');
  await trigger.waitFor({ state: 'visible', timeout: 60_000 });
  await trigger.click();
  const everything = page.getByRole('option', { name: 'Everything else' });
  if (await everything.count()) await everything.click();
  else await page.getByRole('option').first().click();
  await page.waitForTimeout(400);
  for (let depth = 1; depth < 6; depth += 1) {
    const next = page.locator(`#marketplace-category-level-${depth}`);
    if (!(await next.count()) || !(await next.isVisible().catch(() => false))) break;
    await next.click();
    const opts = page.getByRole('option');
    if ((await opts.count()) === 0) break;
    await opts.first().click();
    await page.waitForTimeout(400);
  }
}

async function emptyCart(page) {
  await page.goto(`${ORIGIN}/marketplace/cart`, { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
  for (let n = 0; n < 8; n += 1) {
    const remove = page.getByRole('button', { name: /^Remove / }).first();
    if (!(await remove.count())) break;
    await remove.click();
    await page.waitForTimeout(700);
  }
  return page.getByRole('button', { name: /^Remove / }).count();
}

// ---- service helpers ---------------------------------------------------------------------------

async function nexusListingsByTitle(title) {
  const res = await fetch(`${NEXUS}/v0/stream/listings?seller_id=${encodeURIComponent(sellerPubky)}&limit=50`);
  const rows = res.ok ? await res.json().catch(() => []) : [];
  return {
    status: res.status,
    ids: (Array.isArray(rows) ? rows : []).filter((row) => row?.title === title).map((row) => row.id),
  };
}

async function mintBearer(seat) {
  const client = new Pubky();
  const flow = client.startCookieAuthFlow(CAPABILITIES, AuthFlowKind.signin(), RELAY);
  const tokenPromise = flow.awaitToken();
  await client.signer(seat).approveAuthRequest(flow.authorizationUrl);
  const token = await tokenPromise;
  const response = await fetch(`${SERVICE}/v1/auth/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: token.toBytes(),
  });
  const body = await response.json().catch(() => ({}));
  if (response.status !== 201) throw new Error(`bearer mint HTTP ${response.status}`);
  return { token: body.token, sessionId: body.session_id };
}

const revokeSession = async (bearer, id) =>
  (
    await fetch(`${SERVICE}/v1/auth/sessions/${id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${bearer}` },
    })
  ).status;

async function listSessions(bearer) {
  const res = await fetch(`${SERVICE}/v1/auth/sessions`, { headers: { authorization: `Bearer ${bearer}` } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, sessions: body.sessions ?? [] };
}

async function revokeRunSessions(seat, runStart) {
  const fromRun = (row) =>
    !row.revoked_at && Date.parse(row.created_at) >= runStart - 5000 && Date.parse(row.expires_at) > Date.now();
  const audit = await mintBearer(seat);
  const before = await listSessions(audit.token);
  const rows = before.sessions
    .filter(fromRun)
    .sort((a, b) => Number(a.id === audit.sessionId) - Number(b.id === audit.sessionId));
  const statuses = [];
  for (const row of rows) statuses.push(await revokeSession(audit.token, row.id));
  return { listStatus: before.status, statuses };
}

// The ciphertext the seller's homeserver holds under the deliverables folder, as absolute paths.
async function listDeliverables() {
  const session = await new Pubky().signer(seller).signinBlocking(CLIENT_ID);
  try {
    // A seat that has never saved a file has no deliverables folder yet: the homeserver answers 404 for the listing.
    const urls = await session.storage.list(DELIVERABLES_PREFIX, null, false, 1000, false).catch((error) => {
      if (/\b404\b/.test(String(error?.message ?? error))) return [];
      throw error;
    });
    return urls.map(pathFromPubkyUrl).filter(Boolean);
  } finally {
    await session.signout().catch(() => {});
  }
}

async function deleteDeliverables(paths) {
  if (paths.length === 0) return 0;
  const session = await new Pubky().signer(seller).signinBlocking(CLIENT_ID);
  let deleted = 0;
  try {
    for (const path of paths) {
      if (!path.startsWith(DELIVERABLES_PREFIX)) throw new Error('refusing to delete outside the deliverables folder');
      await session.storage.delete(path);
      deleted += 1;
    }
  } finally {
    await session.signout().catch(() => {});
  }
  return deleted;
}

async function serviceCapability() {
  const response = await fetch(`${SERVICE}/health`);
  const body = await response.json().catch(() => ({}));
  return {
    status: response.status,
    available: body.digital_delivery_available === true,
    max: body.digital_delivery_max_bytes,
  };
}

async function btcUsd() {
  try {
    const response = await fetch(FX_FEED);
    return parseBtcUsdRate(await response.json());
  } catch {
    return null;
  }
}

// ---- seller: listing and delivery --------------------------------------------------------------

async function fillDigitalListing(page, title) {
  await page.goto(`${ORIGIN}/marketplace/sell`, { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
  const discard = page.getByRole('button', { name: 'Discard draft and start fresh' });
  if (await discard.isVisible().catch(() => false)) {
    await discard.click();
    await page.waitForTimeout(1500);
  }
  await approveMarketplaceSession(page, seller);
  await page.locator('[data-surface="seller-studio"] input[type="file"]').first().setInputFiles(PHOTO);
  await page.getByRole('button', { name: /Add photos \(1\/8\)/ }).waitFor({ state: 'visible', timeout: 120_000 });
  await page
    .getByLabel(/^Photo description$/i)
    .first()
    .fill('Digital delivery proof fixture cover photo');
  await page.getByLabel(/^Title$/i).fill(title);
  await page
    .getByLabel(/^Description$/i)
    .fill('Staging smoke fixture for the release hold-smoke (digital delivery). Do not purchase.');
  await pickCategoryLeaf(page);
  await page.locator('#listing-section-price').scrollIntoViewIfNeeded();
  const priceField = page.getByLabel(/^Price \(USD\)$/i).first();
  await priceField.fill(price.text);
  await page.locator('#listing-section-shipping').scrollIntoViewIfNeeded();
  const fieldset = page.getByTestId('listing-delivery-options');
  await fieldset.waitFor({ state: 'visible', timeout: 60_000 });
  const digital = fieldset.getByRole('checkbox', { name: 'Digital delivery' });
  if (!(await digital.isChecked())) await digital.click();
  for (const name of ['Ship', 'Local pickup']) {
    const box = fieldset.getByRole('checkbox', { name });
    if (await box.isChecked().catch(() => false)) await box.click();
  }
  const unlimited = page.getByLabel('Unlimited').first();
  await unlimited.waitFor({ state: 'visible', timeout: 30_000 });
  if (!(await unlimited.isChecked())) await unlimited.click();
  await page
    .getByTestId('listing-section-rail')
    .getByRole('button', { name: /Review & publish/i })
    .click();
  await page.waitForTimeout(800);
  await page.waitForFunction(
    () => {
      const button = [...document.querySelectorAll('button')].find(
        (el) => el.textContent?.trim() === 'Publish listing',
      );
      return Boolean(button && !button.disabled);
    },
    null,
    { timeout: 180_000 },
  );
}

async function setDelivery(page, kind, fixture) {
  const editor = page.locator('[data-surface="digital-delivery-editor"]');
  await editor.waitFor({ state: 'visible', timeout: 120_000 });
  await editor.getByRole('radio', { name: KIND_RADIO_LABEL[kind] }).waitFor({ state: 'visible', timeout: 120_000 });
  await editor.getByRole('radio', { name: KIND_RADIO_LABEL[kind] }).click();
  const detail = {};
  if (kind === 'file') {
    await editor.getByTestId('digital-delivery-file-input').setInputFiles({
      name: fixture.name,
      mimeType: 'application/octet-stream',
      buffer: fixture.bytes,
    });
    await editor.getByTestId('digital-delivery-chosen-file').waitFor({ state: 'visible', timeout: 30_000 });
  } else if (kind === 'link') {
    detail.url = `https://example.com/digital-proof/${randomBytes(6).toString('hex')}`;
    await editor.getByLabel('Link', { exact: true }).fill(detail.url);
  } else if (kind === 'text') {
    detail.text = `PROOF-${randomBytes(9).toString('hex')}`;
    await editor.getByLabel('Text every buyer receives').fill(detail.text);
  }
  await editor.getByRole('button', { name: 'Save delivery' }).click();
  const expected = expectedCurrentSummary(kind, fixture.name, formatSizeLabel(fixture.bytes.length));
  const saved = await page
    .getByTestId('digital-delivery-current')
    .getByText(expected, { exact: true })
    .waitFor({ state: 'visible', timeout: 180_000 })
    .then(
      () => true,
      () => false,
    );
  const error = await editor
    .getByTestId('digital-delivery-error')
    .innerText()
    .catch(() => '');
  return { saved, error, ...detail };
}

async function prepare() {
  if (readState()) throw new Error('a digital fixture state file exists; run teardown before setting up again');
  const runId = newRunId();
  const fixture = makeFixtureFile(runId);
  writeFileSync(FILE_PATH, fixture.bytes, { mode: 0o600 });
  const capability = await serviceCapability();
  check(
    'setup: service reports digital delivery available',
    capability.status === 200 && capability.available,
    `status=${capability.status} max=${capability.max}`,
  );
  if (!(capability.status === 200 && capability.available))
    throw new Error('digital delivery is not available on the service');
  const rate = await btcUsd();
  if (rate === null) note('price floor', 'the BTC/USD rate could not be read; the 1,000-sat floor was not pre-checked');
  else {
    check(
      'setup: the price clears the service floor of 1,000 sats with a 2x margin',
      priceClearsMinimum(price.cents, rate),
      `price=${price.text} rate=${Math.round(rate)}`,
    );
    if (!priceClearsMinimum(price.cents, rate)) throw new Error('raise PROOF_DIGITAL_PRICE_USD');
  }
  writeState({
    runId,
    runStart: null,
    price: price.text,
    fixture: { name: fixture.name, sha256: fixture.sha256, size: fixture.bytes.length },
    kinds,
    deliverablesBefore: null,
    listings: {},
    orders: {},
    phase: 'prepared',
  });
  log(`prepare: run ${runId}, ${fixture.name}, ${fixture.bytes.length} bytes, sha256 ${fixture.sha256}`);
}

async function publish() {
  let state = readState();
  if (state?.phase !== 'prepared') throw new Error('no prepared state file; run prepare first');
  const fixture = { ...state.fixture, bytes: readFileSync(FILE_PATH) };
  if (sha256Hex(fixture.bytes) !== fixture.sha256)
    throw new Error('the fixture file no longer matches its recorded SHA-256');
  const { runId } = state;
  const deliverablesBefore = await listDeliverables();
  state = { ...state, runStart: Date.now(), deliverablesBefore, phase: 'started' };
  writeState(state);
  const { browser, page } = await openBrowser();
  try {
    await ringSignIn(page, seller);
    log(`setup: seller ${prefix(sellerPubky)} run ${runId}`);
    for (const kind of state.kinds) {
      const title = listingTitle(runId, kind);
      state.listings[kind] = { title, id: null, delivery: null };
      writeState(state);
      await fillDigitalListing(page, title);
      await page.getByRole('button', { name: 'Publish listing' }).click();
      await approveMarketplaceSession(page, seller);
      let listingId = null;
      try {
        await page.waitForURL(/\/marketplace\/listing\/[^/]+\/[^/]+\/edit/, { timeout: 180_000 });
        listingId = new URL(page.url()).pathname.split('/').filter(Boolean).slice(-2)[0];
      } catch {
        for (let i = 0; i < 6 && !listingId; i += 1) {
          await sleep(10_000);
          listingId = (await nexusListingsByTitle(title)).ids[0] ?? null;
        }
      }
      if (!listingId)
        throw new Error(`published ${kind} listing not found (the state file keeps the title for teardown)`);
      state.listings[kind].id = listingId;
      writeState(state);
      if (!/\/edit/.test(page.url())) {
        await page.goto(`${ORIGIN}${listingPath(listingId)}/edit`, { waitUntil: 'domcontentloaded' });
        await waitForAppReady(page);
      }
      await approveMarketplaceSession(page, seller);
      const result = await setDelivery(page, kind, fixture);
      check(
        `setup ${kind}: delivery saved on the edit page`,
        result.saved && !result.error,
        result.error || listingId.slice(0, 8),
      );
      if (!result.saved) throw new Error(`delivery for ${kind} did not save`);
      state.listings[kind].delivery = { url: result.url ?? null, text: result.text ?? null };
      writeState(state);
      await shot(page, `digital-setup-${kind}.png`, { kind });
      log(`setup ${kind}: listing ${listingId.slice(0, 8)}`);
    }
    state = {
      ...state,
      phase: 'ready',
      deliverablePaths: newDeliverablePaths(deliverablesBefore, await listDeliverables()),
    };
    writeState(state);
    if (state.kinds.includes('file')) {
      check(
        'setup: the file ciphertext is on the seller homeserver',
        state.deliverablePaths.length >= 1,
        `new=${state.deliverablePaths.length}`,
      );
    }
    await signOut(page).catch(() => false);
  } finally {
    await browser.close();
  }
}

async function setup() {
  await prepare();
  await publish();
}

// ---- buyer: checkout, payment wait -------------------------------------------------------------

async function ordersCard(page, title, orderId = null) {
  await page.goto(`${ORIGIN}/marketplace/orders`, { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
  await page.locator('[data-surface="marketplace-orders"]').waitFor({ state: 'visible', timeout: 60_000 });
  // The page picks a default tab once the orders load, so wait for the counts before choosing All.
  const all = page.getByRole('tab', { name: /^All\s*[1-9]/ }).first();
  await all.waitFor({ state: 'visible', timeout: 60_000 }).catch(async (error) => {
    await shot(page, 'digital-orders-tabs-missing.png').catch(() => {});
    throw error;
  });
  await page.waitForTimeout(1500);
  await all.click();
  await page.waitForTimeout(1500);
  // The same listing can have older expired orders from a retried buy, so pin the order once its id is known.
  const cards = page.locator(orderId ? `#order-${orderId}` : '[id^="order-"]').filter({ hasText: title });
  return orderId ? cards.first() : cards.filter({ hasNotText: /expired|cancell?ed/i }).first();
}

// A seller whose Paykit creator is shared_manual confirms Bitcoin themselves: the order only becomes
// paid when the seller attests receipt, which the Shop offers once the service has seen a matching payment.
async function confirmSeenBitcoin(page, title, kind) {
  const card = await ordersCard(page, title);
  if ((await card.count()) === 0) return false;
  const prompt = card.getByTestId('seller-bitcoin-confirm-prompt');
  if ((await prompt.count()) === 0) return false;
  const facts = (await card.innerText()).replace(/\s+/g, ' ');
  if (!/Amount matched Yes/.test(facts)) return false;
  await shot(page, `digital-seller-confirm-${kind}.png`, { kind });
  await card.getByRole('button', { name: 'Confirm payment received' }).click();
  await page.waitForTimeout(8000);
  log(`buy ${kind}: the seller confirmed receipt of the matched payment`);
  return true;
}

async function buy(kind) {
  const state = readState();
  const listing = state?.listings?.[kind];
  if (!listing?.id) throw new Error(`no published ${kind} listing in the state file; run setup first`);
  const deployment = await expectedDeploymentRefusal();
  check(`buy ${kind}: the expected deployment is live`, !deployment.refusal, String(deployment.found));
  if (deployment.refusal) throw new Error(deployment.refusal);
  const { browser, page, commands } = await openBrowser();
  try {
    await ringSignIn(page, buyer);
    log(`buy ${kind}: buyer ${prefix(buyerPubky)} signed in`);
    await emptyCart(page);
    await page.goto(`${ORIGIN}${listingPath(listing.id)}`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
    await waitForAppReady(page);
    const add = page
      .locator('[data-surface="marketplace-listing-purchase"]')
      .getByRole('button', { name: 'Buy', exact: true });
    // Buy is visible at once but stays disabled until the service availability for the listing has loaded.
    const addOk = await add.waitFor({ state: 'visible', timeout: 60_000 }).then(
      async () => {
        for (let i = 0; i < 60; i += 1) {
          if (await add.isEnabled()) return true;
          await page.waitForTimeout(1000);
        }
        return false;
      },
      () => false,
    );
    if (!check(`buy ${kind}: the Buy button is enabled for the buyer`, addOk)) {
      await shot(page, `digital-buy-blocked-${kind}.png`, { kind }).catch(() => {});
      throw new Error('the buyer cannot add the listing');
    }
    await add.click();
    await page.waitForTimeout(1200);
    await page.goto(`${ORIGIN}/marketplace/cart`, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    const go = page.getByTestId('marketplace-cart-checkout').first();
    await go.waitFor({ state: 'visible', timeout: 30_000 });
    await go.click();
    await page.waitForURL(/\/marketplace\/checkout/, { timeout: 30_000 });
    await waitForAppReady(page);
    await approveMarketplaceSession(page, buyer);

    const line = page.getByTestId('checkout-digital-line').first();
    await line.waitFor({ state: 'visible', timeout: 60_000 });
    // The delivery projection loads after the line renders, so wait for the line that names the kind.
    let lineText = '';
    for (let i = 0; i < 60; i += 1) {
      lineText = (await line.innerText()).replace(/^Digital delivery\s*·\s*/, '').trim();
      if (expectedCheckoutLine(kind).test(lineText)) break;
      await page.waitForTimeout(1000);
    }
    check(`buy ${kind}: checkout names how it arrives`, expectedCheckoutLine(kind).test(lineText), lineText);
    check(
      `buy ${kind}: no shipping address is asked for`,
      (await page.getByText('No shipping for digital items.').count()) >= 1 &&
        (await page.getByText(/shipping address/i).count()) === 0,
    );
    const emailSection = page.locator('[data-surface="checkout-delivery-email"]');
    if (kind === 'email') {
      await emailSection.waitFor({ state: 'visible', timeout: 30_000 });
      await emailSection.getByLabel('Email', { exact: true }).fill(buyerEmail);
    } else {
      check(`buy ${kind}: no delivery email is asked for`, (await emailSection.count()) === 0);
    }
    check(
      `buy ${kind}: the consent line matches the kind`,
      (await page.getByTestId(isInstantKind(kind) ? 'checkout-consent-instant' : 'checkout-consent-manual').count()) ===
        1,
    );
    await page
      .waitForFunction(() => !document.querySelector('[aria-label="Loading payment methods"]'), null, {
        timeout: 60_000,
      })
      .catch(() => {});
    const bitcoin = page.getByTestId('marketplace-checkout-method-bitcoin').first();
    const bitcoinOk = await bitcoin.waitFor({ state: 'visible', timeout: 60_000 }).then(
      () => true,
      () => false,
    );
    if (!check(`buy ${kind}: Bitcoin is offered`, bitcoinOk)) throw new Error('Bitcoin is not offered at checkout');
    await bitcoin.click();
    check(`buy ${kind}: Bitcoin is selected`, (await bitcoin.getAttribute('aria-pressed')) === 'true');
    const summary = await page.getByTestId('marketplace-checkout-summary').innerText();
    check(
      `buy ${kind}: the order total is the proof price`,
      summary.includes(`$${state.price}`),
      `expected $${state.price}`,
    );
    await shot(page, `digital-checkout-${kind}.png`, { kind });
    const guarantee = page.getByTestId('marketplace-checkout-guarantee').getByRole('checkbox').first();
    await guarantee.check();
    check(`buy ${kind}: the guarantee policy is accepted`, await guarantee.isChecked());
    const pay = page.getByTestId('marketplace-checkout-pay');
    // Pay stays disabled while checkout checks the buyer's Bitcoin wallet.
    let payReady = false;
    for (let i = 0; i < 90 && !payReady; i += 1) {
      payReady = await pay.isEnabled();
      if (!payReady) await page.waitForTimeout(1000);
    }
    check(`buy ${kind}: Pay is enabled`, payReady);
    if (!payReady) {
      await shot(page, `digital-pay-blocked-${kind}.png`, { kind, fullPage: true }).catch(() => {});
      const reason = await page
        .locator('#checkout-pay-reason')
        .innerText()
        .catch(() => 'no reason shown');
      const alerts = await page.getByRole('alert').allInnerTexts();
      throw new Error(`Pay is disabled: ${reason} ${JSON.stringify(alerts).slice(0, 400)}`);
    }

    const before = commands.length;
    await pay.click();
    await approveMarketplaceSession(page, buyer);
    await page.getByTestId('marketplace-checkout-paying').waitFor({ state: 'visible', timeout: 180_000 });
    const payCommands = commands.slice(before).map((row) => `${row.kind}:${row.status}`);
    log(`buy ${kind}: Pay sent ${JSON.stringify(payCommands)}`);
    await page.waitForTimeout(8000);
    await shot(page, `digital-paying-${kind}.png`, { kind });
    const paying = (await page.getByTestId('marketplace-checkout-paying').innerText())
      .replace(/\s+/g, ' ')
      .slice(0, 700);
    log(
      `\n>>> OPERATOR: pay the Bitkit Payment Request for "${listing.title}" from the buyer wallet (seller must be a Bitkit contact). Checkout shows: ${paying}`,
    );

    const started = Date.now();
    let outcome = 'waiting';
    let cardId = null;
    let sellerConfirmed = false;
    // Rehearsal only: another process (await-buyer) is the seller and confirms the payment.
    const sellerElsewhere = process.env.PROOF_SELLER_CONFIRMS_ELSEWHERE === '1';
    const sellerSession = sellerElsewhere ? null : await openBrowser();
    try {
      if (sellerSession) await ringSignIn(sellerSession.page, seller);
      while (outcome === 'waiting') {
        await sleep(20_000);
        if (sellerSession && !sellerConfirmed)
          sellerConfirmed = await confirmSeenBitcoin(sellerSession.page, listing.title, kind);
        const card = await ordersCard(page, listing.title);
        const paid = (await card.count()) > 0 && (await card.getByTestId('order-receipt-details').count()) > 0;
        if ((await card.count()) > 0) cardId = (await card.getAttribute('id'))?.replace(/^order-/, '') ?? cardId;
        outcome = payOutcome({ paid, elapsedMs: Date.now() - started, timeoutMs: payTimeoutMs, interrupted });
        log(`buy ${kind}: waiting for payment, ${Math.round((Date.now() - started) / 1000)}s, ${outcome}`);
      }
    } finally {
      await sellerSession?.browser.close();
    }
    state.orders[kind] = { id: cardId, outcome, paidAfterSeconds: Math.round((Date.now() - started) / 1000) };
    writeState(state);
    check(
      `buy ${kind}: the order was paid before the timeout`,
      outcome === 'paid',
      `order=${(cardId ?? '').slice(0, 8)} ${state.orders[kind].paidAfterSeconds}s`,
    );
    if (outcome !== 'paid') {
      note(
        `buy ${kind}`,
        'not paid; the order expires on its own. If money moved late it takes the late-payment path (manual review or refund): check the order before teardown',
      );
      throw new Error(outcome === 'interrupted' ? 'interrupted while waiting for payment' : 'payment timeout');
    }
    await shot(page, `digital-paid-${kind}.png`, { kind });
    await emptyCart(page);
    await signOut(page).catch(() => false);
  } finally {
    await browser.close();
  }
}

// ---- both sides: delivery checks ---------------------------------------------------------------

async function buyerPanel(page, title, orderId) {
  const card = await ordersCard(page, title, orderId);
  await card.waitFor({ state: 'visible', timeout: 60_000 });
  const panel = card.locator('[data-surface="order-digital-panel"]');
  await panel.waitFor({ state: 'visible', timeout: 60_000 });
  return { panel };
}

async function sellerCard(page, title, orderId) {
  const card = await ordersCard(page, title, orderId);
  await card.waitFor({ state: 'visible', timeout: 60_000 });
  return card;
}

async function settle(kind) {
  const state = readState();
  const listing = state?.listings?.[kind];
  if (!listing?.id || state.orders?.[kind]?.outcome !== 'paid')
    throw new Error(`no paid ${kind} order in the state file`);
  const buyerSession = await openBrowser();
  try {
    const { page } = buyerSession;
    await ringSignIn(page, buyer);
    let { panel } = await buyerPanel(page, listing.title, state.orders[kind].id);
    await shot(page, `digital-order-${kind}-before.png`, { kind });
    if (kind === 'file') {
      const hashes = [];
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 180_000 }),
          panel.getByRole('button', { name: 'Download' }).click(),
        ]);
        const path = await download.path();
        hashes.push({ name: download.suggestedFilename(), sha256: sha256Hex(readFileSync(path)) });
        await page.waitForTimeout(2000);
        ({ panel } = await buyerPanel(page, listing.title, state.orders[kind].id));
      }
      check(
        'settle file: the downloaded bytes match the fixture SHA-256, twice',
        hashes.every((h) => h.sha256 === state.fixture.sha256),
        hashes.map((h) => h.sha256.slice(0, 12)).join(','),
      );
      check(
        'settle file: the download keeps the file name',
        hashes.every((h) => h.name === state.fixture.name),
        hashes[0]?.name ?? '',
      );
    } else if (kind === 'link') {
      await panel.getByRole('button', { name: 'Show link' }).click();
      const href = await panel.getByRole('link', { name: /Open link/ }).getAttribute('href');
      check('settle link: the revealed link equals the one the seller set', href === listing.delivery.url);
    } else if (kind === 'text') {
      await panel.getByRole('button', { name: 'Reveal text' }).click();
      const text = await panel.getByTestId('order-digital-text').innerText();
      check('settle text: the revealed text equals the one the seller set', text.trim() === listing.delivery.text);
    } else if (kind === 'email') {
      const line = await panel.innerText();
      check(
        'settle email: the buyer sees the address the seller will email',
        line.includes(`The seller will email this to ${buyerEmail}`),
      );
    } else {
      const line = await panel.innerText();
      check(
        'settle message: the buyer is told the seller will send it in messages',
        line.includes('The seller will send this in your messages.'),
      );
    }
    await signOut(page).catch(() => false);
  } finally {
    await buyerSession.browser.close();
  }

  const sellerSession = await openBrowser();
  try {
    const { page } = sellerSession;
    await ringSignIn(page, seller);
    const card = await sellerCard(page, listing.title, state.orders[kind].id);
    const sellerPanel = card.locator('[data-surface="order-seller-digital-panel"]');
    await sellerPanel.waitFor({ state: 'visible', timeout: 60_000 });
    if (isInstantKind(kind)) {
      const evidence = await sellerPanel.getByTestId('seller-digital-evidence').count();
      check(
        `settle ${kind}: the seller sees delivery evidence of the buyer's access`,
        evidence >= 1,
        `lines=${evidence}`,
      );
    } else if (kind === 'email') {
      await sellerPanel.getByRole('button', { name: 'Show email' }).click();
      const shown = await sellerPanel.getByTestId('seller-delivery-email').innerText();
      check('settle email: the seller sees the buyer address after payment', shown.trim() === buyerEmail);
      await operator(
        `email something from the seller's mailbox to the tester mailbox now, quoting order ${(state.orders.email.id ?? '').slice(0, 8)}; the tester confirms it arrived`,
      );
      await sellerPanel.getByRole('button', { name: 'Mark emailed' }).click();
      const marked = await sellerPanel
        .getByText('Marked emailed.', { exact: false })
        .waitFor({ state: 'visible', timeout: 60_000 })
        .then(
          () => true,
          () => false,
        );
      check('settle email: Mark emailed is accepted', marked);
    } else {
      await operator(
        `send the buyer a message in chat from the seller account (Ring) for order ${(state.orders.message.id ?? '').slice(0, 8)}; the tester confirms it arrived`,
      );
      await sellerPanel.getByRole('button', { name: 'Mark delivered' }).click();
      const marked = await sellerPanel
        .getByText('Marked delivered.', { exact: false })
        .waitFor({ state: 'visible', timeout: 60_000 })
        .then(
          () => true,
          () => false,
        );
      check('settle message: Mark delivered is accepted', marked);
    }
    await shot(page, `digital-seller-${kind}.png`, { kind });
    await signOut(page).catch(() => false);
  } finally {
    await sellerSession.browser.close();
  }

  if (!isInstantKind(kind)) {
    const again = await openBrowser();
    try {
      await ringSignIn(again.page, buyer);
      const { panel } = await buyerPanel(again.page, listing.title, state.orders[kind].id);
      const text = await panel.innerText();
      if (kind === 'email')
        check('settle email: the buyer sees "Emailed to" with the date', /Emailed to .* on /.test(text));
      else
        check(
          'settle message: the buyer sees the delivered line',
          text.includes('The seller marked this delivered. Check your messages.'),
        );
      await shot(again.page, `digital-order-${kind}-after.png`, { kind });
      await signOut(again.page).catch(() => false);
    } finally {
      await again.browser.close();
    }
  }
  state.orders[kind] = { ...state.orders[kind], settled: true };
  writeState(state);
}

// ---- external buyer: the seller side ----------------------------------------------------------

// A person pays from their own wallet. This waits for their order, confirms the seen Bitcoin payment as the
// seller, then waits for the buyer's delivery evidence (the file was downloaded). The buyer's own hash is compared
// by people against the fixture hash this script printed at prepare time.
async function awaitBuyer() {
  const state = readState();
  const listing = state?.listings?.file;
  if (!listing?.id || state.phase !== 'ready')
    throw new Error('no published file listing in the state file; run publish first');
  const started = Date.now();
  const { browser, page } = await openBrowser();
  let orderId = null;
  let confirmed = false;
  let delivered = false;
  let opened = false;
  let outcome = 'no-order';
  try {
    await ringSignIn(page, seller);
    log(`await-buyer: listing ${listing.id.slice(0, 8)} is live; waiting up to ${Math.round(waitMs / 60000)} min`);
    while (!interrupted && Date.now() - started < waitMs) {
      const card = await ordersCard(page, listing.title);
      if ((await card.count()) > 0) {
        orderId = (await card.getAttribute('id'))?.replace(/^order-/, '') ?? orderId;
        if (outcome === 'no-order') outcome = 'ordered';
        if (!confirmed) confirmed = await confirmSeenBitcoin(page, listing.title, 'file');
        const lines = await card
          .locator('[data-surface="order-seller-digital-panel"]')
          .getByTestId('seller-digital-evidence')
          .allInnerTexts();
        // "Delivered automatically" appears once the order is paid; "first opened" only after the buyer downloads.
        delivered = lines.some((line) => /^Delivered automatically/.test(line.trim()));
        opened = lines.some((line) => /first opened/.test(line));
        if (delivered && outcome !== 'paid') {
          outcome = 'paid';
          log(`await-buyer: order ${(orderId ?? '').slice(0, 8)} is paid and delivered`);
        }
        if (opened) {
          await card.scrollIntoViewIfNeeded().catch(() => {});
          await shot(card, 'digital-seller-await-buyer.png').catch(() => {});
          break;
        }
      }
      log(`await-buyer: ${Math.round((Date.now() - started) / 1000)}s, ${outcome}, buyer opened=${opened}`);
      await sleep(20_000);
    }
    state.orders.file = { id: orderId, outcome, confirmedBySeller: confirmed, buyerOpened: opened, settled: opened };
    writeState(state);
    check('await-buyer: an order for the listing arrived', outcome !== 'no-order');
    check('await-buyer: the order was paid and delivered', outcome === 'paid', `order=${(orderId ?? '').slice(0, 8)}`);
    check('await-buyer: the seller sees the buyer opened the file', opened);
    await signOut(page).catch(() => false);
  } finally {
    await browser.close();
  }
}

// ---- teardown and verification -----------------------------------------------------------------

async function teardown() {
  const state = readState();
  if (!state) {
    log('teardown: no state file; nothing was set up, so nothing is changed');
    return;
  }
  if (state.runStart === null) {
    writeState({ ...state, phase: 'torn-down' });
    log('teardown: the run was prepared but never published; only the local fixture file is removed');
    return;
  }
  const { browser, page } = await openBrowser();
  try {
    await ringSignIn(page, seller);
    const entries = Object.entries(state.listings ?? {});
    for (const [kind, listing] of entries) {
      let ids = listing.id ? [listing.id] : [];
      // Nexus can trail the homeserver; a listing whose id never reached the state file is found by its title.
      for (let attempt = 0; listing.title && ids.length === 0 && attempt < 6; attempt += 1) {
        if (attempt > 0) await sleep(10_000);
        ids = (await nexusListingsByTitle(listing.title)).ids;
      }
      for (const id of ids) {
        await page.goto(`${ORIGIN}${listingPath(id)}`, { waitUntil: 'domcontentloaded' });
        await waitForAppReady(page);
        await approveMarketplaceSession(page, seller);
        const openDelete = page.getByRole('button', { name: /^Delete$/i }).first();
        if (await openDelete.isVisible().catch(() => false)) {
          await openDelete.click();
          await page.getByRole('button', { name: 'Delete listing', exact: true }).click();
          await page.waitForTimeout(5000);
          log(`teardown ${kind}: deleted listing ${id.slice(0, 8)}`);
        } else log(`teardown ${kind}: no Delete control on ${id.slice(0, 8)} (already gone or not owned)`);
      }
      listing.ids = ids;
    }
    await signOut(page).catch(() => false);
  } finally {
    await browser.close();
  }
  const current = state.deliverablesBefore
    ? newDeliverablePaths(state.deliverablesBefore, await listDeliverables())
    : [];
  const unsettled = Object.entries(state.orders ?? {}).filter(
    ([, order]) => order.outcome === 'paid' && !order.settled,
  );
  if (unsettled.length > 0) {
    note(
      'teardown',
      `paid orders not yet settled (${unsettled.map(([kind]) => kind).join(', ')}): their ciphertext is deleted now, so a buyer download after this fails`,
    );
  }
  const removed = await deleteDeliverables(current);
  check('teardown: ciphertext created by the run deleted', removed === current.length, `deleted=${removed}`);
  writeState({ ...state, phase: 'torn-down', deliverablePaths: current });
  for (const [name, seat] of [
    ['seller', seller],
    ['buyer', buyer],
  ].filter(([, seat]) => seat)) {
    try {
      const { listStatus, statuses } = await revokeRunSessions(seat, state.runStart);
      check(
        `teardown: ${name} run sessions revoked`,
        listStatus === 200 && statuses.every((s) => s === 200 || s === 204),
        `revoked=${statuses.length}`,
      );
    } catch (error) {
      check(`teardown: ${name} run sessions revoked`, false, String(error?.message ?? error).slice(0, 160));
    }
  }
}

// The service tombstones a listing when its sync sees the homeserver delete, which lags the delete by one to
// three minutes, so a single read right after the delete reports a false failure.
const TOMBSTONE_WAIT_MS = 300_000;
const TOMBSTONE_POLL_MS = 10_000;

async function awaitServiceTombstone(listingId, token) {
  const deadline = Date.now() + TOMBSTONE_WAIT_MS;
  for (;;) {
    const response = await fetch(`${SERVICE}/v1/listings/${encodeURIComponent(listingId)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 404 || Date.now() >= deadline) return response;
    await sleep(TOMBSTONE_POLL_MS);
  }
}

async function verify() {
  const state = readState();
  if (!state) {
    log('verify: no state file; nothing to verify');
    return;
  }
  if (state.runStart === null) {
    log('verify: the run was never published; nothing to verify');
    return;
  }
  await sleep(10_000);
  const bearer = await mintBearer(seller);
  const { browser, page } = await openBrowser();
  try {
    for (const [kind, listing] of Object.entries(state.listings ?? {})) {
      const stream = await nexusListingsByTitle(listing.title);
      check(
        `verify ${kind}: no fixture listing in the seller stream`,
        stream.status === 200 && stream.ids.length === 0,
        `status=${stream.status} left=${stream.ids.length}`,
      );
      for (const id of listing.ids ?? (listing.id ? [listing.id] : [])) {
        const detail = await fetch(`${NEXUS}/v0/listing/${encodeURIComponent(sellerPubky)}/${encodeURIComponent(id)}`);
        check(`verify ${kind}: nexus detail gone ${id.slice(0, 8)}`, detail.status === 404, `status=${detail.status}`);
        const onHomeserver = await new Pubky().publicStorage
          .exists(`pubky://${sellerPubky}/pub/pubky.app/marketplace/v1/listings/${id}`)
          .catch(() => null);
        check(
          `verify ${kind}: homeserver record gone ${id.slice(0, 8)}`,
          onHomeserver === false,
          `exists=${onHomeserver}`,
        );
        const projection = await awaitServiceTombstone(`listing:${sellerPubky}_${id}`, bearer.token);
        check(
          `verify ${kind}: service listing tombstoned ${id.slice(0, 8)}`,
          projection.status === 404,
          `status=${projection.status}`,
        );
        await page.goto(`${ORIGIN}${listingPath(id)}`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
        await page.waitForTimeout(8000);
        const shop = await page.evaluate(
          (title) => ({
            title: [...document.querySelectorAll('h1')].some((node) => node.textContent?.trim() === title),
            buy: [...document.querySelectorAll('[data-surface="marketplace-listing-purchase"] button')].some(
              (node) => node.textContent?.trim() === 'Buy',
            ),
          }),
          listing.title,
        );
        check(
          `verify ${kind}: Shop page no longer sells ${id.slice(0, 8)}`,
          !shop.title && !shop.buy,
          JSON.stringify(shop),
        );
      }
    }
  } finally {
    await browser.close();
  }
  for (const path of state.deliverablePaths ?? []) {
    const exists = await new Pubky().publicStorage.exists(`pubky://${sellerPubky}${path}`).catch(() => null);
    check('verify: ciphertext gone from the seller homeserver', exists === false, `exists=${exists}`);
  }
  check('verify: verifier bearer revoked', (await revokeSession(bearer.token, bearer.sessionId)) < 300);
  for (const [name, seat] of [
    ['seller', seller],
    ['buyer', buyer],
  ].filter(([, seat]) => seat)) {
    const probe = await mintBearer(seat);
    const { status, sessions } = await listSessions(probe.token);
    const residual = sessions.filter(
      (row) =>
        !row.revoked_at &&
        row.id !== probe.sessionId &&
        Date.parse(row.created_at) >= state.runStart - 5000 &&
        Date.parse(row.expires_at) > Date.now(),
    ).length;
    await revokeSession(probe.token, probe.sessionId);
    check(
      `verify: no ${name} session from the run is active`,
      status === 200 && residual === 0,
      `residual=${residual}`,
    );
  }
  const paid = Object.entries(state.orders ?? {}).filter(([, order]) => order.outcome === 'paid');
  note(
    'paid orders left as evidence',
    paid.map(([kind, order]) => `${kind}=${(order.id ?? '').slice(0, 8)}`).join(' ') || 'none',
  );
}

// ---- entry -------------------------------------------------------------------------------------

let interrupted = false;
// These modes have no loop that can notice the flag; a signal would otherwise be swallowed until they finished.
const STOPS_AT_ONCE = ['prepare', 'publish', 'setup'];
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    if (interrupted || STOPS_AT_ONCE.includes(mode)) {
      log(`${signal}: stopping; run teardown to remove anything already published`);
      process.exit(130);
    }
    interrupted = true;
    log(`${signal}: finishing with teardown and verification`);
  });
}

async function tearDownAndVerify() {
  try {
    await teardown();
  } catch (error) {
    check('teardown completed', false, String(error?.message ?? error).slice(0, 240));
  }
  try {
    await verify();
  } catch (error) {
    check('verify completed', false, String(error?.message ?? error).slice(0, 240));
  }
}

try {
  if (spends) {
    const deployment = await expectedDeploymentRefusal();
    if (deployment.refusal) throw new Error(deployment.refusal);
    log(`the origin is serving the expected deployment ${deployment.found}`);
  }
  if (mode === 'proof') {
    try {
      await setup();
      for (const kind of kinds) {
        if (interrupted) break;
        try {
          await buy(kind);
        } catch (error) {
          check(`buy ${kind} completed`, false, String(error?.message ?? error).slice(0, 240));
          break;
        }
        try {
          await settle(kind);
        } catch (error) {
          check(`settle ${kind} completed`, false, String(error?.message ?? error).slice(0, 240));
        }
      }
    } catch (error) {
      check(interrupted ? 'interrupted' : 'setup completed', false, String(error?.message ?? error).slice(0, 240));
    } finally {
      await tearDownAndVerify();
    }
  } else if (mode === 'setup') await setup();
  else if (mode === 'prepare') await prepare();
  else if (mode === 'publish') await publish();
  else if (mode === 'await-buyer') await awaitBuyer();
  else if (mode === 'buy') await buy(kindArg);
  else if (mode === 'settle') await settle(kindArg);
  else if (mode === 'teardown') await tearDownAndVerify();
  else await verify();
} catch (error) {
  check(`${mode} completed`, false, String(error?.message ?? error).slice(0, 240));
}

const ok = checks.every((row) => row.ok);
writeFileSync(join(OUT, `digital-fixture-${mode}.json`), `${JSON.stringify({ mode, ok, checks, notes }, null, 2)}\n`);
const finalState = readState();
if ((mode === 'proof' || mode === 'teardown' || mode === 'verify') && ok && finalState?.phase === 'torn-down') {
  unlinkSync(STATE_PATH);
  if (existsSync(FILE_PATH)) unlinkSync(FILE_PATH);
}
log(
  `DIGITAL_FIXTURE ${mode} ${ok ? 'OK' : 'FAIL'} checks=${checks.length} failed=${checks.filter((row) => !row.ok).length}`,
);
process.exit(ok ? 0 : 1);
