// Pure helpers for the paid digital delivery proof (production-digital-fixture.mjs). No I/O and no browser, so
// every rule that protects money or evidence is unit tested (digital-proof.test.ts).
import { createHash, randomBytes } from 'node:crypto';

export const DIGITAL_KINDS = ['file', 'link', 'text', 'email', 'message'];

// Radio labels in the seller's "How buyers receive it" editor (src/hooks/useDigitalDeliveryEditor).
export const KIND_RADIO_LABEL = {
  file: 'A file',
  link: 'A link',
  text: 'Text or a licence key',
  email: "I'll email it",
  message: "I'll send it in messages",
};

// What the editor's "current delivery" line says after a save (digitalDeliveryCurrentSummary in src/libs/commerce).
export function expectedCurrentSummary(kind, fileName, sizeLabel) {
  switch (kind) {
    case 'file':
      return `Buyers download ${fileName} (${sizeLabel}) after payment.`;
    case 'link':
      return 'Buyers get your link after payment.';
    case 'text':
      return 'Buyers see your text after payment.';
    case 'email':
      return 'You email buyers after payment, then mark it emailed.';
    case 'message':
      return 'You send it in the order messages after payment, then mark it delivered.';
    default:
      throw new Error(`unknown delivery kind ${kind}`);
  }
}

// The checkout line under a digital item (digitalCheckoutLineLabel + digitalDeliveryBadgeLabel).
export function expectedCheckoutLine(kind) {
  const how = {
    file: /^Instant download/,
    link: /^Instant access$/,
    text: /^Instant access$/,
    email: /^Emailed by the seller after payment$/,
    message: /^Sent by the seller in messages after payment$/,
  }[kind];
  if (!how) throw new Error(`unknown delivery kind ${kind}`);
  return how;
}

export const isInstantKind = (kind) => ['file', 'link', 'text'].includes(kind);

export function parseKinds(value) {
  const kinds = String(value ?? 'file')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (kinds.length === 0) throw new Error('PROOF_DIGITAL_KINDS names no delivery kind');
  for (const kind of kinds) {
    if (!DIGITAL_KINDS.includes(kind))
      throw new Error(`unknown delivery kind "${kind}"; use ${DIGITAL_KINDS.join(', ')}`);
  }
  if (new Set(kinds).size !== kinds.length) throw new Error('PROOF_DIGITAL_KINDS repeats a delivery kind');
  return kinds;
}

// One paid order is real money. The run refuses unless the environment carries today's go-ahead, which expires
// at the end of the UTC day it names so an old approval cannot start a run.
export function goToken(now = new Date()) {
  return `GO-${now.toISOString().slice(0, 10)}`;
}

export function hasGoAhead(env, now = new Date()) {
  return env.PROOF_DIGITAL_GO === goToken(now);
}

const PRICE = /^\d{1,4}\.\d{2}$/;

export function parsePriceUsd(value) {
  const text = String(value ?? '2.00');
  if (!PRICE.test(text)) throw new Error('PROOF_DIGITAL_PRICE_USD must look like 2.00 (dollars, two decimals)');
  const cents = Math.round(Number(text) * 100);
  if (cents < 100) throw new Error('PROOF_DIGITAL_PRICE_USD must be at least 1.00');
  if (cents > 2500) throw new Error('PROOF_DIGITAL_PRICE_USD is capped at 25.00 for a proof order');
  return { text, cents };
}

// The service refuses a Bitcoin bind under 1,000 sats (payment_methods.rs). The price must clear that with a
// margin so a rate move between quote and payment cannot flip it.
export const SERVICE_MIN_SATS = 1000;

export function minPriceCents(usdPerBtc, margin = 2) {
  if (!Number.isFinite(usdPerBtc) || usdPerBtc <= 0) throw new Error('a positive BTC/USD rate is required');
  return Math.ceil(((SERVICE_MIN_SATS * margin * usdPerBtc) / 1e8) * 100);
}

export function priceClearsMinimum(cents, usdPerBtc, margin = 2) {
  return cents >= minPriceCents(usdPerBtc, margin);
}

// The Blocktank FX feed answers `{ tickers: [{ symbol: 'BTCUSD', lastPrice: '83921', ... }, ...] }`. Returns the USD
// per BTC rate, or null when the feed has no usable BTCUSD row.
export function parseBtcUsdRate(body) {
  const tickers = Array.isArray(body?.tickers) ? body.tickers : [];
  const row = tickers.find((ticker) => ticker?.symbol === 'BTCUSD');
  const rate = Number(row?.lastPrice);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

// A fixture file that cannot be mistaken for real content: a text header plus random bytes, so a hash match
// proves the bytes survived encrypt, store, pin, fetch and decrypt.
export function makeFixtureFile(runId, bytes = 64 * 1024) {
  if (bytes < 1024) throw new Error('the fixture file must be at least 1 KiB');
  const header = Buffer.from(`pubky digital delivery proof ${runId}. Do not use.\n`, 'utf8');
  const body = Buffer.concat([header, randomBytes(bytes - header.length)]);
  return { name: `digital-proof-${runId}.bin`, bytes: body, sha256: sha256Hex(body) };
}

export const sha256Hex = (buffer) => createHash('sha256').update(buffer).digest('hex');

export function formatSizeLabel(sizeBytes) {
  const kilobytes = sizeBytes / 1024;
  if (kilobytes < 1024) return `${Math.max(1, Math.round(kilobytes))} KB`;
  const megabytes = kilobytes / 1024;
  return megabytes < 10 ? `${megabytes.toFixed(1)} MB` : `${Math.round(megabytes)} MB`;
}

export const newRunId = () => randomBytes(3).toString('hex');

export const listingTitle = (runId, kind) => `SMOKE FIXTURE, do not buy ${runId} ${kind}`;

// Reasons the pay wait ended, in the order they are decided.
export function payOutcome({ paid, elapsedMs, timeoutMs, interrupted = false }) {
  if (paid) return 'paid';
  if (interrupted) return 'interrupted';
  return elapsedMs >= timeoutMs ? 'timeout' : 'waiting';
}

// The Bitcoin hold is 30 minutes (BITCOIN_PAYMENT_WINDOW_SECONDS). A wait that could outlast it would leave the
// operator paying an invoice the service already voided.
export const BITCOIN_WINDOW_MINUTES = 30;

export function parsePayTimeoutMinutes(value) {
  const minutes = Number(value ?? 25);
  if (!Number.isInteger(minutes) || minutes < 2 || minutes > BITCOIN_WINDOW_MINUTES - 3) {
    throw new Error(`PROOF_DIGITAL_PAY_TIMEOUT_MIN must be a whole number from 2 to ${BITCOIN_WINDOW_MINUTES - 3}`);
  }
  return minutes;
}

// How long the seller side waits for an external buyer to order, pay and download, in whole minutes (PROOF_DIGITAL_WAIT_MIN).
export function parsePositiveMinutes(value, fallback) {
  const minutes = Number(value ?? fallback);
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 480) {
    throw new Error('PROOF_DIGITAL_WAIT_MIN must be a whole number of minutes from 5 to 480');
  }
  return minutes;
}

// Deliverable ciphertext paths the run created: those under the deliverables folder now that were not there
// before setup. Only these are ever deleted.
export const DELIVERABLES_PREFIX = '/pub/pubky.app/marketplace/v1/deliverables/';

export function pathFromPubkyUrl(url) {
  const match = String(url).match(/^pubky:\/\/[^/]+(\/.*)$/);
  return match ? match[1] : null;
}

export function newDeliverablePaths(before, after) {
  const known = new Set(before);
  return after.filter((path) => path.startsWith(DELIVERABLES_PREFIX) && !known.has(path));
}

export function redactEmail(text, email) {
  return email ? String(text ?? '').replaceAll(email, '[redacted-email]') : String(text ?? '');
}

// Everything the proof logs or records goes through here: the tester mailbox is replaced and a full z32 public key
// (52 characters) is cut to its 8-character prefix.
export function redactSensitive(text, email) {
  return redactEmail(text, email).replace(/\b([13-9a-km-uw-z]{8})[13-9a-km-uw-z]{44}\b/g, '$1…');
}

// The stack the hold-smoke and rehearsals run against is explicit configuration: comma lists of the staging origins,
// service URLs and Nexus URLs in PROOF_STAGING_ORIGINS, PROOF_STAGING_SERVICES and PROOF_STAGING_NEXUS. Anything
// else, including every target when a list is unset or empty, is production for this script's purposes.
const originList = (raw) =>
  String(raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => originOf(item))
    .filter(Boolean);

/** @param {Record<string, string | undefined>} [env] */
export function stagingTarget(env = process.env) {
  return {
    origins: originList(env.PROOF_STAGING_ORIGINS),
    services: originList(env.PROOF_STAGING_SERVICES),
    nexus: originList(env.PROOF_STAGING_NEXUS),
  };
}

const originOf = (raw) => {
  try {
    return new URL(String(raw)).origin;
  } catch {
    return null;
  }
};

/** @param {Record<string, string | undefined>} [env] */
export function isStagingTarget({ origin, service, nexus }, env = process.env) {
  const staging = stagingTarget(env);
  return (
    staging.origins.includes(originOf(origin)) &&
    staging.services.includes(originOf(service)) &&
    staging.nexus.includes(originOf(nexus))
  );
}

// A run that touches anything but staging needs PROOF_ALLOW_PRODUCTION=1, set on purpose by the person who
// authorized it. Returns the refusal message, or null when the run may go ahead.
export function targetRefusal(target, env = {}) {
  const unset = [
    ['PROOF_ORIGIN', target.origin],
    ['PROOF_SERVICE', target.service],
    ['PROOF_NEXUS', target.nexus],
  ]
    .filter(([, url]) => !url)
    .map(([name]) => name);
  if (unset.length) return `refusing to run: set ${unset.join(', ')}; the proof scripts have no default target`;
  if (env.PROOF_ALLOW_PRODUCTION === '1' || isStagingTarget(target, env)) return null;
  const staging = stagingTarget(env);
  const wrong = [
    ['PROOF_ORIGIN', target.origin, staging.origins],
    ['PROOF_SERVICE', target.service, staging.services],
    ['PROOF_NEXUS', target.nexus, staging.nexus],
  ]
    .filter(([, url, allowed]) => !allowed.includes(originOf(url)))
    .map(([name, url]) => `${name}=${originOf(url) ?? 'invalid'}`);
  return `refusing to run: ${wrong.join(', ')} is not the staging stack. List the staging stack in PROOF_STAGING_ORIGINS, PROOF_STAGING_SERVICES and PROOF_STAGING_NEXUS and point PROOF_ORIGIN, PROOF_SERVICE and PROOF_NEXUS at it, or set PROOF_ALLOW_PRODUCTION=1 to run against production on purpose`;
}

export const extractDpl = (html) => (String(html ?? '').match(/dpl_[A-Za-z0-9]+/) || [])[0] ?? null;

// The expected deployment must be the one the origin serves now; a missing expectation never passes.
export function deploymentRefusal({ found, expected }) {
  if (!expected) return 'set EXPECTED_DPL to the dpl_… id now aliased to the origin';
  if (found !== expected) return `the origin is serving ${found ?? 'no deployment id'}, not EXPECTED_DPL ${expected}`;
  return null;
}

// The email kind is the one flow that types and shows the tester mailbox, so its screenshots are not saved unless
// asked for (PROOF_DIGITAL_EMAIL_SCREENSHOTS=1). Whenever a mailbox is configured, every saved screenshot has it
// masked, including any field whose value holds it.
export function screenshotPolicy({ kind, email, optIn }) {
  return { save: kind !== 'email' || Boolean(optIn), mask: Boolean(email) };
}

// The step list `plan` prints and the evidence folder records; no step here is run by the planner.
export function describePlan({ kinds, priceText, origin, service }) {
  const lines = [
    `origin ${origin}`,
    `service ${service}`,
    `price ${priceText} USD per listing, paid in Bitcoin (service quote, 1,000-sat floor)`,
    `kinds ${kinds.join(', ')}`,
    'setup: one "SMOKE FIXTURE, do not buy" digital listing per kind from the seller seat, delivery set on its edit page',
  ];
  for (const kind of kinds) {
    lines.push(
      `${kind}: buyer seat checks out, Pay; an operator pays the Bitkit Payment Request; then ${describeSettle(kind)}`,
    );
  }
  lines.push(
    'teardown: delete the listings and their ciphertext, revoke run sessions, verify; paid orders remain as evidence',
  );
  return lines;
}

function describeSettle(kind) {
  switch (kind) {
    case 'file':
      return 'the buyer downloads twice and the SHA-256 matches; the seller sees the access evidence';
    case 'link':
      return 'the buyer shows the link and it equals the one set; the seller sees the access evidence';
    case 'text':
      return 'the buyer reveals the text and it equals the one set; the seller sees the access evidence';
    case 'email':
      return 'the seller shows the email, emails it by hand, marks it emailed; the buyer sees "Emailed to"';
    case 'message':
      return 'the seller sends it in messages by hand, marks it delivered; the buyer sees the delivered line';
    default:
      throw new Error(`unknown delivery kind ${kind}`);
  }
}

const MASK_ATTRIBUTE = 'data-proof-mask';

// Takes a Playwright screenshot of a page or locator with the tester mailbox painted over: any element whose text
// contains it, and any input or textarea whose value does (a value is not text, so it is tagged first and the tag
// removed afterwards). With no mailbox it is a plain screenshot.
export async function maskedScreenshot(target, { path, email = '', fullPage = false }) {
  const page = typeof target.page === 'function' ? target.page() : target;
  if (email) {
    await page.evaluate(
      ({ needle, attribute }) => {
        for (const field of document.querySelectorAll('input, textarea')) {
          if (field.value.toLowerCase().includes(needle)) field.setAttribute(attribute, '1');
        }
      },
      { needle: email.toLowerCase(), attribute: MASK_ATTRIBUTE },
    );
  }
  try {
    return await target.screenshot({
      path,
      ...(fullPage ? { fullPage } : {}),
      mask: email ? [page.locator(`[${MASK_ATTRIBUTE}]`), page.getByText(email)] : [],
    });
  } finally {
    if (email) {
      await page
        .evaluate((attribute) => {
          for (const field of document.querySelectorAll(`[${attribute}]`)) field.removeAttribute(attribute);
        }, MASK_ATTRIBUTE)
        .catch(() => {});
    }
  }
}
