#!/usr/bin/env node
// What a production build serves in store mode (`PUBKY_RUNTIME_STORE_SELLER`), checked with plain HTTP and Chromium.
//
// The proxy answers a path a store does not serve by rewriting it to `/_not-found`, the route Next.js builds from
// `src/app/not-found.tsx` (see `STORE_NOT_FOUND_PATHNAME` in `src/app/store-route-policy.ts`). A rewrite's own status
// is not what a visitor gets, and rewriting to any other path lets the `(feeds)` `@post` catch-all answer with 200 or
// a broken screen, so this check pins the behaviour a Next.js upgrade could change: a masked page or route handler
// answers 404 with the app's not-found page, while kept routes still answer. A page can arrive with the right status
// and markup and still hydrate into an error screen, so Chromium opens the masked pages that a guest stays on.
//
// Reuses an existing build (`npm run build`); it never builds. Starts `next start` on STORE_CHECK_PORT (default 3100)
// with store mode on and every Pubky and marketplace URL pointed at a closed loopback port, so nothing reads live data.
// Needs Playwright's Chromium (`npx playwright install chromium`). Exit 0 only when every check passed.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PORT = Number(process.env.STORE_CHECK_PORT ?? 3100);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const STORE_SELLER = 'ybndrfg8ejkmcpqxot1uwisza345h769ybndrfg8ejkmcpqxot1u';
const OTHER_SELLER = 'o'.repeat(52);
const NOT_FOUND_TITLE = '<title>Page Not Found - Pubky Market</title>';
const NOT_FOUND_COPY = 'Could not find requested resource';
// Without it the page hydrates into an error screen instead of the not-found page.
const RUNTIME_CONFIG = '__PUBKY_CONFIG__=Object.freeze(';
const ERROR_SCREEN = 'Something went wrong';
const CLOSED = 'http://127.0.0.1:9';

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

const MASKED = [
  '/zzz-no-such-page',
  '/hot',
  '/search',
  '/marketplace/drops',
  `/marketplace/shop/${OTHER_SELLER}`,
  `/profile/${STORE_SELLER}`,
  '/llms.txt',
  '/api',
  '/api/feedback',
  '/api/report',
  '/api/sentry-test',
  '/api/og-metadata',
  '/api/no-such-handler',
];

// The route guard sends a guest away from paths it does not know, so only pages it lets a guest stay on show the
// not-found screen in a browser.
const MASKED_IN_BROWSER = ['/hot', '/marketplace/drops', `/marketplace/shop/${OTHER_SELLER}`];

const results = [];
function check(id, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? ` — ${detail}` : ''}`);
}

async function get(path) {
  const response = await fetch(`${ORIGIN}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(60_000) });
  return { status: response.status, location: response.headers.get('location'), body: await response.text() };
}

async function checkInBrowser() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const path of MASKED_IN_BROWSER) {
      const response = await page.goto(`${ORIGIN}${path}`, { waitUntil: 'load', timeout: 60_000 });
      await page
        .getByText(new RegExp(`${NOT_FOUND_COPY}|${ERROR_SCREEN}`))
        .first()
        .waitFor({ timeout: 30_000 })
        .catch(() => {});
      await page.waitForTimeout(2_000);
      const text = await page.innerText('body');
      const shown = text.includes(ERROR_SCREEN)
        ? 'the error screen'
        : text.includes(NOT_FOUND_COPY)
          ? 'the not-found page'
          : 'neither screen';
      check(
        `browser ${path}`,
        response?.status() === 404 && shown === 'the not-found page' && new URL(page.url()).pathname === path,
        `status ${response?.status()}, shows ${shown} at ${new URL(page.url()).pathname}`,
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
      if ((await fetch(`${ORIGIN}/api/build`, { signal: AbortSignal.timeout(2_000) })).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`next start did not answer ${ORIGIN}/api/build within 120s`);
}

if (!existsSync(join(ROOT, '.next', 'BUILD_ID'))) {
  console.error('No production build in .next; run `npm run build` first. This check never builds.');
  process.exit(1);
}

const output = [];
const server = spawn(process.execPath, [join(ROOT, 'node_modules/next/dist/bin/next'), 'start', '-p', String(PORT)], {
  cwd: ROOT,
  env: { ...process.env, ...STORE_ENV, NODE_ENV: 'production' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (chunk) => output.push(chunk));
server.stderr.on('data', (chunk) => output.push(chunk));

try {
  await waitForServer(server);

  for (const path of MASKED) {
    const { status, body } = await get(path);
    const page = body.includes(NOT_FOUND_TITLE) && body.includes(NOT_FOUND_COPY);
    const config = body.includes(RUNTIME_CONFIG);
    const problems = [!page && 'not the not-found page', !config && 'no runtime config'].filter(Boolean);
    check(`masked ${path}`, status === 404 && page && config, [`status ${status}`, ...problems].join(', '));
  }

  const build = await get('/api/build');
  check('kept /api/build', build.status === 200, `status ${build.status}`);

  const health = await get('/api/marketplace/health');
  check('kept /api/marketplace/health', health.body.includes('pubky-shop-bff'), `status ${health.status}`);

  const home = await get('/marketplace');
  const shop = `/marketplace/shop/${STORE_SELLER}`;
  check(
    'store home opens the store seller shop',
    home.status === 307 && new URL(home.location ?? '', ORIGIN).pathname === shop,
    `status ${home.status}, location ${home.location}`,
  );

  await checkInBrowser();
} catch (error) {
  check('served store build', false, error instanceof Error ? error.message : String(error));
} finally {
  server.kill('SIGTERM');
}

if (results.includes(false)) {
  console.log(Buffer.concat(output).toString().slice(-4_000));
  process.exit(1);
}
console.log(`All ${results.length} store-mode served checks passed.`);
