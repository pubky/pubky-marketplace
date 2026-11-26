import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const verifier = fileURLToPath(new URL('./verify.mjs', import.meta.url));
const market = 'https://market.example.test';
const social = 'https://social.example.test';
const cdn = 'https://media.example.test/assets';

test('Shop verifier reads the social CDN from the framed build', async (t) => {
  let runtime;
  let guide;
  const server = createServer((req, res) => {
    res.setHeader('strict-transport-security', 'max-age=63072000');
    if (req.url === '/shop/marketplace' || req.url === '/shop-embed/marketplace') {
      // The wrapper's own CDN is correct even when the framed Shop is misconfigured.
      const config = req.url.startsWith('/shop/') ? { ...runtime, cdnUrl: `${social}/static` } : runtime;
      return res
        .writeHead(200, { 'content-type': 'text/html' })
        .end(`<script>window.__PUBKY_CONFIG__=Object.freeze(${JSON.stringify(config)})</script>`);
    }
    if (req.url === '/shop-embed/llms.txt') return res.end(guide);
    if (req.method === 'OPTIONS') {
      return res
        .writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'content-type,authorization',
        })
        .end();
    }
    res.writeHead(req.url === '/v1/pings' ? 401 : 404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const dir = await mkdtemp(join(tmpdir(), 'shop-install-verify-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const config = join(dir, 'stack.env');

  const scenarios = [
    { name: 'detects a Market index configured for social reads', expectedSocial: social, actualNexus: market, actualCdn: social + '/static', failure: 'runtime.nexusUrl' },
    { name: 'detects a guide pointing social reads to the Market index', expectedSocial: social, guideSocial: market, actualCdn: social + '/static', failure: 'llms.social' },
    { name: 'defaults to the social static endpoint', expectedSocial: social, actualCdn: `${social}/static/` },
    {
      name: 'rejects avatars still served by the Market index',
      expectedSocial: social,
      actualCdn: `${market}/static`,
      fails: true,
    },
    { name: 'accepts a separate CDN and base path', expectedSocial: social, expectedCdn: cdn, actualCdn: cdn },
    {
      name: 'enforces the configured override',
      expectedSocial: social,
      expectedCdn: cdn,
      actualCdn: `${social}/static`,
      fails: true,
    },
    { name: 'can check the CDN independently', expectedCdn: cdn, actualCdn: `${market}/static`, fails: true },
    {
      name: 'preserves older single-index installs without a social or CDN expectation',
      actualCdn: `${market}/static`,
    },
  ];
  for (const { name, expectedSocial, expectedCdn, actualCdn, actualNexus, guideSocial, fails, failure } of scenarios) {
    await t.test(name, async () => {
      runtime = {
        nexusUrl: actualNexus ?? expectedSocial ?? market,
        marketplaceNexusUrl: expectedSocial && market,
        cdnUrl: actualCdn,
        shopPublicPath: '/shop',
        inboxUrl: origin,
      };
      guide = `INDEX = ${market}\n` + (expectedSocial ? `SOCIAL = ${guideSocial ?? expectedSocial}\n` : '');
      await writeFile(
        config,
        [
          'MIV_ENV=staging',
          `SHOP_ORIGINS=${origin}`,
          'SHOP_PATH=/shop/marketplace',
          'SHOP_EMBED_PATH=/shop-embed',
          `NEXUS_URL=${market}`,
          `SOCIAL_NEXUS_URL=${expectedSocial ?? ''}`,
          `SOCIAL_CDN_URL=${expectedCdn ?? ''}`,
        ].join('\n'),
      );
      const result = await run(
        process.execPath,
        [verifier, '--config', config, '--only', 'shop', '--strict', '--json'],
        { env: {} },
      ).catch((error) => error);
      const report = JSON.parse(result.stdout);
      assert.equal(result.code ?? 0, fails || failure ? 1 : 0);
      const failed = report.results.filter((check) => check.status === 'FAIL').map((check) => check.id);
      const [group, field] = (failure ?? 'runtime.cdnUrl').split('.');
      assert.deepEqual(failed, fails || failure ? [`shop.${group}.${new URL(origin).host}.${field}`] : []);
    });
  }
});
