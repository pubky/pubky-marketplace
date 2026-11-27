#!/usr/bin/env node
// What a production build serves for a pinned store and for each claim-mode state, checked with HTTP and Chromium.
// Claim mode reads a loopback stub of the order service's public GET /v1/store route. Each state gets a new next start.
//
// The proxy answers a path a store does not serve by rewriting it to `/_not-found`, the route Next.js builds from
// `src/app/not-found.tsx` (see `STORE_NOT_FOUND_PATHNAME` in `src/app/store-route-policy.ts`). This check verifies
// what the visitor gets from the production server. A masked page or route handler
// answers 404 with the app's not-found page, while kept routes still answer. A page can arrive with the right status
// and markup and still hydrate into an error screen, so Chromium opens the masked pages that a guest stays on.
//
// Reuses an existing build (`npm run build`); it never builds. Starts `next start` on STORE_CHECK_PORT (default 3100)
// for the pinned store and each claim state. Pubky and public marketplace URLs use closed ports; only the server-only
// service URL reaches the loopback stub on STORE_CHECK_STUB_PORT (default 3199), so nothing reads live data.
// Needs Playwright's Chromium (`npx playwright install chromium`). A build with NEXT_PUBLIC_BASE_PATH needs the same
// value set here. Exit 0 only when every check passed.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PORT = Number(process.env.STORE_CHECK_PORT ?? 3100);
const STUB_PORT = Number(process.env.STORE_CHECK_STUB_PORT ?? 3199);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const STUB_ORIGIN = `http://127.0.0.1:${STUB_PORT}`;
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const STORE_SELLER = 'ybndrfg8ejkmcpqxot1uwisza345h769ybndrfg8ejkmcpqxot1u';
const OTHER_SELLER = 'o'.repeat(52);
const NOT_FOUND_TITLE = '<title>Page Not Found - Pubky Market</title>';
const NOT_FOUND_COPY = 'Could not find requested resource';
// Without it the page hydrates into an error screen instead of the not-found page.
const RUNTIME_CONFIG = '__PUBKY_CONFIG__=Object.freeze(';
const ERROR_SCREEN = 'Something went wrong';
const CLOSED = 'http://127.0.0.1:9';
const UNAVAILABLE_COPY = 'This shop is temporarily unavailable';
const CLAIM_CODE = '7K3Q-9M2X-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF';
const CLAIM_CODE_KEY = 'shop:store-claim-code:v1';

const STORE_ENV = {
  PUBKY_RUNTIME_ENV: 'staging',
  PUBKY_RUNTIME_TESTNET: 'false',
  PUBKY_RUNTIME_HOMESERVER: 'ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy',
  PUBKY_RUNTIME_HOMESERVER_URL: 'https://homeserver.staging.pubky.app',
  PUBKY_RUNTIME_NEXUS_URL: CLOSED,
  PUBKY_RUNTIME_CDN_URL: `${CLOSED}/static`,
  PUBKY_RUNTIME_MARKETPLACE_URL: CLOSED,
  PUBKY_RUNTIME_MARKETPLACE_NEXUS_URL: CLOSED,
  PUBKY_RUNTIME_HOMEGATE_URL: 'https://homegate.staging.pubky.app',
  PUBKY_RUNTIME_PKARR_RELAYS: '["https://pkarr.pubky.app","https://pkarr.pubky.org"]',
  PUBKY_RUNTIME_DEFAULT_HTTP_RELAY: 'https://httprelay.staging.pubky.app/inbox',
  PUBKY_RUNTIME_EXCHANGE_RATE_API: 'https://api1.blocktank.to/api/fx/rates/btc',
  PUBKY_RUNTIME_STORE_SELLER: STORE_SELLER,
};

const CLAIM_ENV = {
  ...STORE_ENV,
  MARKETPLACE_SERVICE_URL: STUB_ORIGIN,
  PUBKY_RUNTIME_MARKETPLACE_URL: 'https://127.0.0.1:9',
  PUBKY_RUNTIME_MARKETPLACE_GRANT_SESSION_ENABLED: 'true',
  PUBKY_RUNTIME_STORE_MODE: 'single_seller',
  PUBKY_RUNTIME_STORE_SELLER: '',
};

const MASKED = [
  '/zzz-no-such-page',
  '/hot',
  '/search',
  '/marketplace/drops',
  `/marketplace/shop/${OTHER_SELLER}`,
  `/profile/${STORE_SELLER}`,
  '/llms.txt',
  '/a.b',
  '/robots.txt',
  '/hot.txt',
  '/api',
  '/social-handoff/profile/alice',
  '/api/report',
  '/api/sentry-test',
  '/api/no-such-handler',
];

// The route guard sends a guest away from paths it does not know, so only pages it lets a guest stay on show the
// not-found screen in a browser.
const MASKED_IN_BROWSER = ['/hot', '/marketplace/drops', `/marketplace/shop/${OTHER_SELLER}`];

// Files a store serves by name, and the Market preview image its cart and orders pages point at.
const KEPT_FILES = ['/pubky-logo.svg', '/manifest.json', '/favicon.ico', '/sw.js', '/marketplace/opengraph-image'];

const results = [];
function check(id, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? ` — ${detail}` : ''}`);
}

async function get(path, headers = {}) {
  const response = await fetch(`${ORIGIN}${BASE_PATH}${path}`, {
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(60_000),
  });
  return {
    status: response.status,
    location: response.headers.get('location'),
    headers: response.headers,
    body: await response.text(),
  };
}

async function checkInBrowser() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const path of MASKED_IN_BROWSER) {
      const response = await page.goto(`${ORIGIN}${BASE_PATH}${path}`, { waitUntil: 'load', timeout: 60_000 });
      await page
        .getByText(new RegExp(`${NOT_FOUND_COPY}|${ERROR_SCREEN}`))
        .first()
        .waitFor({ timeout: 30_000 })
        .catch(() => {});
      await page.waitForTimeout(2_000);
      const text = await page.innerText('body');
      const at = new URL(page.url()).pathname;
      const shown = text.includes(ERROR_SCREEN)
        ? 'the error screen'
        : text.includes(NOT_FOUND_COPY)
          ? 'the not-found page'
          : 'neither screen';
      check(
        `browser ${path}`,
        response?.status() === 404 && shown === 'the not-found page' && at === `${BASE_PATH}${path}`,
        `status ${response?.status()}, shows ${shown} at ${at}`,
      );
    }
  } finally {
    await browser.close();
  }
}

async function waitForServer(server) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`next start exited with code ${server.exitCode}`);
    try {
      const response = await fetch(`${ORIGIN}${BASE_PATH}/api/build`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok || response.status === 503) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`next start did not answer ${ORIGIN}${BASE_PATH}/api/build within 120s`);
}

if (!existsSync(join(ROOT, '.next', 'BUILD_ID'))) {
  console.error('No production build in .next; run `npm run build` first. This check never builds.');
  process.exit(1);
}

const output = [];
const runCounts = [];

async function stopServer(server) {
  if (server.exitCode !== null || server.signalCode !== null) return;
  const exited = new Promise((resolve) => server.once('exit', resolve));
  server.kill('SIGTERM');
  await exited;
}

async function withNext(env, failureId, run) {
  const server = spawn(process.execPath, [join(ROOT, 'node_modules/next/dist/bin/next'), 'start', '-p', String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, ...env, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => output.push(chunk));
  server.stderr.on('data', (chunk) => output.push(chunk));
  try {
    await waitForServer(server);
    await run();
  } catch (error) {
    check(failureId, false, error instanceof Error ? error.message : String(error));
  } finally {
    await stopServer(server);
  }
}

async function measuredRun(name, run) {
  const first = results.length;
  await run();
  const own = results.slice(first);
  const passed = own.filter(Boolean).length;
  runCounts.push(`${name} ${passed}/${own.length}`);
}

async function checkNotFound(id, path) {
  const { status, body } = await get(path);
  const page = body.includes(NOT_FOUND_TITLE) && body.includes(NOT_FOUND_COPY);
  const config = body.includes(RUNTIME_CONFIG);
  const problems = [!page && 'not the not-found page', !config && 'no runtime config'].filter(Boolean);
  check(id, status === 404 && page && config, [`status ${status}`, ...problems].join(', '));
}

async function checkClaimStaticFiles(run) {
  for (const path of ['/pubky-logo.svg', '/manifest.json', '/favicon.ico', '/sw.js']) {
    const { status } = await get(path);
    check(`${run} static ${path}`, status === 200, `status ${status}`);
  }
}

async function checkPinnedStore() {
  await withNext(STORE_ENV, 'served store build', async () => {
    for (const path of MASKED) {
      const { status, body } = await get(path);
      const page = body.includes(NOT_FOUND_TITLE) && body.includes(NOT_FOUND_COPY);
      const config = body.includes(RUNTIME_CONFIG);
      const problems = [!page && 'not the not-found page', !config && 'no runtime config'].filter(Boolean);
      check(`masked ${path}`, status === 404 && page && config, [`status ${status}`, ...problems].join(', '));
    }

    for (const path of KEPT_FILES) {
      const { status } = await get(path);
      check(`kept ${path}`, status === 200, `status ${status}`);
    }

    const build = await get('/api/build');
    check('kept /api/build', build.status === 200, `status ${build.status}`);

    const health = await get('/api/marketplace/health');
    check('kept /api/marketplace/health', health.body.includes('pubky-shop-bff'), `status ${health.status}`);

    // The handler refuses a missing creator before any Paykit read, so this needs no Paykit Server.
    const paykitCreator = await get('/api/paykit-creator', { 'Sec-Fetch-Site': 'same-origin' });
    check(
      'kept /api/paykit-creator',
      paykitCreator.status === 400 && paykitCreator.body.includes('Invalid creator'),
      `status ${paykitCreator.status}`,
    );

    const home = await get('/marketplace');
    const shop = `/marketplace/shop/${STORE_SELLER}`;
    check(
      'store home opens the store seller shop',
      home.status === 307 && new URL(home.location ?? '', ORIGIN).pathname === `${BASE_PATH}${shop}`,
      `status ${home.status}, location ${home.location}`,
    );

    await checkInBrowser();
  });
}

async function checkUnclaimed() {
  await withNext(CLAIM_ENV, 'served unclaimed build', async () => {
    const home = await get('/');
    const homeProblems = [
      home.status !== 200 && `status ${home.status}`,
      !home.body.includes('<title>This shop is being set up</title>') && 'wrong title',
      home.headers.get('x-robots-tag') !== 'noindex' && 'wrong robots header',
      /<(?:header|nav)\b/.test(home.body) && 'global chrome present',
      !home.body.includes(`href="${BASE_PATH}/setup"`) && 'wrong setup link',
      !home.body.includes('Merchant setup') && 'no setup action',
    ].filter(Boolean);
    check('unclaimed / holding page', homeProblems.length === 0, homeProblems.join(', ') || 'status 200');
    const setup = await get('/setup');
    check(
      'unclaimed /setup code intake',
      setup.status === 200 &&
        setup.headers.get('referrer-policy') === 'no-referrer' &&
        setup.body.includes('id="store-claim-code-intake"') &&
        setup.body.includes('window.sessionStorage.setItem') &&
        setup.body.includes('window.history.replaceState'),
      `status ${setup.status}, referrer ${setup.headers.get('referrer-policy')}`,
    );

    const state = await get('/api/marketplace/store');
    const stateBody = JSON.parse(state.body);
    check(
      'unclaimed store state handler',
      state.status === 200 &&
        stateBody.kind === 'unclaimed' &&
        stateBody.seller === null &&
        stateBody.source === null &&
        state.headers.get('cache-control') === 'no-store',
      `status ${state.status}, body ${state.body}, cache ${state.headers.get('cache-control')}`,
    );

    for (const path of [
      '/marketplace',
      '/cart',
      '/checkout',
      '/marketplace/dashboard',
      '/marketplace/sell',
      `/marketplace/shop/${OTHER_SELLER}`,
      '/messages',
    ]) {
      await checkNotFound(`unclaimed masked ${path}`, path);
    }

    const build = await get('/api/build');
    check('unclaimed /api/build', build.status === 200, `status ${build.status}`);
    const health = await get('/api/marketplace/health');
    check('unclaimed /api/marketplace/health', health.body.includes('pubky-shop-bff'), `status ${health.status}`);
    await checkClaimStaticFiles('unclaimed');

    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const response = await page.goto(`${ORIGIN}${BASE_PATH}/setup#claim=${CLAIM_CODE}`, {
        waitUntil: 'load',
        timeout: 60_000,
      });
      await page.waitForTimeout(2_000);
      const stored = await page.evaluate((key) => window.sessionStorage.getItem(key), CLAIM_CODE_KEY);
      const text = await page.innerText('body');
      check(
        'browser unclaimed /setup claim fragment',
        response?.status() === 200 &&
          !page.url().includes('#') &&
          stored === CLAIM_CODE &&
          !text.includes(ERROR_SCREEN),
        `status ${response?.status()}, url ${page.url()}, code ${stored === CLAIM_CODE ? 'stored' : 'missing'}, error ${text.includes(ERROR_SCREEN)}`,
      );
    } finally {
      await browser.close();
    }
  });
}

async function checkClaimed() {
  await withNext(CLAIM_ENV, 'served claimed build', async () => {
    const shop = `/marketplace/shop/${STORE_SELLER}`;
    for (const path of ['/', '/marketplace']) {
      const home = await get(path);
      check(
        `claimed ${path} shop redirect`,
        home.status === 307 && new URL(home.location ?? '', ORIGIN).pathname === `${BASE_PATH}${shop}`,
        `status ${home.status}, location ${home.location}`,
      );
    }
    await checkNotFound('claimed other seller shop', `/marketplace/shop/${OTHER_SELLER}`);

    const setup = await get('/setup');
    const groupedSeller = STORE_SELLER.match(/.{1,4}/g)?.join(' ');
    check(
      'claimed /setup summary',
      setup.status === 200 &&
        setup.body.includes('This shop was claimed by') &&
        groupedSeller !== undefined &&
        setup.body.includes(groupedSeller),
      `status ${setup.status}, claimed copy ${setup.body.includes('This shop was claimed by')}, seller ${setup.body.includes(groupedSeller ?? '')}`,
    );
    const state = await get('/api/marketplace/store');
    const stateBody = JSON.parse(state.body);
    check(
      'claimed store state handler',
      state.status === 200 &&
        stateBody.kind === 'claimed' &&
        stateBody.seller === STORE_SELLER &&
        stateBody.source === 'claim' &&
        state.headers.get('cache-control') === 'no-store',
      `status ${state.status}, body ${state.body}`,
    );

    const hitsBefore = stubHits;
    const fresh = await get('/api/marketplace/store?fresh=1');
    const hitsAfter = stubHits;
    check(
      'claimed fresh state stays cached',
      fresh.status === 200 && JSON.parse(fresh.body).seller === STORE_SELLER && hitsAfter === hitsBefore,
      `status ${fresh.status}, upstream hits ${hitsBefore} then ${hitsAfter}`,
    );
  });
}

async function checkUnavailable(run, answer) {
  stubAnswer = answer;
  await withNext(CLAIM_ENV, `served ${run} build`, async () => {
    for (const path of ['/', '/marketplace']) {
      const page = await get(path);
      check(
        `${run} ${path} unavailable page`,
        page.status === 503 &&
          page.body.includes(UNAVAILABLE_COPY) &&
          !page.body.includes(NOT_FOUND_COPY) &&
          !page.body.includes(ERROR_SCREEN),
        `status ${page.status}, unavailable ${page.body.includes(UNAVAILABLE_COPY)}, error ${page.body.includes(ERROR_SCREEN)}`,
      );
    }

    const api = await get('/api/marketplace/session');
    check(
      `${run} unavailable API`,
      api.status === 503 &&
        api.headers.get('cache-control') === 'no-store' &&
        JSON.parse(api.body).error === 'STORE_UNAVAILABLE',
      `status ${api.status}, cache ${api.headers.get('cache-control')}, body ${api.body}`,
    );
    await checkClaimStaticFiles(run);

    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const response = await page.goto(`${ORIGIN}${BASE_PATH}/`, { waitUntil: 'load', timeout: 60_000 });
      await page.waitForTimeout(1_000);
      const text = await page.innerText('body');
      check(
        `browser ${run} / unavailable page`,
        response?.status() === 503 &&
          text.includes(UNAVAILABLE_COPY) &&
          !text.includes(NOT_FOUND_COPY) &&
          !text.includes(ERROR_SCREEN),
        `status ${response?.status()}, unavailable ${text.includes(UNAVAILABLE_COPY)}, not-found ${text.includes(NOT_FOUND_COPY)}, error ${text.includes(ERROR_SCREEN)}`,
      );
    } finally {
      await browser.close();
    }
  });
}

let stubHits = 0;
let stubAnswer = {
  status: 200,
  cacheControl: 'no-store',
  body: { mode: 'single_seller', state: 'unclaimed', seller: null },
};
const stub = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/v1/store') {
    stubHits += 1;
    response.writeHead(stubAnswer.status, {
      'Content-Type': 'application/json',
      'Cache-Control': stubAnswer.cacheControl,
    });
    response.end(JSON.stringify(stubAnswer.body));
    return;
  }
  response.writeHead(404, { 'Cache-Control': 'no-store' });
  response.end();
});

try {
  await new Promise((resolve, reject) => {
    stub.once('error', reject);
    stub.listen(STUB_PORT, '127.0.0.1', resolve);
  });
  await measuredRun('pinned', checkPinnedStore);
  await measuredRun('unclaimed', checkUnclaimed);
  stubAnswer = {
    status: 200,
    cacheControl: 'public, max-age=30',
    body: { mode: 'single_seller', state: 'claimed', seller: STORE_SELLER },
  };
  await measuredRun('claimed', checkClaimed);
  await measuredRun('unavailable', () =>
    checkUnavailable('unavailable', {
      status: 503,
      cacheControl: 'no-store',
      body: { error: 'STORE_UNAVAILABLE' },
    }),
  );
  await measuredRun('contradictory', () =>
    checkUnavailable('contradictory', {
      status: 200,
      cacheControl: 'no-store',
      body: { mode: 'single_seller', state: 'claimed', seller: null },
    }),
  );
} catch (error) {
  check('store check harness', false, error instanceof Error ? error.message : String(error));
} finally {
  await new Promise((resolve) => stub.close(resolve));
}

console.log(`Run checks: ${runCounts.join(', ')}`);
if (results.includes(false)) {
  console.log(Buffer.concat(output).toString().slice(-4_000));
  process.exit(1);
}
console.log(`All ${results.length} store-mode served checks passed.`);
