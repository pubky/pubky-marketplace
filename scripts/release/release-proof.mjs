#!/usr/bin/env node
// Signed-in Shop release proof in real Chromium against a deployed Shop with grant sessions.
//   1. Ring sign-in with the Ring and Bitkit QRs both live: the Ring QR is a signin_grant, one approval gives one
//      grant session and no cookie session. Steps 5 and 6 run on the same browser session.
//   2. Bitkit grant sign-in (Signer.approveAuthRequest, the binding Bitkit's Paykit calls), reload, sign-out.
//   (Step ids are stable across releases; 3 is unused.)
//   4. Buyer seat checkout, read-only: on PROOF_PAYPAL_LISTING_URL if set (production-paypal-fixture.mjs sets it),
//      else on an existing listing whose seller takes PayPal (test titles first, never either seat's own).
//      Payment-config loads, PayPal is offered, selecting it marks it chosen and the Pay control renders.
//      Pay is never clicked.
//   5. Activity opens an order; the order page shows it (buyer seat when the seller's rows only
//      point at orders its Orders page hides — recorded as a known defect).
//   6. Sign-out of the Ring session through Settings ends the grant session and holds across reload.
//   7. Bitkit-grant buyer on the step 4 listing: "Approve to buy" grant QR (never approved), Settings
//      in the shared navigation at desktop and mobile width, seller Bitcoin availability.
//   8. Seller seat: cart, checkout, orders, My shop and storefront render without an error page
//      at desktop and mobile width; no command is sent.
//   9. Buyer seat: Bitcoin wallet state at checkout (no Bitkit 2.6 / unverified notice for a 2.5 wallet).
//  10. Seller seat: payment settings and My shop show no USDT, and no request mentions USDT (flag off).
//  11. Opt-in only (PROOF_STEPS=11): the service lists WooCommerce and the seller sees its connect form.
// Afterwards every marketplace session the seat gained during the run is revoked and the
// revocation is verified. The Shop publishes a default storefront (shop.json) for a Paykit-enabled
// seller that opens payment settings; a storefront either seat did not have before the run is deleted
// and verified gone from the homeserver and Nexus. Nothing else is written: the cart is local (Dexie) and is emptied.
// Env: PROOF_EVIDENCE, one of EXPECTED_DPL (a Vercel dpl_… id) or EXPECTED_COMMIT (the commit GET /api/build must report;
// both are checked when both are set) (required), seats (see seats.mjs), PROOF_ORIGIN (with the mount path when
// the Shop is embedded, e.g. https://pubky.app/shop-embed), PROOF_SERVICE (required), PROOF_RELAY, PROOF_CLIENT_ID (the
// grant client id the Shop's QRs carry; default shop.pubky.app), PROOF_PAYPAL_LISTING_URL (optional listing path
// for step 4), PROOF_BUYER_COUNTRY (answers the "Country you live in" prompt when the region flags are on), PROOF_BITCOIN_LISTING_URL (optional listing path for step 9), PROOF_NEXUS (required: listing discovery and
// storefront cleanup), PROOF_GS1=1 (step 1
// also checks that sign-in minted the marketplace session from the grant), PROOF_STEPS (optional subset, e.g. 1,2,9).
// Runbook: docs/ecommerce/release.md.
// Output: 8-char pubky prefixes only; auth URLs, exports and bearers never print.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { servedDeployment } from './deployment-check.mjs';
import { MISSING_EXPECTATION } from './digital-proof.mjs';
import {
  evidenceDir,
  loadBuyerSeat,
  loadSellerSeat,
  prefix,
  proofTarget,
  repoRequire,
  requireProofEnv,
  seatSource,
  shopCapabilities,
} from './seats.mjs';
import { removeRunStorefront, storefrontExists } from './storefront-cleanup.mjs';

const { chromium } = repoRequire('playwright');
const { AuthFlowKind, Pubky, SigninGrantDeepLink } = repoRequire('@synonymdev/pubky');

const { origin: ORIGIN, basePath: BASE_PATH, at } = proofTarget();
const signInPath = `${BASE_PATH}/sign-in`;
const EVIDENCE = evidenceDir();
if (!process.env.EXPECTED_DPL?.trim() && !process.env.EXPECTED_COMMIT?.trim()) throw new Error(MISSING_EXPECTATION);
const SERVICE = requireProofEnv('PROOF_SERVICE');
const RELAY = process.env.PROOF_RELAY ?? 'https://httprelay.pubky.app/inbox';
const CAPABILITIES = shopCapabilities();
const CLIENT_ID = process.env.PROOF_CLIENT_ID ?? 'shop.pubky.app';
const FORBIDDEN_COPY = /hasn't set up a payment method|do not share a payment method/i;
const RUN_START = Date.now();
// PROOF_STEPS=4,9 runs only those step blocks (1 = the Ring journey with steps 5 and 6; step 0 always runs).
const ONLY_STEPS = new Set(
  (process.env.PROOF_STEPS ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean),
);
const runs = (step) => ONLY_STEPS.size === 0 || ONLY_STEPS.has(step);
mkdirSync(EVIDENCE, { recursive: true });
const PROGRESS = join(EVIDENCE, 'proof-log.txt');
writeFileSync(PROGRESS, '');

const redact = (value) =>
  String(value ?? '')
    .replace(/[ybndrfg8ejkmcpqxot1uwisza345h769]{52}/gi, (match) => `${match.slice(0, 8)}…`)
    .replace(/(bearer\s+)[^\s"']+/gi, '$1[redacted]')
    .replace(/([?&#](?:secret|s)=)[^&\s]+/gi, '$1[redacted]');
const log = (line) => {
  const text = redact(line);
  appendFileSync(PROGRESS, `${new Date().toISOString()} ${text}\n`);
  console.log(text);
};
const results = [];
function check(step, name, ok, detail = '') {
  results.push({ step, name, ok: Boolean(ok), detail: redact(detail) });
  log(`${ok ? 'PASS' : 'FAIL'} [${step}] ${name}${detail ? ` — ${detail}` : ''}`);
}
// A known defect outside the release under proof: recorded in results.json, never gating.
const notes = [];
function note(step, name, ok, detail = '') {
  notes.push({ step, name, ok: Boolean(ok), detail: redact(detail) });
  log(`${ok ? 'OK  ' : 'KNOWN'} [${step}] ${name}${detail ? ` — ${detail}` : ''}`);
}
const shot = async (page, name) => page.screenshot({ path: join(EVIDENCE, name) });

// Staging runs use staging-homeserver seats: the staging Shop signs out accounts that live on the
// production homeserver.
const seat = loadSellerSeat();
const buyerSeat = loadBuyerSeat();
const pubky = seat.publicKey.z32();
log(
  `seller seat ${prefix(pubky)} (${seatSource()}), buyer seat ${prefix(buyerSeat.publicKey.z32())}, origin ${ORIGIN}`,
);

function instrument(page, net, commands) {
  page.on('response', (response) => {
    const request = response.request();
    let url;
    try {
      url = new URL(request.url());
    } catch {
      return;
    }
    const method = request.method();
    const entry = {
      method,
      status: response.status(),
      host: url.host.slice(0, 48),
      path: redact(url.pathname).slice(0, 120),
      t: Date.now() - RUN_START,
    };
    if (/usdt/i.test(url.pathname + url.search)) usdtRequests.push({ ...entry });
    if (url.pathname === '/session') net.push({ tag: 'homeserver-session', ...entry });
    else if (url.origin === SERVICE && /^\/v1\/auth\/grant-session(s|-challenges)(\/|$)/.test(url.pathname))
      net.push({ tag: 'gs1', ...entry });
    else if (/\/auth\/grant(\/|$)/.test(url.pathname)) net.push({ tag: 'grant', ...entry });
    else if (url.origin === SERVICE && url.pathname.startsWith('/v1/auth/sessions'))
      net.push({ tag: 'marketplace-session', ...entry });
    else if (url.origin === SERVICE && /\/payment-config$/.test(url.pathname))
      net.push({ tag: 'payment-config', ...entry });
    else if (url.origin === SERVICE && url.pathname.startsWith('/v1/connectors'))
      net.push({ tag: 'connectors', ...entry });
    if (method === 'POST' && /\/v1\/commands/.test(url.pathname)) {
      const kind = ((request.postData() || '').match(/"kind"\s*:\s*"([^"]+)"/) || [])[1] || 'unknown';
      commands.push({ kind, status: response.status() });
      net.push({ tag: 'command', kind, ...entry });
    }
  });
}

async function authState(page) {
  return await page.evaluate(() => {
    const raw = localStorage.getItem('shop-auth-store') ?? localStorage.getItem('auth-store');
    const state = raw ? (JSON.parse(raw).state ?? {}) : {};
    return {
      currentUserPubky: state.currentUserPubky ?? null,
      sessionExport: state.sessionExport ?? null,
      grantSessionRecordId: state.grantSessionRecordId ?? null,
    };
  });
}
const waitForAppReady = async (page, timeout = 180_000) =>
  page.waitForFunction(
    () =>
      !/^\s*Loading\.{0,3}\s*$/.test(document.body?.innerText ?? '') && (document.body?.innerText ?? '').length > 40,
    null,
    { timeout },
  );
const signedInAs = (page, key, timeout = 180_000) =>
  page.waitForFunction(
    ([expected, field]) => {
      const raw = localStorage.getItem('shop-auth-store') ?? localStorage.getItem('auth-store');
      const state = raw ? (JSON.parse(raw).state ?? {}) : {};
      return state.currentUserPubky === expected && typeof state[field] === 'string';
    },
    [pubky, key],
    { timeout },
  );

// The session lives in localStorage `auth-store` up to v0.6.50 and `shop-auth-store` from #147
// (v0.6.51, storage namespace); every read below takes the new key first.
// Up to v0.6.48 /sign-in shows the Ring and Bitkit QRs side by side. From #135 (v0.6.49) it shows one
// QR with a "Sign-in app" toggle (Pubky Ring | Bitkit); each copy button renders only for its signer.
// The next release shows one QR both apps approve, labelled "Copy authentication link", with no toggle.
const SIGNER_OF_LABEL = { 'Copy authentication link': 'Pubky Ring', 'Copy Bitkit authentication link': 'Bitkit' };
async function labelOnPage(page, label) {
  if (label !== 'Copy Bitkit authentication link') return label;
  const hasBitkitQr = (await page.getByRole('button', { name: label }).count()) > 0;
  const hasToggle = (await page.getByRole('group', { name: 'Sign-in app' }).count()) > 0;
  return hasBitkitQr || hasToggle ? label : 'Copy authentication link';
}
async function showSigner(page, label) {
  const toggle = page.getByRole('group', { name: 'Sign-in app' }).first();
  if (!(await toggle.count())) return;
  if (
    await page
      .getByRole('button', { name: label })
      .first()
      .isVisible()
      .catch(() => false)
  )
    return;
  await toggle.getByRole('radio', { name: SIGNER_OF_LABEL[label] }).first().click();
}
async function qrLive(page, requestedLabel) {
  const label = await labelOnPage(page, requestedLabel);
  await showSigner(page, label);
  await page.waitForFunction(
    (value) => {
      const el = document.querySelector(`[aria-label="${value}"]`);
      return Boolean(el && !el.disabled && el.querySelector('[data-testid="qr-auth-url"]'));
    },
    label,
    { timeout: 180_000 },
  );
  return await page.getByRole('button', { name: label }).first().isVisible();
}
async function bothQrsLive(page) {
  await page.goto(at('/sign-in'), { waitUntil: 'domcontentloaded', timeout: 180_000 });
  await waitForAppReady(page);
  await page
    .locator('[aria-label="Copy authentication link"],[aria-label="Copy Bitkit authentication link"]')
    .first()
    .waitFor({ state: 'visible', timeout: 180_000 });
  const bitkit = await qrLive(page, 'Copy Bitkit authentication link');
  const ring = await qrLive(page, 'Copy authentication link');
  return ring && bitkit;
}

async function copyQrUrl(page, requestedLabel) {
  await qrLive(page, requestedLabel);
  const label = await labelOnPage(page, requestedLabel);
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await page.getByRole('button', { name: label }).first().click();
  const handle = await page.waitForFunction(
    async () => {
      const text = await navigator.clipboard.readText();
      return text.startsWith('pubkyauth://') ? text : null;
    },
    null,
    { timeout: 10_000 },
  );
  return await handle.jsonValue();
}

async function qrDomLeak(page, authUrl) {
  const secret = new URL(authUrl).searchParams.get('secret');
  return await page.evaluate(
    (value) => ({
      attr: document.querySelector('[data-auth-url]') !== null,
      html: document.documentElement.outerHTML.includes(value),
    }),
    secret,
  );
}

async function signOutThroughSettings(page) {
  await page.goto(at('/settings/account'), { waitUntil: 'domcontentloaded', timeout: 180_000 });
  await waitForAppReady(page);
  const button = page.locator('#sign-out-btn');
  const viaSettings = await button
    .waitFor({ state: 'visible', timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  if (viaSettings) await button.click();
  else await page.goto(at('/logout'), { waitUntil: 'domcontentloaded', timeout: 180_000 });
  await page.waitForFunction(
    () => {
      const raw = localStorage.getItem('shop-auth-store') ?? localStorage.getItem('auth-store');
      const state = raw ? (JSON.parse(raw).state ?? {}) : {};
      return !state.currentUserPubky && !state.grantSessionRecordId && !state.sessionExport;
    },
    null,
    { timeout: 120_000 },
  );
  await page.waitForTimeout(2500);
  return viaSettings;
}

async function newContext(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(redact(message.text()).slice(0, 240));
  });
  return { context, page };
}

async function emptyCart(page) {
  await page.goto(at('/marketplace/cart'), { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
  await page.waitForTimeout(1200);
  for (let n = 0; n < 8; n += 1) {
    const remove = page.getByRole('button', { name: /^Remove / }).first();
    if (!(await remove.count())) break;
    await remove.click();
    await page.waitForTimeout(700);
  }
  return await page.getByRole('button', { name: /^Remove / }).count();
}

// With the EU fence or the digital hold on, the Shop disables "Buy" until the buyer says which country they live in
// ("Country you live in", remembered on the device; the field commits on Enter or blur, #385). PROOF_BUYER_COUNTRY (two letters, unset by default) answers it.
async function declareBuyerCountry(page) {
  const country = process.env.PROOF_BUYER_COUNTRY ?? '';
  if (!country) return;
  const field = page.getByTestId('buyer-country-field').locator('input').first();
  const shown = await field
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!shown) return;
  if ((await field.inputValue().catch(() => '')) === country) return;
  await field.fill(country);
  await field.press('Enter');
  await page.waitForTimeout(500);
}

// Listing CTAs: "Add to cart" / "Approve to buy" up to v0.6.48; one "Buy" button from #135 (v0.6.49).
const BUY_LABEL = /^(Add to cart|Buy)$/;
const LISTING_CTA =
  /^(Add to cart|Buy|Approve to buy|Sign in to buy|Sold out|Held by another buyer|You cannot buy your own listing)$/;
// From #135 the "Buy" button renders at once and stays disabled until availability loads (earlier
// builds showed "Checking availability…" instead), so wait for an enabled purchase button.
async function waitForEnabledPurchase(page, timeout = 30_000) {
  await declareBuyerCountry(page);
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll('button')].some(
          (el) => /^(Add to cart|Buy|Approve to buy)$/.test((el.textContent || '').trim()) && !el.disabled,
        ),
      null,
      { timeout },
    )
    .catch(() => {});
}

// Step 4 candidates when no PROOF_PAYPAL_LISTING_URL is set: active fixed-price listings on the
// marketplace Nexus whose seller's public payment-config offers PayPal, test titles first, never a
// listing of either proof seat. Read-only: nothing is published or changed for the proof.
// Each environment has its own index: PROOF_NEXUS must be the one that follows the homeserver the seats live on.
const NEXUS = requireProofEnv('PROOF_NEXUS');
async function discoverPaypalListings(excludeOwners) {
  const items = await (await fetch(`${NEXUS}/v0/stream/listings?limit=100`)).json().catch(() => []);
  const rows = (Array.isArray(items) ? items : []).filter(
    (row) => row.state === 'active' && row.sale_format === 'fixed_price' && !excludeOwners.includes(row.owner_id),
  );
  rows.sort((a, b) => Number(/test|do not buy/i.test(b.title ?? '')) - Number(/test|do not buy/i.test(a.title ?? '')));
  const paypal = new Map();
  const out = [];
  for (const row of rows) {
    if (!paypal.has(row.owner_id)) {
      const config = await (await fetch(`${SERVICE}/v0/sellers/${encodeURIComponent(row.owner_id)}/payment-config`))
        .json()
        .catch(() => null);
      paypal.set(row.owner_id, config?.paypal_available === true);
    }
    if (paypal.get(row.owner_id)) out.push(`/marketplace/listing/${row.owner_id}/${row.id}`);
    if (out.length >= 5) break;
  }
  return out;
}

// Step 4 runs as the buyer seat on a listing whose seller takes PayPal (a seller cannot buy its own listing).
async function paypalCheckout(page, commands, href) {
  const sellerOf = (value) => {
    const parts = value.split('/');
    const index = parts.indexOf('listing');
    return index >= 0 ? parts[index + 1] || '' : '';
  };
  const sellerConfig = await (await fetch(`${SERVICE}/v0/sellers/${encodeURIComponent(sellerOf(href))}/payment-config`))
    .json()
    .catch(() => null);
  const sellerHasPaypal = sellerConfig?.paypal_available === true;
  log(`listing seller ${sellerOf(href).slice(0, 8)} public payment-config paypal=${sellerHasPaypal}`);
  await emptyCart(page);
  {
    await page.goto(at(href), { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    const title = (
      (await page
        .locator('h1')
        .first()
        .innerText()
        .catch(() => '')) || ''
    )
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
    await page
      .waitForFunction(
        (source) =>
          [...document.querySelectorAll('button')].some((el) => new RegExp(source).test((el.textContent || '').trim())),
        LISTING_CTA.source,
        { timeout: 30_000 },
      )
      .catch(() => {});
    await waitForEnabledPurchase(page);
    const add = page.getByRole('button', { name: BUY_LABEL }).first();
    if (
      !((await add.count()) && (await add.isVisible().catch(() => false)) && (await add.isEnabled().catch(() => false)))
    ) {
      const buttons = await page.evaluate(
        (source) =>
          [...document.querySelectorAll('button')]
            .filter((el) => new RegExp(source).test((el.textContent || '').trim()))
            .map((el) => `${(el.textContent || '').trim()}${el.disabled ? ' (disabled)' : ''}`),
        LISTING_CTA.source,
      );
      await shot(page, `06-skip-${(href.split('/').filter(Boolean).slice(-1)[0] || '').slice(0, 8)}.png`);
      return {
        sellerHasPaypal,
        error: `listing "${title}" has no enabled Add to cart or Buy for the buyer: ${JSON.stringify(buttons)}`,
      };
    }
    await add.click();
    await page.waitForTimeout(1200);
    await page.goto(at('/marketplace/cart'), { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    const checkout = page.getByTestId('marketplace-cart-checkout');
    await checkout
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 })
      .catch(() => {});
    if (!(await checkout.count())) return { sellerHasPaypal, error: 'no cart checkout control' };
    const configResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        /\/v0\/sellers\/(?!me\/)[^/]+\/payment-config$/.test(new URL(response.url()).pathname),
      { timeout: 30_000 },
    );
    await checkout.first().click();
    await page.waitForURL(/\/marketplace\/checkout/, { timeout: 30_000 });
    await waitForAppReady(page);
    let configStatus = null;
    try {
      const response = await configResponse;
      await response.finished();
      configStatus = response.status();
    } catch (error) {
      log(`payment-config did not arrive: ${String(error?.message ?? error).slice(0, 120)}`);
    }
    await page
      .waitForFunction(() => !document.querySelector('[aria-label="Loading payment methods"]'), null, {
        timeout: 30_000,
      })
      .catch(() => {});
    await page
      .getByTestId('marketplace-checkout-method-paypal')
      .first()
      .waitFor({ state: 'visible', timeout: 15_000 })
      .catch(() => {});
    const paypal = await page.getByTestId('marketplace-checkout-method-paypal').count();
    const loadingLeft = await page.locator('[aria-label="Loading payment methods"]').count();
    const retry = await page.getByTestId('marketplace-checkout-methods-retry').count();
    const forbidden = FORBIDDEN_COPY.test(await page.locator('body').innerText());
    const usdtOption = await page.getByTestId('marketplace-checkout-method-usdt').count();
    const usdtText = /USDT/.test(await page.locator('body').innerText());
    let paypalSelected = false;
    if (paypal) {
      await page.getByTestId('marketplace-checkout-method-paypal').first().click();
      await page.waitForTimeout(800);
      // aria-pressed exists from #135 (v0.6.49); earlier builds expose no selected state.
      const pressed = await page.getByTestId('marketplace-checkout-method-paypal').first().getAttribute('aria-pressed');
      paypalSelected = pressed === null ? null : pressed === 'true';
    }
    const payControl = page.getByTestId('marketplace-checkout-pay');
    const payState = (await payControl.count())
      ? {
          visible: await payControl.first().isVisible(),
          disabled: await payControl.first().isDisabled(),
          reason:
            (
              (await page
                .locator('#checkout-pay-reason')
                .first()
                .innerText()
                .catch(() => '')) || ''
            ).slice(0, 120) || null,
        }
      : null;
    await page
      .getByTestId('marketplace-checkout-method-paypal')
      .first()
      .scrollIntoViewIfNeeded()
      .catch(() => {});
    await shot(page, '06-checkout-paypal.png');
    const listingId = (href.split('/').filter(Boolean).slice(-1)[0] || '').slice(0, 12);
    const sellerPrefix = sellerOf(href).slice(0, 8);
    const payCommands = commands.filter((row) =>
      /^(checkout|order|payment|fulfillment|offer|auction|drop|inventory)\./i.test(row.kind),
    );
    log(
      `checkout "${title}" listing=${listingId} seller=${sellerPrefix} config=${configStatus} paypal=${paypal} selected=${paypalSelected} loadingLeft=${loadingLeft} retry=${retry} forbidden=${forbidden} pay=${JSON.stringify(payState)}`,
    );
    const cartLeft = await emptyCart(page);
    return {
      sellerHasPaypal,
      title,
      listingId,
      sellerPrefix,
      configStatus,
      paypal,
      paypalSelected,
      loadingLeft,
      retry,
      forbidden,
      payState,
      payCommands,
      cartLeft,
      usdtOption,
      usdtText,
    };
  }
}

async function renderedOrderCards(page) {
  await page.goto(at('/marketplace/orders'), { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
  await page.locator('[data-surface="marketplace-orders"]').waitFor({ state: 'visible', timeout: 60_000 });
  await page
    .waitForFunction(
      () =>
        !document.querySelector(
          '[data-surface="marketplace-orders"] [data-slot="skeleton"], [data-surface="marketplace-orders"] .animate-pulse',
        ),
      null,
      { timeout: 60_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(2500);
  const all = page.getByRole('button', { name: /^All/ }).first();
  if (await all.count()) {
    await all.click();
    await page.waitForTimeout(800);
  }
  return await page.evaluate(() =>
    [...document.querySelectorAll('[id^="order-"]')].map((el) => el.id.slice('order-'.length)),
  );
}

// Activity rows link to /marketplace/orders?order=<id> (#304); the Orders page renders only a
// card per order that belongs in its history (paid/receipted, or held reservations).
// Grant sessions carry no marketplace session. Settings → Get paid offers "Authorize" (Ring approval of the
// marketplace session); approve it as the given seat so commerce state (orders, Activity) can sync.
async function enableMarketplaceSession(page, keypair) {
  await page.goto(at('/marketplace/settings'), { waitUntil: 'domcontentloaded', timeout: 180_000 });
  await waitForAppReady(page);
  await page
    .getByRole('region', { name: 'Payment methods' })
    .waitFor({ state: 'visible', timeout: 120_000 })
    .catch(() => {});
  await page.waitForTimeout(3000);
  const authorize = page.getByRole('button', { name: /^Authorize$|Enable selling/ }).first();
  if (!(await authorize.isVisible().catch(() => false))) return 'already-enabled';
  await authorize.click();
  const copy = page.getByRole('button', { name: 'Copy authorization link' }).first();
  await copy.waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const b = document.querySelector('[aria-label="Copy authorization link"]');
      return Boolean(b && !b.disabled);
    },
    null,
    { timeout: 60_000 },
  );
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await copy.click();
  const handle = await page.waitForFunction(
    async () => {
      const t = await navigator.clipboard.readText();
      return t.startsWith('pubkyauth://') ? t : null;
    },
    null,
    { timeout: 15_000 },
  );
  await new Pubky().signer(keypair).approveAuthRequest(await handle.jsonValue());
  await page.getByText('Waiting for approval in Pubky Ring').first().waitFor({ state: 'hidden', timeout: 120_000 });
  await page.waitForTimeout(4000);
  return 'approved';
}

async function activityAndOrder(page, tag, keypair) {
  log(`marketplace session (${tag}): ${await enableMarketplaceSession(page, keypair)}`);
  const rendered = new Set(await renderedOrderCards(page));
  await page.goto(at('/marketplace/notifications'), { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
  await page
    .locator('a[href*="/marketplace/orders?order="]')
    .first()
    .waitFor({ state: 'visible', timeout: 45_000 })
    .catch(() => {});
  await page.waitForTimeout(1500);
  const nav = page.locator('[data-surface="marketplace-section-nav"]');
  const navActivity = (await nav.count()) ? await nav.getByRole('link', { name: /Activity/ }).count() : 0;
  const unrecognizedBanner = await page.getByText(/unrecognized marketplace event/i).count();
  const unrecognizedRows = await page.locator('[data-cy="marketplace-unrecognized-notification"]').count();
  const targets = (
    await page
      .locator('a[href*="/marketplace/orders?order="]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('href')).filter(Boolean))
  ).map((href) => decodeURIComponent(new URL(href, 'https://x.invalid').searchParams.get('order') ?? ''));
  const distinct = [...new Set(targets)];
  const hiddenTargets = distinct.filter((id) => !rendered.has(id)).map((id) => id.slice(0, 8));
  await shot(page, `07-activity-${tag}.png`);
  // Prefer an order the page lists; otherwise the first row, whose order must then render in From Activity.
  const listedIndex = targets.findIndex((id) => rendered.has(id));
  const index = listedIndex >= 0 ? listedIndex : targets.length ? 0 : -1;
  let opened = null;
  if (index >= 0) {
    const target = targets[index];
    await page.locator('a[href*="/marketplace/orders?order="]').nth(index).click();
    await page.waitForURL(/\/marketplace\/orders/, { timeout: 30_000 }).catch(() => {});
    await waitForAppReady(page);
    const card = page.locator(`[id="order-${target}"]`);
    await card.waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const url = new URL(page.url());
    const label = (
      (await card
        .getByTestId('order-reference-label')
        .first()
        .innerText()
        .catch(() => '')) || ''
    )
      .replace(/\s+/g, ' ')
      .trim();
    const inView = await card
      .evaluate((el) => {
        const box = el.getBoundingClientRect();
        return box.bottom > 0 && box.top < window.innerHeight;
      })
      .catch(() => false);
    opened = {
      path: url.pathname,
      queryIsOrder: url.searchParams.get('order') === target && url.hash === '',
      targetPrefix: target.slice(0, 8),
      label,
      inView,
      labelMatches: label === `Order ${target.slice(0, 8)}`,
    };
    await shot(page, `08-order-page-${tag}.png`);
  }
  log(
    `activity[${tag}] nav=${navActivity} unrecognized=${unrecognizedBanner}/${unrecognizedRows} orderRows=${targets.length} distinctOrders=${distinct.length} rendered=${rendered.size} hidden=${hiddenTargets.length} opened=${JSON.stringify(opened)}`,
  );
  return {
    navActivity,
    unrecognizedBanner,
    unrecognizedRows,
    orderRows: targets.length,
    distinctOrders: distinct.length,
    renderedCards: rendered.size,
    hiddenTargets,
    opened,
  };
}

function checkActivity(act, tag) {
  check('5', `Activity is in the marketplace section nav (${tag})`, act.navActivity >= 1);
  check(
    '5',
    `Activity has no unrecognized events (${tag})`,
    act.unrecognizedBanner === 0 && act.unrecognizedRows === 0,
  );
  check('5', `Activity lists order rows (${tag})`, act.orderRows > 0, `rows=${act.orderRows}`);
  note(
    '5',
    `Activity rows whose order the Orders page does not render (${tag})`,
    act.hiddenTargets.length === 0,
    `${act.hiddenTargets.length}/${act.distinctOrders}`,
  );
}

async function ringSignIn(page, keypair) {
  await bothQrsLive(page);
  await new Pubky().signer(keypair).approveAuthRequest(await copyQrUrl(page, 'Copy authentication link'));
  await page.waitForFunction(
    (expected) => {
      const raw = localStorage.getItem('shop-auth-store') ?? localStorage.getItem('auth-store');
      const state = raw ? (JSON.parse(raw).state ?? {}) : {};
      return (
        state.currentUserPubky === expected &&
        (typeof state.sessionExport === 'string' || typeof state.grantSessionRecordId === 'string')
      );
    },
    keypair.publicKey.z32(),
    { timeout: 180_000 },
  );
  await page.waitForTimeout(3000);
}

async function mintAuditBearer(client, keypair) {
  const flow = client.startCookieAuthFlow(CAPABILITIES, AuthFlowKind.signin(), RELAY);
  const tokenPromise = flow.awaitToken();
  await client.signer(keypair).approveAuthRequest(flow.authorizationUrl);
  const authToken = await tokenPromise;
  const response = await fetch(`${SERVICE}/v1/auth/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: authToken.toBytes(),
  });
  const body = await response.json().catch(() => ({}));
  if (response.status !== 201) throw new Error(`audit mint HTTP ${response.status}`);
  return { bearer: body.token, sessionId: body.session_id };
}
const listSessions = async (bearer) => {
  const response = await fetch(`${SERVICE}/v1/auth/sessions`, { headers: { authorization: `Bearer ${bearer}` } });
  return { status: response.status, sessions: (await response.json().catch(() => ({}))).sessions ?? [] };
};
const revokeSession = async (bearer, id) =>
  (
    await fetch(`${SERVICE}/v1/auth/sessions/${id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${bearer}` },
    })
  ).status;
const createdThisRun = (row) =>
  !row.revoked_at && Date.parse(row.created_at) >= RUN_START - 5000 && Date.parse(row.expires_at) > Date.now();

// The audit's own session is revoked last: once it is gone its bearer cannot revoke anything.
async function revokeRunSessions(keypair) {
  const client = new Pubky();
  const audit = {
    seat: prefix(keypair.publicKey.z32()),
    runStart: new Date(RUN_START).toISOString(),
    revoked: [],
    error: null,
  };
  try {
    const minted = await mintAuditBearer(client, keypair);
    const before = await listSessions(minted.bearer);
    audit.listStatus = before.status;
    audit.activeFromRunBefore = before.sessions
      .filter(createdThisRun)
      .map((row) => ({ id: row.id, created_at: row.created_at, label: row.label ?? null }));
    const ordered = [...audit.activeFromRunBefore].sort(
      (a, b) => Number(a.id === minted.sessionId) - Number(b.id === minted.sessionId),
    );
    for (const row of ordered) {
      audit.revoked.push({
        id: row.id,
        status: await revokeSession(minted.bearer, row.id),
        audit: row.id === minted.sessionId,
      });
    }
    const verifier = await mintAuditBearer(client, keypair);
    const after = await listSessions(verifier.bearer);
    audit.activeFromRunAfter = after.sessions
      .filter((row) => createdThisRun(row) && row.id !== verifier.sessionId)
      .map((row) => row.id);
    audit.verifierRevoke = await revokeSession(verifier.bearer, verifier.sessionId);
  } catch (error) {
    audit.error = String(error?.message ?? error);
  }
  return audit;
}

// Any request whose path or query mentions USDT (step 4 and step 10 require none while the flag is off).
const usdtRequests = [];
const consoleErrors = [];
const summary = {};
const storefrontBefore = new Map();
for (const keypair of [seat, buyerSeat]) {
  storefrontBefore.set(
    keypair.publicKey.z32(),
    await storefrontExists(new Pubky().publicStorage, keypair.publicKey.z32()),
  );
}
const browser = await chromium.launch({ headless: true });
try {
  const deployment = await servedDeployment({ pageUrl: at('/marketplace'), buildUrl: at('/api/build') });
  summary.dpl = deployment.dpl;
  summary.commit = deployment.commit;
  check('0', 'the origin serves the expected deployment', !deployment.refusal, deployment.refusal ?? deployment.found);

  // Journey A: Ring (steps 1, 5, 6) on one browser session.
  if (runs('1')) {
    const net = [];
    const commands = [];
    const { context, page } = await newContext(browser);
    instrument(page, net, commands);
    try {
      check(
        '1',
        'Ring and Bitkit QRs are both live on /sign-in (side by side, or through the Sign-in app toggle from #135)',
        await bothQrsLive(page),
      );
      await shot(page, '01-sign-in-both-qrs.png');
      const ringUrl = await copyQrUrl(page, 'Copy authentication link');
      const parsed = new URL(ringUrl);
      check(
        '1',
        'Ring QR is a signin_grant for the Shop caps and client id (grant sessions, Shop #248)',
        parsed.host === 'signin_grant' &&
          [...parsed.searchParams.keys()].sort().join(',') === 'caps,cid,cpk,relay,secret' &&
          parsed.searchParams.get('caps') === CAPABILITIES &&
          parsed.searchParams.get('cid') === CLIENT_ID,
        `host=${parsed.host}`,
      );
      const leak = await qrDomLeak(page, ringUrl);
      check('1', 'the QR slot does not carry the authorization URL in the DOM', !leak.attr && !leak.html);
      await new Pubky().signer(seat).approveAuthRequest(ringUrl);
      log('ring: approved');
      await signedInAs(page, 'grantSessionRecordId');
      await page.waitForFunction((path) => window.location.pathname !== path, signInPath, { timeout: 180_000 });
      await page.waitForTimeout(4000);
      await shot(page, '02-ring-signed-in.png');
      const state = await authState(page);
      check(
        '1',
        'signed in as the seat with a grant record and no cookie export',
        state.currentUserPubky === pubky && Boolean(state.grantSessionRecordId) && state.sessionExport === null,
        prefix(state.currentUserPubky),
      );
      const hsPosts = net.filter((e) => e.tag === 'homeserver-session' && e.method === 'POST');
      const mpPosts = net.filter((e) => e.tag === 'marketplace-session' && e.method === 'POST');
      const ringGrantPosts = net.filter((e) => e.tag === 'grant' && e.method === 'POST');
      check(
        '1',
        'one approval → one grant POST 2xx (grant session)',
        ringGrantPosts.length === 1 && ringGrantPosts[0].status < 300,
        ringGrantPosts.map((e) => e.status).join(','),
      );
      if (process.env.PROOF_GS1 === '1') {
        const gs1Posts = net.filter((e) => e.tag === 'gs1' && e.method === 'POST');
        const challenges = gs1Posts.filter((e) => e.path.includes('grant-session-challenges'));
        const mints = gs1Posts.filter((e) => !e.path.includes('grant-session-challenges'));
        check(
          '1',
          'sign-in minted a marketplace session from the grant with no further approval (one challenge, one mint, both 2xx)',
          challenges.length === 1 && mints.length === 1 && [...challenges, ...mints].every((e) => e.status < 300),
          gs1Posts.map((e) => `${e.path.split('/').pop()}:${e.status}`).join(','),
        );
      }
      check(
        '1',
        'one approval → no cookie homeserver POST /session and no cookie marketplace POST /v1/auth/sessions',
        hsPosts.length === 0 && mpPosts.length === 0,
        `hs=${hsPosts.length} mp=${mpPosts.length}`,
      );
      check(
        '1',
        'both QRs are gone once signed in',
        (await page
          .locator('[aria-label="Copy Bitkit authentication link"],[aria-label="Copy authentication link"]')
          .count()) === 0,
      );

      const act = await activityAndOrder(page, 'seller', seat);
      summary.activity = { seller: act };
      checkActivity(act, 'seller');

      const deletesBefore = net.filter((e) => e.tag === 'grant' && e.method === 'DELETE').length;
      const viaSettings = await signOutThroughSettings(page);
      await shot(page, '11-signed-out.png');
      const deletes = net.filter((e) => e.tag === 'grant' && e.method === 'DELETE').slice(deletesBefore);
      check(
        '6',
        'sign-out from Settings → Account clears the Shop state',
        viaSettings,
        viaSettings ? '#sign-out-btn' : 'fell back to /logout',
      );
      check(
        '6',
        'sign-out ends the grant session (DELETE /auth/grant/session 2xx)',
        deletes.some((e) => e.status >= 200 && e.status < 300),
        deletes.map((e) => e.status).join(','),
      );
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 180_000 });
      await waitForAppReady(page);
      await page.waitForTimeout(5000);
      check('6', 'signed out holds across a reload', !(await authState(page)).currentUserPubky);
    } catch (error) {
      await shot(page, 'ring-journey-error.png').catch(() => {});
      check('A', 'Ring journey ran to completion', false, String(error?.message ?? error).slice(0, 240));
    } finally {
      summary.ringNetwork = net;
      summary.ringCommands = commands;
      await context.close();
    }
  }

  // Journey B: Bitkit grant (step 2).
  if (runs('2')) {
    const net = [];
    const commands = [];
    const { context, page } = await newContext(browser);
    instrument(page, net, commands);
    try {
      check('2', 'Bitkit QR is live on /sign-in alongside the Ring QR', await bothQrsLive(page));
      const grantUrl = await copyQrUrl(page, 'Copy Bitkit authentication link');
      const parsed = new URL(grantUrl);
      const link = SigninGrantDeepLink.parse(grantUrl);
      check(
        '2',
        'Bitkit QR is a signin_grant for the Shop caps and client id (the checks Paykit applies)',
        parsed.host === 'signin_grant' &&
          ['caps', 'relay', 'secret', 'cid', 'cpk'].every((k) => parsed.searchParams.getAll(k).length === 1) &&
          link.capabilities === CAPABILITIES &&
          parsed.searchParams.get('cid') === CLIENT_ID,
        `host=${parsed.host} cid=${parsed.searchParams.get('cid')}`,
      );
      const leak = await qrDomLeak(page, grantUrl);
      check('2', 'the Bitkit QR slot does not carry the authorization URL in the DOM', !leak.attr && !leak.html);
      await shot(page, '03-bitkit-qr.png');
      await new Pubky().signer(seat).approveAuthRequest(grantUrl);
      log('bitkit grant: approved');
      await signedInAs(page, 'grantSessionRecordId');
      await page.waitForTimeout(4000);
      const state = await authState(page);
      const grantPosts = net.filter((e) => e.tag === 'grant' && e.method === 'POST');
      check(
        '2',
        'grant approval signs in with a grant record and no cookie export',
        state.currentUserPubky === pubky && state.grantSessionRecordId && state.sessionExport === null,
        `grant POST=${grantPosts.map((e) => e.status).join(',')}`,
      );
      await shot(page, '04-bitkit-signed-in.png');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 180_000 });
      await waitForAppReady(page);
      await page.waitForTimeout(5000);
      const reloaded = await authState(page);
      check(
        '2',
        'reload restores the stored grant',
        reloaded.currentUserPubky === pubky &&
          reloaded.grantSessionRecordId === state.grantSessionRecordId &&
          new URL(page.url()).pathname !== signInPath,
        new URL(page.url()).pathname,
      );
      const netBefore = net.length;
      const viaSettings = await signOutThroughSettings(page);
      await shot(page, '05-bitkit-signed-out.png');
      const teardown = net.slice(netBefore).filter((e) => e.method === 'DELETE' || e.tag === 'grant');
      check(
        '2',
        'grant sign-out from Settings clears the Shop state',
        viaSettings,
        JSON.stringify(teardown.map((e) => `${e.method} ${e.path} ${e.status}`)),
      );
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 180_000 });
      await waitForAppReady(page);
      await page.waitForTimeout(5000);
      const after = await authState(page);
      check('2', 'grant sign-out holds across a reload', !after.currentUserPubky && !after.grantSessionRecordId);
      summary.grantTeardown = teardown;
    } catch (error) {
      await shot(page, 'bitkit-journey-error.png').catch(() => {});
      check('B', 'Bitkit journey ran to completion', false, String(error?.message ?? error).slice(0, 240));
    } finally {
      summary.bitkitNetwork = net;
      summary.bitkitCommands = commands;
      await context.close();
    }
  }

  // Step 4: buyer seat checkout on a listing whose seller takes PayPal, read-only.
  let listingHref = process.env.PROOF_PAYPAL_LISTING_URL ?? null;
  if (runs('4')) {
    const net = [];
    const commands = [];
    const { context, page } = await newContext(browser);
    instrument(page, net, commands);
    try {
      const candidates = listingHref ? [listingHref] : await discoverPaypalListings([pubky, buyerSeat.publicKey.z32()]);
      summary.checkoutCandidates = candidates.length;
      check(
        '4',
        'a listing whose seller takes PayPal is available (PROOF_PAYPAL_LISTING_URL or Nexus discovery)',
        candidates.length > 0,
        `candidates=${candidates.length}`,
      );
      if (candidates.length) {
        await ringSignIn(page, buyerSeat);
        log(`buyer ${prefix(buyerSeat.publicKey.z32())} signed in with Ring for checkout`);
        let co = null;
        for (const href of candidates) {
          co = await paypalCheckout(page, commands, href);
          if (!co.error) {
            listingHref = href;
            break;
          }
          log(`checkout candidate skipped: ${co.error}`);
        }
        summary.checkout = co;
        check('4', 'the listing seller offers PayPal', co.sellerHasPaypal);
        check(
          '4',
          'the buyer reached checkout on the listing',
          !co.error,
          co.error ?? `"${co.title}" seller=${co.sellerPrefix} listing=${co.listingId}`,
        );
        if (!co.error) {
          check(
            '4',
            'payment-config loaded (GET 200) and the loading state cleared',
            co.configStatus === 200 && co.loadingLeft === 0 && co.retry === 0,
            `status=${co.configStatus}`,
          );
          check('4', 'PayPal is offered at checkout', co.paypal >= 1);
          if (co.paypalSelected === null)
            note('4', 'PayPal selection state not exposed by this build (aria-pressed arrives with #135)', true);
          else check('4', 'selecting PayPal marks it as the chosen method', co.paypalSelected);
          check(
            '4',
            'the Pay control renders for PayPal (never clicked)',
            Boolean(co.payState?.visible),
            JSON.stringify(co.payState),
          );
          check('4', 'no "no payment method" copy', !co.forbidden);
          check(
            '4',
            'no USDT option or USDT text at checkout (flag off)',
            co.usdtOption === 0 && !co.usdtText,
            `option=${co.usdtOption} text=${co.usdtText}`,
          );
          check(
            '4',
            'nothing paid and no order command sent',
            co.payCommands.length === 0,
            JSON.stringify(co.payCommands),
          );
          check('4', 'cart emptied afterwards', co.cartLeft === 0);
        }
        await signOutThroughSettings(page);
        const deletes = net.filter((e) => e.tag === 'grant' && e.method === 'DELETE');
        check(
          '4',
          'buyer seat signed out after checkout (DELETE /auth/grant/session 2xx)',
          deletes.some((e) => e.status >= 200 && e.status < 300),
          deletes.map((e) => e.status).join(','),
        );
      }
    } catch (error) {
      await shot(page, 'checkout-journey-error.png').catch(() => {});
      check('4', 'buyer checkout journey ran to completion', false, String(error?.message ?? error).slice(0, 240));
    } finally {
      summary.checkoutNetwork = net;
      await context.close();
    }
  }

  // Step 7: a Bitkit-grant buyer on the step 4 listing. The purchase CTA opens a grant-link QR (#94)
  // that is never approved; the shared navigation reaches Shop settings (#118, #119) at desktop and
  // mobile width; the seller's public Bitcoin availability explains which checkout wallet states
  // (#128) this environment can reach.
  if (listingHref && runs('7')) {
    const net = [];
    const commands = [];
    const { context, page } = await newContext(browser);
    instrument(page, net, commands);
    const buyerPubky = buyerSeat.publicKey.z32();
    const grantBuyer = {};
    try {
      await bothQrsLive(page);
      await new Pubky().signer(buyerSeat).approveAuthRequest(await copyQrUrl(page, 'Copy Bitkit authentication link'));
      await page.waitForFunction(
        (expected) => {
          const raw = localStorage.getItem('shop-auth-store') ?? localStorage.getItem('auth-store');
          const state = raw ? (JSON.parse(raw).state ?? {}) : {};
          return state.currentUserPubky === expected && typeof state.grantSessionRecordId === 'string';
        },
        buyerPubky,
        { timeout: 180_000 },
      );
      await page.waitForTimeout(3000);
      log(`buyer ${prefix(buyerPubky)} signed in with a Bitkit grant`);
      const href = listingHref;
      await page.goto(at(href), { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);
      const ctaPattern = LISTING_CTA;
      await page
        .waitForFunction(
          (source) =>
            [...document.querySelectorAll('button')].some((el) =>
              new RegExp(source).test((el.textContent || '').trim()),
            ),
          ctaPattern.source,
          { timeout: 60_000 },
        )
        .catch(() => {});
      await waitForEnabledPurchase(page);
      const cta = await page.evaluate(
        (source) =>
          [...document.querySelectorAll('button')]
            .map((el) => (el.textContent || '').trim())
            .find((text) => new RegExp(source).test(text)) ?? null,
        ctaPattern.source,
      );
      grantBuyer.cta = cta;
      check(
        '7',
        'the grant buyer sees a purchase control on the listing',
        ['Approve to buy', 'Buy', 'Add to cart'].includes(cta),
        `cta=${cta}`,
      );
      if (cta === 'Approve to buy' || cta === 'Buy') {
        await page.getByRole('button', { name: cta, exact: true }).first().click();
        // v0.6.48 card: "Approve in Bitkit" / "Approve in Pubky Ring"; #135 card: "Authorize".
        const opener = page.getByRole('button', { name: /^(Approve in (Bitkit|Pubky Ring)|Authorize)$/ }).first();
        await opener.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
        grantBuyer.approvalOpener = (await opener.textContent().catch(() => null))?.trim() ?? null;
        await shot(page, '12-approve-to-buy.png');
        if (grantBuyer.approvalOpener) await opener.click();
        const qr = page
          .locator('[role="dialog"] [aria-label="Copy authorization link"] [data-testid="qr-auth-url"]')
          .first();
        const qrShown = await qr
          .waitFor({ state: 'visible', timeout: 60_000 })
          .then(() => true)
          .catch(() => false);
        await shot(page, '12b-approval-qr.png');
        let host = null;
        if (qrShown) {
          const copy = page.locator('[role="dialog"] [aria-label="Copy authorization link"]').first();
          await page.evaluate(() => navigator.clipboard.writeText(''));
          await copy.click().catch(() => {});
          const link = await page
            .waitForFunction(
              async () => {
                const text = await navigator.clipboard.readText();
                return text.startsWith('pubkyauth://') ? text : null;
              },
              null,
              { timeout: 10_000 },
            )
            .then((handle) => handle.jsonValue())
            .catch(() => null);
          host = link ? new URL(link).host : null;
        }
        grantBuyer.approvalHost = host;
        check(
          '7',
          'the purchase CTA opens a purchase-approval QR',
          qrShown,
          `cta=${cta} opener=${grantBuyer.approvalOpener}`,
        );
        check('7', 'the purchase approval is a grant link (#94)', Boolean(host && /grant/.test(host)), `host=${host}`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1500);
        grantBuyer.cartLeft = await emptyCart(page);
      } else {
        note(
          '7',
          'purchase approval QR not exercised: the grant buyer needed no approval on this listing',
          true,
          `cta=${cta}`,
        );
      }
      check(
        '7',
        'nothing paid and no order command sent',
        commands.filter((row) => /^(checkout|order|payment)\./i.test(row.kind)).length === 0,
        JSON.stringify(commands),
      );
      const navSettings = async () =>
        await page.evaluate(
          (settingsPath) =>
            [...document.querySelectorAll('a[href]')].filter((el) => {
              const path = new URL(el.href, location.origin).pathname;
              const box = el.getBoundingClientRect();
              return path.startsWith(settingsPath) && box.width > 0 && box.height > 0;
            }).length,
          `${BASE_PATH}/settings`,
        );
      await page.goto(at('/marketplace'), { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);
      await page.waitForTimeout(3000);
      grantBuyer.desktopSettingsLinks = await navSettings();
      await shot(page, '13-nav-desktop.png');
      check(
        '7',
        'desktop: the shared navigation shows a Settings link (#118, #119)',
        grantBuyer.desktopSettingsLinks >= 1,
        `links=${grantBuyer.desktopSettingsLinks}`,
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);
      await page.waitForTimeout(3000);
      grantBuyer.mobileSettingsLinks = await navSettings();
      await shot(page, '14-nav-mobile.png');
      if (grantBuyer.mobileSettingsLinks === 0) {
        const menu = page.getByRole('button', { name: /menu|navigation/i }).first();
        if (await menu.isVisible().catch(() => false)) {
          await menu.click();
          await page.waitForTimeout(1500);
          grantBuyer.mobileSettingsLinks = await navSettings();
          await shot(page, '15-nav-mobile-menu.png');
        }
      }
      check(
        '7',
        'mobile: Settings is reachable from the navigation',
        grantBuyer.mobileSettingsLinks >= 1,
        `links=${grantBuyer.mobileSettingsLinks}`,
      );
      await page.goto(at(href), { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);
      await page.waitForTimeout(3000);
      await shot(page, '16-listing-mobile.png');
      await page.setViewportSize({ width: 1440, height: 1000 });
      const sellerPk = href.split('/')[href.split('/').indexOf('listing') + 1];
      const config = await (await fetch(`${SERVICE}/v0/sellers/${encodeURIComponent(sellerPk)}/payment-config`))
        .json()
        .catch(() => null);
      const health = await (await fetch(`${SERVICE}/health`)).json().catch(() => null);
      grantBuyer.sellerBitcoin = {
        bitcoinAvailable: config?.bitcoin_available ?? null,
        bitcoinOfferAvailable: config?.bitcoin_offer_available ?? null,
        serviceOffer: health?.paykit_rail?.bitcoin_offer_available ?? null,
      };
      note(
        '7',
        'Bitcoin checkout reachable on this environment (needed for the #128 wallet states)',
        grantBuyer.sellerBitcoin.bitcoinAvailable === true && grantBuyer.sellerBitcoin.serviceOffer === true,
        JSON.stringify(grantBuyer.sellerBitcoin),
      );
      const viaSettings = await signOutThroughSettings(page);
      check('7', 'grant buyer signed out from Settings', viaSettings);
    } catch (error) {
      await shot(page, 'grant-buyer-journey-error.png').catch(() => {});
      check('7', 'grant-buyer journey ran to completion', false, String(error?.message ?? error).slice(0, 240));
    } finally {
      summary.grantBuyer = grantBuyer;
      summary.grantBuyerNetwork = net;
      await context.close();
    }
  }

  // Step 8: the seller seat (Ring) opens the main buyer and seller surfaces read-only: cart, checkout,
  // orders, My shop and storefront render a heading and no error page, at desktop and mobile width.
  if (runs('8')) {
    const net = [];
    const commands = [];
    const { context, page } = await newContext(browser);
    instrument(page, net, commands);
    const surfaces = {};
    try {
      await ringSignIn(page, seat);
      for (const [width, height, tag] of [
        [1440, 1000, 'desktop'],
        [390, 844, 'mobile'],
      ]) {
        await page.setViewportSize({ width, height });
        for (const name of ['cart', 'checkout', 'orders', 'my-shop', 'storefront']) {
          await page.goto(at(`/marketplace/${name}`), { waitUntil: 'domcontentloaded', timeout: 180_000 });
          await waitForAppReady(page);
          await page.waitForTimeout(2500);
          const view = await page.evaluate(() => ({
            path: location.pathname,
            heading: (document.querySelector('h1')?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
            error: /Something went wrong|Application error|This page could not be found|Unhandled Runtime Error/i.test(
              document.body?.innerText ?? '',
            ),
          }));
          surfaces[`${name}-${tag}`] = view;
          await shot(page, `17-${name}-${tag}.png`);
          check(
            '8',
            `${name} renders at ${tag} width without an error page`,
            !view.error && view.heading.length > 0,
            `${view.path} h1="${view.heading}"`,
          );
        }
      }
      check('8', 'surfaces sent no command', commands.length === 0, JSON.stringify(commands));
      await page.setViewportSize({ width: 1440, height: 1000 });
      const viaSettings = await signOutThroughSettings(page);
      check('8', 'seller signed out from Settings', viaSettings);
    } catch (error) {
      await shot(page, 'surfaces-journey-error.png').catch(() => {});
      check('8', 'surfaces journey ran to completion', false, String(error?.message ?? error).slice(0, 240));
    } finally {
      summary.surfaces = surfaces;
      await context.close();
    }
  }

  // Step 9: the buyer seat's Bitcoin wallet state at checkout, read-only (#128). A buyer whose pubky
  // has Paykit receiver markers and no App Registry (Bitkit 2.5) must not see the Bitkit 2.6 or
  // "Couldn't verify" notice. PROOF_BITCOIN_LISTING_URL is tried first.
  // Pay is never clicked; the cart is emptied.
  if (runs('9')) {
    const net = [];
    const commands = [];
    const { context, page } = await newContext(browser);
    instrument(page, net, commands);
    const btc = {};
    try {
      const buyerPubky = buyerSeat.publicKey.z32();
      btc.registry = await new Pubky().publicStorage
        .exists(`pubky://${buyerPubky}/pub/paykit/v0/app-registry.json`)
        .catch(() => null);
      const items = await (await fetch(`${NEXUS}/v0/stream/listings?limit=100`)).json().catch(() => []);
      const configs = new Map();
      const hrefs = process.env.PROOF_BITCOIN_LISTING_URL ? [process.env.PROOF_BITCOIN_LISTING_URL] : [];
      for (const row of Array.isArray(items) ? items : []) {
        if (row.state !== 'active' || row.sale_format !== 'fixed_price' || row.owner_id === buyerPubky) continue;
        if (hrefs.some((href) => href.endsWith(`/${row.id}`))) continue;
        if (!configs.has(row.owner_id))
          configs.set(
            row.owner_id,
            await (await fetch(`${SERVICE}/v0/sellers/${encodeURIComponent(row.owner_id)}/payment-config`))
              .json()
              .catch(() => null),
          );
        const config = configs.get(row.owner_id);
        if (
          config?.bitcoin_available === true &&
          config?.bitcoin_offer_available !== false &&
          /test|do not buy/i.test(row.title ?? '')
        ) {
          hrefs.push(`/marketplace/listing/${row.owner_id}/${row.id}`);
        }
      }
      btc.candidates = hrefs.length;
      check(
        '9',
        'a test listing whose seller takes Bitcoin is available',
        hrefs.length > 0,
        `candidates=${hrefs.length}`,
      );
      if (hrefs.length) {
        await ringSignIn(page, buyerSeat);
        await emptyCart(page);
        let canAdd = false;
        let add = null;
        btc.skipped = [];
        for (const href of hrefs) {
          await page.goto(at(href), { waitUntil: 'domcontentloaded' });
          await waitForAppReady(page);
          await page
            .waitForFunction(
              (source) =>
                [...document.querySelectorAll('button')].some((el) =>
                  new RegExp(source).test((el.textContent || '').trim()),
                ),
              LISTING_CTA.source,
              { timeout: 30_000 },
            )
            .catch(() => {});
          await waitForEnabledPurchase(page);
          add = page.getByRole('button', { name: BUY_LABEL }).first();
          canAdd = Boolean((await add.count()) && (await add.isEnabled().catch(() => false)));
          if (canAdd) {
            btc.listingHref = href;
            btc.listing = href
              .split('/')
              .slice(-2)
              .map((part) => part.slice(0, 8))
              .join('/');
            break;
          }
          const id = (href.split('/').filter(Boolean).slice(-1)[0] || '').slice(0, 8);
          const buttons = await page.evaluate(
            (source) =>
              [...document.querySelectorAll('button')]
                .filter((el) => new RegExp(source).test((el.textContent || '').trim()))
                .map((el) => `${(el.textContent || '').trim()}${el.disabled ? ' (disabled)' : ''}`),
            LISTING_CTA.source,
          );
          btc.skipped.push({ id, buttons });
          await shot(page, `18-skip-${id}.png`);
        }
        check('9', 'the buyer can add a Bitcoin test listing to the cart', canAdd, JSON.stringify(btc.skipped));
        if (canAdd) {
          await add.click();
          await page.waitForTimeout(1200);
          // Grant sessions carry no marketplace session: the first purchase action opens "Enable purchases",
          // a Ring approval of the marketplace session. Approve it as the buyer seat, then buy again if needed.
          const enable = page.getByRole('dialog').filter({ hasText: 'Enable purchases' }).first();
          btc.enablePurchases = await enable.isVisible().catch(() => false);
          if (btc.enablePurchases) {
            const copy = enable.getByRole('button', { name: 'Copy authorization link' }).first();
            await page.waitForFunction(
              () => {
                const b = document.querySelector('[role="dialog"] [aria-label="Copy authorization link"]');
                return Boolean(b && !b.disabled);
              },
              null,
              { timeout: 60_000 },
            );
            await page.evaluate(() => navigator.clipboard.writeText(''));
            await copy.click();
            const handle = await page.waitForFunction(
              async () => {
                const t = await navigator.clipboard.readText();
                return t.startsWith('pubkyauth://') ? t : null;
              },
              null,
              { timeout: 15_000 },
            );
            const link = await handle.jsonValue();
            btc.enablePurchasesHost = new URL(link).host;
            await new Pubky().signer(buyerSeat).approveAuthRequest(link);
            await enable.waitFor({ state: 'hidden', timeout: 120_000 });
            await page.waitForTimeout(3000);
          }
          check(
            '9',
            'the Enable purchases approval completed (or was not needed)',
            !btc.enablePurchases || !(await enable.isVisible().catch(() => false)),
            JSON.stringify({ enablePurchases: btc.enablePurchases, host: btc.enablePurchasesHost }),
          );
          await shot(page, '18-after-add.png');
          await page.goto(at('/marketplace/cart'), { waitUntil: 'domcontentloaded' });
          await waitForAppReady(page);
          await page.waitForTimeout(1500);
          if (!(await page.getByTestId('marketplace-cart-checkout').count())) {
            btc.boughtAgain = true;
            await page.goto(at(btc.listingHref), { waitUntil: 'domcontentloaded' });
            await waitForAppReady(page);
            await waitForEnabledPurchase(page);
            await page.getByRole('button', { name: BUY_LABEL }).first().click();
            await page.waitForTimeout(2500);
            await page.goto(at('/marketplace/cart'), { waitUntil: 'domcontentloaded' });
            await waitForAppReady(page);
          }
          await page.getByTestId('marketplace-cart-checkout').first().click();
          await page.waitForURL(/\/marketplace\/checkout/, { timeout: 30_000 });
          await waitForAppReady(page);
          await page
            .waitForFunction(() => !document.querySelector('[aria-label="Loading payment methods"]'), null, {
              timeout: 30_000,
            })
            .catch(() => {});
          const method = page.getByTestId('marketplace-checkout-method-paykit').first();
          await method.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
          btc.offered = (await method.count()) > 0;
          const sellerConfig = await (
            await fetch(`${SERVICE}/v0/sellers/${encodeURIComponent(seat.publicKey.z32())}/payment-config`)
          )
            .json()
            .catch(() => null);
          btc.sellerBitcoinAvailable = sellerConfig?.bitcoin_available === true;
          if (btc.sellerBitcoinAvailable) check('9', 'Bitcoin is offered at checkout', btc.offered);
          else
            note(
              '9',
              'KNOWN: Bitcoin checkout not provable here, the fixture seller is not Paykit-ready (bitcoin_available=false), so checkout offers no method',
              !btc.offered,
              JSON.stringify(sellerConfig),
            );
          if (!btc.offered) {
            await shot(page, '18-checkout-no-method.png');
            btc.checkoutText = (
              (await page
                .locator('[data-testid="marketplace-checkout-payment-method"]')
                .first()
                .innerText()
                .catch(() => '')) || ''
            )
              .replace(/\s+/g, ' ')
              .slice(0, 300);
            note('9', 'checkout payment method section', true, btc.checkoutText);
          }
          if (btc.offered) {
            await method.click();
            await page.waitForTimeout(6000);
            const count = async (id) => await page.getByTestId(id).count();
            btc.unsupported = await count('marketplace-checkout-bitkit-unsupported');
            btc.unverified = await count('marketplace-checkout-bitkit-unverified');
            btc.required = await count('marketplace-checkout-bitkit-required');
            btc.reason =
              (
                (await page
                  .locator('#checkout-pay-reason')
                  .first()
                  .innerText()
                  .catch(() => '')) || ''
              ).slice(0, 120) || null;
            await shot(page, '18-checkout-bitcoin.png');
            check('9', 'no Bitkit 2.6 notice for this buyer', btc.unsupported === 0, JSON.stringify(btc));
            check('9', 'no "Couldn\'t verify your Bitcoin wallet" notice', btc.unverified === 0);
            note(
              '9',
              'buyer wallet takes Bitcoin payment requests (no "Connect Bitkit")',
              btc.required === 0,
              `registry=${btc.registry}`,
            );
          }
          check(
            '9',
            'nothing paid and no order command sent',
            commands.filter((row) => /^(checkout|order|payment)\./i.test(row.kind)).length === 0,
            JSON.stringify(commands),
          );
          btc.cartLeft = await emptyCart(page);
          check('9', 'cart emptied afterwards', btc.cartLeft === 0);
        }
        check('9', 'buyer signed out from Settings', await signOutThroughSettings(page));
      }
    } catch (error) {
      await shot(page, 'bitcoin-journey-error.png').catch(() => {});
      check(
        '9',
        'Bitcoin wallet-state journey ran to completion',
        false,
        String(error?.message ?? error).slice(0, 240),
      );
    } finally {
      summary.bitcoin = btc;
      await context.close();
    }
  }

  // Step 10: USDT stays invisible with the flag off (#146, #150, #151, #149, #157). The seller seat opens
  // payment settings (How you get paid) and My shop; neither shows USDT, and no request mentions USDT.
  if (runs('10')) {
    const net = [];
    const commands = [];
    const { context, page } = await newContext(browser);
    instrument(page, net, commands);
    try {
      await ringSignIn(page, seat);
      for (const path of ['/marketplace/settings', '/marketplace/my-shop']) {
        await page.goto(at(path), { waitUntil: 'domcontentloaded', timeout: 180_000 });
        await waitForAppReady(page);
        await page.waitForTimeout(4000);
        const text = await page.locator('body').innerText();
        await shot(page, `19-usdt${path.replaceAll('/', '-')}.png`);
        check('10', `${path} shows no USDT`, !/USDT/.test(text), `chars=${text.length}`);
      }
      check(
        '10',
        'no request mentions USDT during the run',
        usdtRequests.length === 0,
        JSON.stringify(usdtRequests.slice(0, 5)),
      );
      check('10', 'seller signed out from Settings', await signOutThroughSettings(page));
    } catch (error) {
      await shot(page, 'usdt-journey-error.png').catch(() => {});
      check('10', 'USDT-invisible journey ran to completion', false, String(error?.message ?? error).slice(0, 240));
    } finally {
      await context.close();
    }
  }

  // Step 11: store connections (WooCommerce, #135). The service's /health lists woocommerce under
  // connectors.providers, and the seller seat sees the WooCommerce tab and connect form (read only).
  if (ONLY_STEPS.has('11')) {
    const health = await (await fetch(`${SERVICE}/health`)).json();
    check(
      '11',
      'service /health connectors.providers includes woocommerce',
      Array.isArray(health.connectors?.providers) && health.connectors.providers.includes('woocommerce'),
      JSON.stringify(health.connectors ?? null),
    );
    const net = [];
    const commands = [];
    const { context, page } = await newContext(browser);
    instrument(page, net, commands);
    try {
      await ringSignIn(page, seat);
      await page.goto(at('/marketplace/settings/store-connections'), {
        waitUntil: 'domcontentloaded',
        timeout: 180_000,
      });
      await waitForAppReady(page);
      await page.getByRole('heading', { level: 1 }).first().waitFor({ state: 'visible', timeout: 60_000 });
      await page.waitForTimeout(5000);
      const unavailable = await page.getByTestId('store-connections-unavailable').count();
      const tab = page.getByRole('tab', { name: 'WooCommerce' });
      const tabs = await page
        .getByRole('tablist', { name: 'Store type' })
        .innerText()
        .catch(() => '');
      check('11', 'Store connections is available on this server', unavailable === 0, `unavailable=${unavailable}`);
      check(
        '11',
        'the seller sees WooCommerce (and Shopify) as store types',
        (await tab.count()) === 1 && /Shopify/.test(tabs),
        JSON.stringify(tabs),
      );
      if (await tab.count()) await tab.click();
      await page.waitForTimeout(1500);
      await shot(page, '20-store-connections-woocommerce.png');
      const connect = await page
        .getByTestId('connect-woocommerce')
        .isVisible()
        .catch(() => false);
      check('11', 'the WooCommerce connect form is shown', connect);
      check(
        '11',
        'no connector write happened (no POST to /v1/connectors)',
        !net.some((e) => e.tag === 'connectors' && e.method !== 'GET'),
        JSON.stringify(net.filter((e) => e.tag === 'connectors').map((e) => `${e.method} ${e.status}`)),
      );
      check('11', 'seller signed out from Settings', await signOutThroughSettings(page));
    } catch (error) {
      await shot(page, 'store-connections-error.png').catch(() => {});
      check('11', 'store connections journey ran to completion', false, String(error?.message ?? error).slice(0, 240));
    } finally {
      await context.close();
    }
  }

  // Step 5 order page: the seller's Activity may only point at orders its Orders page hides;
  // then the buyer seat, whose paid orders are rendered, proves the row → order navigation.
  if (runs('1')) {
    let opened = summary.activity?.seller?.opened ?? null;
    let openedBy = 'seller';
    if (!opened) {
      const net = [];
      const commands = [];
      const { context, page } = await newContext(browser);
      instrument(page, net, commands);
      try {
        await ringSignIn(page, buyerSeat);
        log(`buyer ${prefix(buyerSeat.publicKey.z32())} signed in with Ring`);
        const act = await activityAndOrder(page, 'buyer', buyerSeat);
        summary.activity.buyer = act;
        checkActivity(act, 'buyer');
        opened = act.opened;
        openedBy = 'buyer';
        await signOutThroughSettings(page);
        const deletes = net.filter((e) => e.tag === 'grant' && e.method === 'DELETE');
        check(
          '5',
          'buyer seat signed out (DELETE /auth/grant/session 2xx)',
          deletes.some((e) => e.status >= 200 && e.status < 300),
          deletes.map((e) => e.status).join(','),
        );
        check('5', 'buyer journey sent no order command', commands.length === 0, JSON.stringify(commands));
      } catch (error) {
        await shot(page, 'buyer-journey-error.png').catch(() => {});
        check('C', 'buyer Activity journey ran to completion', false, String(error?.message ?? error).slice(0, 240));
      } finally {
        summary.buyerNetwork = net;
        await context.close();
      }
    }
    check(
      '5',
      'an Activity row opens that order on the Orders page (card rendered, in view, label matches)',
      Boolean(
        opened?.queryIsOrder &&
        opened?.labelMatches &&
        opened?.inView &&
        opened.path === `${BASE_PATH}/marketplace/orders`,
      ),
      `${openedBy} ${JSON.stringify(opened)}`,
    );
  }
} finally {
  await browser.close();
}

summary.sessionAudit = [];
for (const keypair of [seat, buyerSeat]) {
  const audit = await revokeRunSessions(keypair);
  summary.sessionAudit.push(audit);
  check(
    'cleanup',
    `every marketplace session ${audit.seat} gained during the run is revoked`,
    !audit.error &&
      audit.revoked.every((row) => row.status === 204 || row.status === 200) &&
      (audit.activeFromRunAfter ?? []).length === 0 &&
      audit.verifierRevoke < 300,
    audit.error ?? `revoked=${audit.revoked.length} activeAfter=${(audit.activeFromRunAfter ?? []).length}`,
  );
}
summary.storefrontCleanup = [];
for (const keypair of [seat, buyerSeat]) {
  const seatPubky = keypair.publicKey.z32();
  const cleanup = await removeRunStorefront({
    publicStorage: new Pubky().publicStorage,
    signer: new Pubky().signer(keypair),
    pubky: seatPubky,
    existedBefore: storefrontBefore.get(seatPubky),
    nexus: NEXUS,
  }).catch((error) => ({ ok: false, error: String(error?.message ?? error) }));
  summary.storefrontCleanup.push({ seat: prefix(seatPubky), ...cleanup });
  check(
    'cleanup',
    `${prefix(seatPubky)} has no storefront the run published (shop.json gone from the homeserver and Nexus, or pre-existing and kept)`,
    cleanup.ok,
    JSON.stringify(cleanup),
  );
}
summary.consoleErrors = consoleErrors.slice(0, 40);
summary.knownDefects = notes;
summary.results = results;
const steps = {};
for (const row of results) steps[row.step] = (steps[row.step] ?? true) && row.ok;
summary.steps = steps;
writeFileSync(join(EVIDENCE, 'results.json'), `${redact(JSON.stringify(summary, null, 2))}\n`);
const failed = results.filter((row) => !row.ok).length;
log(`STEPS ${JSON.stringify(steps)}`);
log(`RESULT ${failed === 0 ? 'PASS' : 'FAIL'} ${results.length - failed}/${results.length}`);
process.exit(failed === 0 ? 0 : 1);
