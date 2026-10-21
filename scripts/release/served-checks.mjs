#!/usr/bin/env node
// What a deployed Shop serves, checked from the outside with plain HTTP (no seats, no browser, read-only).
//
//   1. deployment: the page names the Vercel deployment id EXPECTED_DPL, and/or `GET /api/build` reports the commit
//      EXPECTED_COMMIT (at least one of the two is required; both are checked when both are set).
//   2. wasm-referenced: the Locks SDK wasm is named in a chunk. It is a lazy chunk, so the check reads the webpack
//      runtime's chunk map and crawls every chunk (see served-checks-lib.mjs).
//   3. wasm-served: that wasm answers 200 `application/wasm` and is byte-identical to the SDK this checkout pins.
//   4. usdt-config: the served runtime config has `usdtPaymentsEnabled: false`.
//   5. service-health: the marketplace service the config names answers /health without `usdt_payments`.
//
// There is no build-meta or `/version.json` check, on purpose: the Shop publishes neither (#184), so identity is check 1
// (the deployment id or the `/api/build` commit) and the git tag. Do not add one back.
//
// Env: PROOF_ORIGIN (required; with the Shop's mount path when it is mounted, e.g. https://pubky.app/shop-embed), EXPECTED_DPL or EXPECTED_COMMIT, LOCKS_WASM_SHA256 (default: the wasm in this
// checkout's node_modules), SERVICE_URL (default: the marketplaceUrl in the served config), SERVED_CHECKS_USDT=on to expect USDT on.
// Exit 0 only when every check passed.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { servedDeployment } from './deployment-check.mjs';
import { proofTarget, REPO_ROOT } from './seats.mjs';
import {
  assetRoot,
  chunkPathsFromRuntime,
  locksWasmPaths,
  runtimeSource,
  scriptSources,
} from './served-checks-lib.mjs';

const target = proofTarget();
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const results = [];
function check(id, ok, detail) {
  results.push({ id, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? ` — ${detail}` : ''}`);
}

async function get(url) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  return {
    status: response.status,
    type: response.headers.get('content-type') ?? '',
    body: Buffer.from(await response.arrayBuffer()),
  };
}

function runtimeConfig(html) {
  const start = html.indexOf('__PUBKY_CONFIG__=Object.freeze(');
  if (start < 0) return null;
  const open = html.indexOf('{', start);
  let depth = 0;
  let quoted = false;
  for (let i = open; i < html.length; i += 1) {
    const c = html[i];
    if (quoted) {
      if (c === '\\') i += 1;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '{') depth += 1;
    else if (c === '}' && --depth === 0) return JSON.parse(html.slice(open, i + 1));
  }
  return null;
}

function expectedWasmSha() {
  if (process.env.LOCKS_WASM_SHA256) return process.env.LOCKS_WASM_SHA256.toLowerCase();
  const file = join(REPO_ROOT, 'node_modules/@synonymdev/locks-sdk/pkg/locks_sdk_wasm_bg.wasm');
  return existsSync(file) ? sha256(readFileSync(file)) : null;
}

const pageUrl = target.at('/marketplace');
const page = await get(pageUrl);
const html = page.body.toString('utf8');
if (page.status !== 200 || !page.type.includes('text/html')) {
  check('page', false, `${pageUrl} answered ${page.status} ${page.type}`);
  process.exit(1);
}

const deployment = await servedDeployment({ pageUrl, buildUrl: target.at('/api/build') });
check('deployment', !deployment.refusal, deployment.refusal ?? deployment.found);

const sources = scriptSources(html);
const root = assetRoot(sources);
const runtimeSrc = runtimeSource(sources);
let wasmPath = null;
let crawled = 0;
if (root && runtimeSrc) {
  const absolute = (src) => new URL(src, pageUrl).href;
  const runtime = (await get(absolute(runtimeSrc))).body.toString('utf8');
  const chunkUrls = new Set([
    ...sources.map(absolute),
    ...chunkPathsFromRuntime(runtime).map((path) => new URL(path, new URL(root, pageUrl)).href),
  ]);
  const queue = [...chunkUrls];
  const workers = Array.from({ length: 8 }, async () => {
    while (queue.length && !wasmPath) {
      const url = queue.pop();
      const chunk = await get(url).catch(() => null);
      if (!chunk || chunk.status !== 200) continue;
      crawled += 1;
      wasmPath = locksWasmPaths(chunk.body.toString('utf8'))[0] ?? wasmPath;
    }
  });
  await Promise.all(workers);
  check(
    'wasm-referenced',
    Boolean(wasmPath),
    wasmPath
      ? `${wasmPath} (found after reading ${crawled} of ${chunkUrls.size} chunks)`
      : `no chunk of ${chunkUrls.size} names the Locks wasm`,
  );
} else {
  check('wasm-referenced', false, 'the page lists no webpack runtime script');
}

if (wasmPath) {
  const wasm = await get(new URL(wasmPath, new URL(root, pageUrl)).href);
  const expected = expectedWasmSha();
  const actual = sha256(wasm.body);
  check(
    'wasm-served',
    wasm.status === 200 && wasm.type.includes('application/wasm') && (expected ? actual === expected : true),
    `${wasm.status} ${wasm.type}, ${wasm.body.length} B, sha256 ${actual.slice(0, 8)}…${expected ? (actual === expected ? ' = the pinned SDK' : ` (pinned SDK ${expected.slice(0, 8)}…)`) : ' (no pinned SDK to compare; set LOCKS_WASM_SHA256)'}`,
  );
} else {
  check('wasm-served', false, 'no wasm path to fetch');
}

const config = runtimeConfig(html);
const usdtExpected = process.env.SERVED_CHECKS_USDT === 'on';
check(
  'usdt-config',
  Boolean(config) && config.usdtPaymentsEnabled === usdtExpected,
  `usdtPaymentsEnabled=${config?.usdtPaymentsEnabled ?? 'no runtime config'}`,
);

const service = (process.env.SERVICE_URL ?? config?.marketplaceUrl ?? '').replace(/\/+$/, '');
if (service) {
  const health = await get(`${service}/health`).catch(() => null);
  const body = health ? JSON.parse(health.body.toString('utf8') || '{}') : {};
  check(
    'service-health',
    health?.status === 200 && 'usdt_payments' in body === usdtExpected,
    `${service}/health ${health?.status ?? 'unreachable'}, usdt_payments ${'usdt_payments' in body ? 'present' : 'absent'}`,
  );
} else {
  check('service-health', false, 'no marketplace service URL in the served config; set SERVICE_URL');
}

const failed = results.filter((row) => !row.ok).length;
console.log(`RESULT ${failed === 0 ? 'PASS' : 'FAIL'} ${results.length - failed}/${results.length}`);
process.exit(failed === 0 ? 0 : 1);
