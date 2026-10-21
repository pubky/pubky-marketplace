// @vitest-environment node
import { createServer, get, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { servedDeployment } from './deployment-check.mjs';

// The unit setup replaces global fetch with a mock, so the checks run over a real HTTP client.
const realFetch = (url: string | URL) =>
  new Promise<{ ok: boolean; text: () => Promise<string> }>((resolve, reject) => {
    get(url, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => (data += chunk));
      response.on('end', () => resolve({ ok: (response.statusCode ?? 0) < 300, text: async () => data }));
    }).on('error', reject);
  });

describe('servedDeployment', () => {
  let server: Server;
  let origin: string;
  let page = '<html><script>window.d="dpl_served"</script></html>';
  let build = '{"commit":"abcdef012345"}';
  let buildStatus = 200;
  const seen: string[] = [];

  beforeEach(async () => {
    page = '<html><script>window.d="dpl_served"</script></html>';
    build = '{"commit":"abcdef012345"}';
    buildStatus = 200;
    seen.length = 0;
    server = createServer((request, response) => {
      seen.push(request.url ?? '');
      if (request.url === '/shop-embed/api/build') {
        response.statusCode = buildStatus;
        response.setHeader('content-type', 'application/json');
        response.end(build);
      } else if (request.url === '/shop-embed/marketplace') {
        response.end(page);
      } else {
        response.statusCode = 404;
        response.end('');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => new Promise((resolve) => server.close(resolve)));

  const target = () => ({ pageUrl: `${origin}/shop-embed/marketplace`, buildUrl: `${origin}/shop-embed/api/build` });

  it('certifies a build by commit alone, reading only the build path under the mount path', async () => {
    const result = await servedDeployment({
      ...target(),
      fetchImpl: realFetch,
      env: { EXPECTED_COMMIT: 'abcdef0123456789abcdef0123456789abcdef01' },
    });
    expect(result.refusal).toBeNull();
    expect(result.commit).toBe('abcdef012345');
    expect(result.found).toBe('abcdef012345');
    expect(seen).toEqual(['/shop-embed/api/build']);
  });

  it('keeps the deployment-id check working alone, without reading the build path', async () => {
    const result = await servedDeployment({ ...target(), fetchImpl: realFetch, env: { EXPECTED_DPL: 'dpl_served' } });
    expect(result.refusal).toBeNull();
    expect(result.found).toBe('dpl_served');
    expect(seen).toEqual(['/shop-embed/marketplace']);
  });

  it('checks both when both are set', async () => {
    const env = { EXPECTED_DPL: 'dpl_served', EXPECTED_COMMIT: 'abcdef0' };
    expect((await servedDeployment({ ...target(), fetchImpl: realFetch, env })).refusal).toBeNull();
    expect(
      (await servedDeployment({ ...target(), fetchImpl: realFetch, env: { ...env, EXPECTED_COMMIT: '1234567' } }))
        .refusal,
    ).toContain('1234567');
    expect(
      (await servedDeployment({ ...target(), fetchImpl: realFetch, env: { ...env, EXPECTED_DPL: 'dpl_other' } }))
        .refusal,
    ).toContain('dpl_other');
  });

  it('refuses a different commit, an unknown commit, an unreadable build route and no expectation', async () => {
    const env = { EXPECTED_COMMIT: '1234567' };
    expect((await servedDeployment({ ...target(), fetchImpl: realFetch, env })).refusal).toContain(
      'not EXPECTED_COMMIT 1234567',
    );
    build = '{"commit":"unknown"}';
    expect((await servedDeployment({ ...target(), fetchImpl: realFetch, env })).refusal).toContain('no commit');
    build = '{"commit":"abcdef012345"}';
    buildStatus = 500;
    expect(
      (await servedDeployment({ ...target(), fetchImpl: realFetch, env: { EXPECTED_COMMIT: 'abcdef0' } })).refusal,
    ).toContain('no commit');
    seen.length = 0;
    expect((await servedDeployment({ ...target(), fetchImpl: realFetch, env: {} })).refusal).toContain(
      'EXPECTED_COMMIT',
    );
    expect(seen).toEqual([]);
  });

  it('refuses when the host is unreachable instead of throwing', async () => {
    const result = await servedDeployment({
      fetchImpl: realFetch,
      pageUrl: 'http://127.0.0.1:1/x',
      buildUrl: 'http://127.0.0.1:1/api/build',
      env: { EXPECTED_COMMIT: 'abcdef0' },
    });
    expect(result.refusal).toContain('no commit');
  });
});
