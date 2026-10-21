// @vitest-environment node
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { maskedScreenshot } from './digital-proof.mjs';

const run = promisify(execFile);
const SCRIPT = join(__dirname, 'production-digital-fixture.mjs');

// A throwaway seat: secret 0x01 x32 and its public key.
const SEAT_HEX = '01'.repeat(32);
const SEAT_PREFIX = 'tkrq8zmw';

const today = () => `GO-${new Date().toISOString().slice(0, 10)}`;

type Outcome = { code: number; stdout: string; stderr: string };

async function runScript(mode: string, env: Record<string, string>): Promise<Outcome> {
  try {
    const { stdout, stderr } = await run(process.execPath, [SCRIPT, mode], {
      env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
      encoding: 'utf8',
      timeout: 60_000,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

describe('production-digital-fixture.mjs target guard', () => {
  let evidence: string;
  beforeEach(() => {
    evidence = mkdtempSync(join(tmpdir(), 'digital-fixture-guard-'));
  });
  afterEach(() => rmSync(evidence, { recursive: true, force: true }));

  const hold = () => ({
    PROOF_EXTERNAL_BUYER: '1',
    PROOF_DIGITAL_GO: today(),
    EXPECTED_DPL: 'dpl_expected',
    PROOF_SEAT_SECRET_HEX: SEAT_HEX,
    PROOF_SELLER_PREFIX: SEAT_PREFIX,
    PROOF_EVIDENCE: evidence,
  });

  const stagingList = {
    PROOF_STAGING_ORIGINS: 'https://staging.shop.example.test',
    PROOF_STAGING_SERVICES: 'https://api.staging.shop.example.test',
    PROOF_STAGING_NEXUS: 'https://nexus.staging.shop.example.test',
  };
  const stagingStack = {
    PROOF_ORIGIN: 'https://staging.shop.example.test',
    PROOF_SERVICE: 'https://api.staging.shop.example.test',
    PROOF_NEXUS: 'https://nexus.staging.shop.example.test',
  };

  it('refuses the hold-smoke publish with no target configured before touching anything', async () => {
    const outcome = await runScript('publish', hold());
    expect(outcome.code).not.toBe(0);
    expect(outcome.stderr).toContain('set PROOF_ORIGIN, PROOF_SERVICE, PROOF_NEXUS');
    expect(existsSync(join(evidence, 'digital-fixture-publish.json'))).toBe(false);
  });

  it('refuses a target that is not the configured staging stack, naming what is wrong', async () => {
    const outcome = await runScript('publish', {
      ...hold(),
      ...stagingList,
      PROOF_ORIGIN: 'https://shop.example.test',
      PROOF_SERVICE: 'https://api.shop.example.test',
      PROOF_NEXUS: 'https://nexus.shop.example.test',
    });
    expect(outcome.code).not.toBe(0);
    expect(outcome.stderr).toContain('is not the staging stack');
    expect(outcome.stderr).toContain('PROOF_ORIGIN=https://shop.example.test');
    expect(outcome.stderr).toContain('PROOF_SERVICE=');
    expect(outcome.stderr).toContain('PROOF_NEXUS=');
    expect(existsSync(join(evidence, 'digital-fixture-publish.json'))).toBe(false);
  });

  it('refuses a staging target when no staging stack is configured', async () => {
    const outcome = await runScript('publish', { ...hold(), ...stagingStack });
    expect(outcome.code).not.toBe(0);
    expect(outcome.stderr).toContain('is not the staging stack');
  });

  it('refuses every mode but plan on a half-staging stack, naming only what is wrong', async () => {
    const env = {
      ...hold(),
      ...stagingList,
      ...stagingStack,
      PROOF_SERVICE: 'https://api.shop.example.test',
    };
    for (const mode of ['prepare', 'publish', 'await-buyer', 'teardown', 'verify']) {
      const outcome = await runScript(mode, env);
      expect(outcome.code, mode).not.toBe(0);
      expect(outcome.stderr, mode).toContain('PROOF_SERVICE=');
      expect(outcome.stderr, mode).not.toContain('PROOF_ORIGIN=');
    }
  });

  it('plan runs anywhere, touches nothing and says which side it is on', async () => {
    const unconfigured = await runScript('plan', { PROOF_EVIDENCE: evidence });
    expect(unconfigured.code).toBe(0);
    expect(unconfigured.stdout).toContain('target: not configured');

    const prod = await runScript('plan', {
      PROOF_EVIDENCE: evidence,
      ...stagingList,
      PROOF_ORIGIN: 'https://shop.example.test',
      PROOF_SERVICE: 'https://api.shop.example.test',
      PROOF_NEXUS: 'https://nexus.shop.example.test',
    });
    expect(prod.code).toBe(0);
    expect(prod.stdout).toContain('NOT the staging stack');

    const stage = await runScript('plan', { PROOF_EVIDENCE: evidence, ...stagingList, ...stagingStack });
    expect(stage.code).toBe(0);
    expect(stage.stdout).toContain('target: the staging stack');
  });
});

describe('production-digital-fixture.mjs expected deployment on publish', () => {
  let server: Server;
  let origin: string;
  let served = 'dpl_other';
  let servedCommit = 'abcdef012345';
  let evidence: string;

  beforeEach(async () => {
    evidence = mkdtempSync(join(tmpdir(), 'digital-fixture-dpl-'));
    served = 'dpl_other';
    servedCommit = 'abcdef012345';
    server = createServer((request, response) => {
      response.setHeader('content-type', 'text/html');
      if (request.url === '/api/build') {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ commit: servedCommit }));
        return;
      }
      response.end(request.url === '/marketplace' ? `<html><script>window.d="${served}"</script></html>` : '');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(evidence, { recursive: true, force: true });
  });

  // The local origin is not staging, so these runs use the explicit production override: the point under test is
  // the deployment check, which must hold for the external-buyer publish path hold-smoke uses.
  const publishEnv = () => ({
    PROOF_ALLOW_PRODUCTION: '1',
    PROOF_ORIGIN: origin,
    PROOF_SERVICE: origin,
    PROOF_NEXUS: origin,
    PROOF_EXTERNAL_BUYER: '1',
    PROOF_DIGITAL_GO: today(),
    EXPECTED_DPL: 'dpl_expected',
    PROOF_SEAT_SECRET_HEX: SEAT_HEX,
    PROOF_SELLER_PREFIX: SEAT_PREFIX,
    PROOF_EVIDENCE: evidence,
  });

  const detail = (mode: string) =>
    (JSON.parse(readFileSync(join(evidence, `digital-fixture-${mode}.json`), 'utf8')).checks as { detail: string }[])
      .map((row) => row.detail)
      .join('\n');

  it('refuses to publish when the origin serves another deployment', async () => {
    const outcome = await runScript('publish', publishEnv());
    expect(outcome.code).toBe(1);
    expect(detail('publish')).toContain('is serving dpl_other, not EXPECTED_DPL dpl_expected');
    expect(outcome.stdout).not.toContain('the origin is serving the expected deployment');
  });

  it('gets past the check when the origin serves the expected deployment, and fails only on the missing state', async () => {
    served = 'dpl_expected';
    const outcome = await runScript('publish', publishEnv());
    expect(outcome.code).toBe(1);
    expect(outcome.stdout).toContain('the origin is serving the expected deployment dpl_expected');
    expect(detail('publish')).toContain('no prepared state file; run prepare first');
  });

  it('accepts a commit-only expectation that matches what /api/build reports', async () => {
    const outcome = await runScript('publish', { ...publishEnv(), EXPECTED_DPL: '', EXPECTED_COMMIT: 'abcdef0' });
    expect(outcome.code).toBe(1);
    expect(outcome.stdout).toContain('the origin is serving the expected deployment abcdef012345');
    expect(detail('publish')).toContain('no prepared state file; run prepare first');
  });

  it('refuses a commit-only expectation that does not match', async () => {
    const outcome = await runScript('publish', { ...publishEnv(), EXPECTED_DPL: '', EXPECTED_COMMIT: '1234567' });
    expect(outcome.code).toBe(1);
    expect(detail('publish')).toContain('reports abcdef012345 at /api/build, not EXPECTED_COMMIT 1234567');
  });

  it('refuses a publish with neither EXPECTED_DPL nor EXPECTED_COMMIT', async () => {
    const outcome = await runScript('publish', { ...publishEnv(), EXPECTED_DPL: '', EXPECTED_COMMIT: '' });
    expect(outcome.code).not.toBe(0);
    expect(outcome.stderr).toContain('EXPECTED_DPL');
    expect(outcome.stderr).toContain('EXPECTED_COMMIT');
  });
});

// Needs the Chromium that `npx playwright install chromium` fetches. The unit CI job installs no browsers, so there
// this block is reported as skipped; it runs wherever Chromium is present.
const hasChromium = existsSync(chromium.executablePath());

describe.skipIf(!hasChromium)('maskedScreenshot in a real browser', () => {
  let shots: string;
  beforeEach(() => {
    shots = mkdtempSync(join(tmpdir(), 'digital-mask-'));
  });
  afterEach(() => rmSync(shots, { recursive: true, force: true }));
  const MAGENTA = 'magenta pixels';
  const email = 'tester@example.com';
  const page = (body: string) =>
    `<html><body style="margin:0;background:#fff;font:20px sans-serif">${body}</body></html>`;

  async function withPage<T>(html: string, body: (page: import('playwright').Page) => Promise<T>) {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 600, height: 300 } });
      const tab = await context.newPage();
      await tab.setContent(html);
      return await body(tab);
    } finally {
      await browser.close();
    }
  }

  // Counts pure #FF00FF pixels, the colour Playwright paints masks with.
  const countMask = (tab: import('playwright').Page, png: Buffer) =>
    tab.evaluate(async (base64) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      let count = 0;
      for (let i = 0; i < data.length; i += 4)
        if (data[i] === 255 && data[i + 1] === 0 && data[i + 2] === 255) count += 1;
      return count;
    }, png.toString('base64'));

  const withMailbox = page(
    `<p>The seller will email this to ${email}</p><input id="a" value="TESTER@Example.com" size="30"><textarea id="b">hello ${email}</textarea><p>plain line</p>`,
  );
  const withoutMailbox = page(
    '<p>The seller will email this to someone</p><input id="a" value="other" size="30"><p>plain line</p>',
  );

  it(`paints ${MAGENTA} over the mailbox in text and in field values, and leaves no tag behind`, async () => {
    await withPage(withMailbox, async (tab) => {
      const unmasked = await maskedScreenshot(tab, { path: join(shots, 'shot.png'), email: '' });
      expect(await countMask(tab, unmasked)).toBe(0);
      const masked = await maskedScreenshot(tab, { path: join(shots, 'shot.png'), email });
      expect(await countMask(tab, masked)).toBeGreaterThan(2000);
      expect(await tab.locator('[data-proof-mask]').count()).toBe(0);
    });
  });

  it('masks a page element screenshot the same way', async () => {
    await withPage(withMailbox, async (tab) => {
      const masked = await maskedScreenshot(tab.locator('p').first(), { path: join(shots, 'shot.png'), email });
      expect(await countMask(tab, masked)).toBeGreaterThan(500);
    });
  });

  it('paints nothing on a page that does not show the mailbox', async () => {
    await withPage(withoutMailbox, async (tab) => {
      const masked = await maskedScreenshot(tab, { path: join(shots, 'shot.png'), email });
      expect(await countMask(tab, masked)).toBe(0);
    });
  });
});
