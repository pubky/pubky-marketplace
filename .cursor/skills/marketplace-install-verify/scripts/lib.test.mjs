// node --test .cursor/skills/marketplace-install-verify/scripts/lib.test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  checkInboxRuntime,
  checkPaypalReturnBase,
  compareMigrations,
  corsAllowsOrigin,
  expectedMigration,
  extractRuntimeConfig,
  framableBySameOrigin,
  frameAncestorsAllow,
  isTruthy,
  locksReturnOriginsFromToml,
  missingOrigins,
  normalizeBase,
  parseBearerChallenge,
  parseEmbedPath,
  parseEnvFile,
  parseImageRef,
  parseJsonLenient,
  parseList,
  parseMigrationRows,
  parseShopPath,
  parseSourceRef,
  parseTomlFlat,
  paykitTrustedKeys,
  publicBasePath,
  redact,
} from './lib.mjs';

test('parseEnvFile reads quotes, comments and export prefixes', () => {
  const env = parseEnvFile(
    [
      '# comment',
      'A=plain   # trailing comment',
      'export B="quoted # not a comment"',
      "C='[\"https://a.example\"]'",
      'D=ssh vm docker inspect --format \'{{index .Config.Labels "x"}}\' svc',
      '',
    ].join('\n'),
  );
  assert.equal(env.A, 'plain');
  assert.equal(env.B, 'quoted # not a comment');
  assert.equal(env.C, '["https://a.example"]');
  assert.equal(env.D, 'ssh vm docker inspect --format \'{{index .Config.Labels "x"}}\' svc');
  assert.throws(() => parseEnvFile('A=1\nhunter2 secret'), (error) => {
    assert.equal(error.message, 'line 2 is not KEY=VALUE');
    return true;
  });
});

test('frame-ancestors matches exact origins only', () => {
  const csp = "default-src 'none'; frame-ancestors https://shop.example.evil.com https://Shop.example:443";
  assert.equal(frameAncestorsAllow(csp, 'https://shop.example'), true);
  assert.equal(frameAncestorsAllow('frame-ancestors https://shop.example.evil.com', 'https://shop.example'), false);
  assert.equal(frameAncestorsAllow('', 'https://shop.example'), false);
  assert.equal(isTruthy('Yes'), true);
  assert.equal(isTruthy('0'), false);
});

test('parseTomlFlat reads the Paykit and Locks keys the checks use', () => {
  const toml = parseTomlFlat(`
bind_addr = "127.0.0.1:3000"
[credentials]
lock_server_secret_key = "/data/secret.sess" # path, never read by the checks
lock_server_public_key = "pubkyabc"
[signed_services]
trusted_public_keys = ["pubkyabc", "pubkydef"]
[setup]
allowed_origins = [
  "https://shop.example", # production
  'https://staging.shop.example',
]
log_authorization_url = false
[creator_authority_acquisition.legacy_connect]
allowed_return_origins = ["https://shop.example"]
[content_locks]
max_resource_bytes = 10_000_000
`);
  assert.equal(toml.bind_addr, '127.0.0.1:3000');
  assert.deepEqual(toml['signed_services.trusted_public_keys'], ['pubkyabc', 'pubkydef']);
  assert.deepEqual(toml['setup.allowed_origins'], ['https://shop.example', 'https://staging.shop.example']);
  assert.equal(toml['setup.log_authorization_url'], false);
  assert.deepEqual(toml['creator_authority_acquisition.legacy_connect.allowed_return_origins'], ['https://shop.example']);
  assert.equal(toml['content_locks.max_resource_bytes'], 10000000);
});

test('origin lists accept JSON, TOML and comma forms and compare by origin', () => {
  assert.deepEqual(parseList('["https://a.example","https://b.example"]'), ['https://a.example', 'https://b.example']);
  assert.deepEqual(parseList("['https://a.example']"), ['https://a.example']);
  assert.deepEqual(parseList('https://a.example, https://b.example'), ['https://a.example', 'https://b.example']);
  assert.deepEqual(missingOrigins('https://A.example/,https://b.example', ['https://a.example', 'https://c.example']), [
    'https://c.example',
  ]);
  assert.equal(normalizeBase('https://paykit.example/setup/'), 'https://paykit.example/setup');
  assert.equal(normalizeBase('http://paykit.internal:3001'), 'http://paykit.internal:3001');
});

test('migrations compare by version, success and SHA-384 of the file bytes', () => {
  const sql = Buffer.from('CREATE TABLE t (id int);\n');
  const checksum = createHash('sha384').update(sql).digest('hex');
  const expected = [
    expectedMigration('0001_init.sql', sql),
    expectedMigration('0002_more.up.sql', Buffer.from('x')),
    expectedMigration('0002_more.down.sql', Buffer.from('y')),
    expectedMigration('README.md', Buffer.from('z')),
  ].filter(Boolean);
  assert.equal(expected.length, 2);
  assert.equal(expected[0].checksum, checksum);
  const applied = parseMigrationRows(
    ['Using SSH key from file', `MIV|1|t|${checksum}`, `MIV|2|t|${expected[1].checksum}`, 'ROLLBACK'].join('\n'),
  );
  assert.deepEqual(compareMigrations(expected, applied).ok, true);
  const fork = parseMigrationRows(`MIV|1|t|${'0'.repeat(96)}\nMIV|2|f|${expected[1].checksum}\nMIV|3|t|aa`);
  const diff = compareMigrations(expected, fork);
  assert.deepEqual([diff.ok, diff.mismatched, diff.failed, diff.extra, diff.missing], [false, [1], [2], [3], []]);
  assert.deepEqual(compareMigrations(expected, []).missing, [1, 2]);
});

test('extractRuntimeConfig reads the frozen config object from page HTML', () => {
  const html =
    '<script>self.__PUBKY_CONFIG__=Object.freeze({"marketplaceUrl":"https://api.example","note":"brace } in \\"string\\"","n":{"a":1}});</script>';
  assert.deepEqual(extractRuntimeConfig(html), {
    marketplaceUrl: 'https://api.example',
    note: 'brace } in "string"',
    n: { a: 1 },
  });
  assert.equal(extractRuntimeConfig('<html></html>'), null);
});

test('parseJsonLenient accepts raw control characters inside strings only', () => {
  assert.deepEqual(parseJsonLenient('[{"description":"line one\nline\ttwo"}]'), [{ description: 'line one\nline\ttwo' }]);
  assert.deepEqual(parseJsonLenient('{\n  "a": 1\n}'), { a: 1 });
  assert.throws(() => parseJsonLenient('{"a":'));
});

test('source and image references parse', () => {
  assert.deepEqual(parseSourceRef('pubky/locks@b3dc87c9'), { owner: 'pubky', repo: 'locks', ref: 'b3dc87c9' });
  assert.equal(parseSourceRef('locks@main'), null);
  assert.deepEqual(parseImageRef('ghcr.io/pubky/marketplace-nexus@sha256:abc'), {
    registry: 'ghcr.io',
    repository: 'pubky/marketplace-nexus',
    reference: 'sha256:abc',
  });
  assert.deepEqual(parseImageRef('synonymsoft/paykit-server:v0.1.0-rc8'), {
    registry: 'registry-1.docker.io',
    repository: 'synonymsoft/paykit-server',
    reference: 'v0.1.0-rc8',
  });
  assert.deepEqual(parseImageRef('us-docker.pkg.dev/proj/repo/locks:1'), {
    registry: 'us-docker.pkg.dev',
    repository: 'proj/repo/locks',
    reference: '1',
  });
  assert.deepEqual(parseBearerChallenge('Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="x"'), {
    realm: 'https://ghcr.io/token',
    service: 'ghcr.io',
    scope: 'x',
  });
});

test('redact removes connection strings, bearer tokens and secret parameters', () => {
  const text = redact('psql: postgres://u:p@db.internal:5432/x failed; Authorization: Bearer abc.def; url?secret=s3cr3t&x=1');
  assert.doesNotMatch(text, /u:p@|abc\.def|s3cr3t/);
  assert.match(text, /postgres:\/\/\[redacted\]/);
});

test('Locks return origins come from the table of the acquisition method in use', () => {
  const grant = parseTomlFlat(`
[creator_authority_acquisition]
method = "grant-connect"
[creator_authority_acquisition.legacy_connect]
allowed_return_origins = ["https://old.example"]
[creator_authority_acquisition.grant_connect]
client_id = "locks.example"
allowed_return_origins = ["https://pubky.app", "https://staging.pubky.app"]
`);
  assert.deepEqual(locksReturnOriginsFromToml(grant), ['https://pubky.app', 'https://staging.pubky.app']);

  const legacy = parseTomlFlat(`
[creator_authority_acquisition]
method = "legacy-connect"
[creator_authority_acquisition.legacy_connect]
allowed_return_origins = ["https://shop.example"]
[creator_authority_acquisition.grant_connect]
allowed_return_origins = ["https://unused.example"]
`);
  assert.deepEqual(locksReturnOriginsFromToml(legacy), ['https://shop.example']);

  const unset = parseTomlFlat(`
[creator_authority_acquisition.legacy_connect]
allowed_return_origins = ["https://shop.example"]
`);
  assert.deepEqual(locksReturnOriginsFromToml(unset), ['https://shop.example']);
  assert.equal(locksReturnOriginsFromToml({}), undefined);
});

test('parseShopPath defaults, trims a trailing slash and rejects values that would build another host', () => {
  assert.equal(parseShopPath(undefined), '/marketplace');
  assert.equal(parseShopPath('  '), '/marketplace');
  assert.equal(parseShopPath('/shop/marketplace'), '/shop/marketplace');
  assert.equal(parseShopPath('/shop/marketplace/'), '/shop/marketplace');
  assert.equal(parseShopPath('/'), '/');
  for (const bad of ['shop/marketplace', '//evil.example', '/shop?x=1', '/shop#a', '/shop marketplace']) {
    assert.throws(() => parseShopPath(bad), /SHOP_PATH must start with one "\/"/, bad);
  }
});

test('paykitTrustedKeys reads the rc13 allowlist and falls back to the retired [locks] key only when it is absent', () => {
  assert.deepEqual(
    paykitTrustedKeys(parseTomlFlat('[signed_services]\ntrusted_public_keys = ["pubkyabc", "pubkydef"]')),
    ['pubkyabc', 'pubkydef'],
  );
  assert.deepEqual(
    paykitTrustedKeys(
      parseTomlFlat('[signed_services]\ntrusted_public_keys = ["pubkynew"]\n[locks]\ntrusted_public_key = "pubkyold"'),
    ),
    ['pubkynew'],
  );
  assert.deepEqual(paykitTrustedKeys(parseTomlFlat('[locks]\ntrusted_public_key = "pubkyold"')), ['pubkyold']);
  assert.equal(paykitTrustedKeys(parseTomlFlat('[setup]\nallowed_origins = []')), undefined);
});

test('parseEmbedPath accepts a mount path and treats unset as a Shop served directly', () => {
  assert.equal(parseEmbedPath(undefined), '');
  assert.equal(parseEmbedPath('  '), '');
  assert.equal(parseEmbedPath('/shop-embed'), '/shop-embed');
  assert.equal(parseEmbedPath('/a/b'), '/a/b');
  for (const bad of ['shop-embed', '/shop-embed/', '//evil.example', '/shop-embed?x=1', '/shop-embed#a', '/a/../b', '/', '/ shop']) {
    assert.throws(() => parseEmbedPath(bad), /SHOP_EMBED_PATH must be a mount path/, bad);
  }
});

test('publicBasePath is the landing path without /marketplace', () => {
  assert.equal(publicBasePath('/shop/marketplace'), '/shop');
  assert.equal(publicBasePath('/marketplace'), '');
  assert.equal(publicBasePath('/shop'), undefined);
});

test('the framed build must allow a same-origin frame in both CSP and X-Frame-Options', () => {
  const origin = 'https://pubky.app';
  assert.equal(framableBySameOrigin("frame-ancestors 'self'", 'SAMEORIGIN', origin), true);
  assert.equal(framableBySameOrigin("default-src 'self'; frame-ancestors 'self' https://staging.pubky.app", null, origin), true);
  assert.equal(framableBySameOrigin('frame-ancestors https://pubky.app', null, origin), true);
  assert.equal(framableBySameOrigin("frame-ancestors 'none'", 'DENY', origin), false);
  assert.equal(framableBySameOrigin("frame-ancestors 'self'", 'DENY', origin), false, 'a proxy DENY overrides the CSP');
  assert.equal(framableBySameOrigin('frame-ancestors https://evil.example', null, origin), false);
  assert.equal(framableBySameOrigin("frame-ancestors 'self'", 'SAMEORIGIN', null), true);
  assert.equal(framableBySameOrigin('frame-ancestors https://pubky.app', null, null), false);
});

test('PayPal return and cancel land on the public /shop, never the framed build or a bare origin', () => {
  const stack = { origins: ['https://pubky.app'], publicBase: '/shop', embedPath: '/shop-embed' };
  assert.deepEqual(checkPaypalReturnBase('https://pubky.app/shop', stack), {
    ok: true,
    detail: 'https://pubky.app/shop/marketplace/orders',
  });
  assert.equal(checkPaypalReturnBase('https://PUBKY.app/shop/', stack).ok, true);

  const framed = checkPaypalReturnBase('https://pubky.app/shop-embed', stack);
  assert.equal(framed.ok, false);
  assert.match(framed.hint, /outside the App.*https:\/\/pubky\.app\/shop$/);

  const bare = checkPaypalReturnBase('https://pubky.app', stack);
  assert.equal(bare.ok, false);
  assert.match(bare.hint, /https:\/\/pubky\.app\/shop/);

  assert.equal(checkPaypalReturnBase('https://other.example/shop', stack).ok, false);
  assert.equal(checkPaypalReturnBase('https://pubky.app/shop?x=1', stack).ok, false);
  assert.equal(checkPaypalReturnBase('not a url', stack).ok, false);
});

test('a standalone Shop expects PayPal to return to its origin root', () => {
  const stack = { origins: ['https://shop.example', 'https://staging.shop.example'], publicBase: '', embedPath: '' };
  assert.equal(checkPaypalReturnBase('https://staging.shop.example', stack).ok, true);
  assert.equal(checkPaypalReturnBase('https://shop.example/', stack).ok, true);
  assert.equal(checkPaypalReturnBase('https://shop.example/shop', stack).ok, false);
});

test('the Shop runtime must name an inbox, or a stranger\'s first message is never noticed', () => {
  assert.deepEqual(checkInboxRuntime({ inboxUrl: 'https://inbox.staging.pubky.app/' }), {
    ok: true,
    detail: 'https://inbox.staging.pubky.app',
    url: 'https://inbox.staging.pubky.app',
  });
  for (const runtime of [undefined, {}, { inboxUrl: undefined }, { inboxUrl: null }, { inboxUrl: '  ' }]) {
    const result = checkInboxRuntime(runtime);
    assert.equal(result.ok, false);
    assert.equal(result.detail, 'inboxUrl unset');
    assert.match(result.hint, /PUBKY_RUNTIME_INBOX_URL.*PUBKY_RUNTIME_INBOX_AUDIENCE/);
  }
  const bad = checkInboxRuntime({ inboxUrl: 'ftp://inbox.example' });
  assert.equal(bad.ok, false);
  assert.match(bad.hint, /http\(s\) URL/);
});

test('inbox CORS accepts the Shop origin or a wildcard (bearer tokens, no cookies), nothing else', () => {
  assert.equal(corsAllowsOrigin('https://pubky.app', 'https://pubky.app'), true);
  assert.equal(corsAllowsOrigin('https://PUBKY.app', 'https://pubky.app'), true);
  assert.equal(corsAllowsOrigin('*', 'https://pubky.app'), true);
  assert.equal(corsAllowsOrigin('https://staging.pubky.app', 'https://pubky.app'), false);
  assert.equal(corsAllowsOrigin(null, 'https://pubky.app'), false);
  assert.equal(corsAllowsOrigin('', 'https://pubky.app'), false);
  assert.equal(corsAllowsOrigin('null', 'https://pubky.app'), false);
});
