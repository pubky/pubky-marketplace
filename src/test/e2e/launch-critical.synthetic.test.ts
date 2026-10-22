// @vitest-environment node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { installSyntheticLaunchFixture } from './launch-critical.synthetic.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const BASE_URL = 'http://127.0.0.1:3000';

type Handler = (route: {
  request: () => { url: () => string; method: () => string; headers: () => Record<string, string> };
  fulfill: (options: { status?: number; json?: unknown }) => Promise<void>;
}) => Promise<void>;

async function install(clientRegion?: string | null) {
  let handler: Handler | undefined;
  const fixture = await installSyntheticLaunchFixture({
    context: {
      addInitScript: vi.fn(async () => undefined),
      newPage: vi.fn(async () => ({ goto: vi.fn(async () => undefined), evaluate: vi.fn(async () => undefined) })),
      route: vi.fn(async (_pattern: string, routeHandler: Handler) => {
        handler = routeHandler;
      }),
    },
    baseUrl: BASE_URL,
    serviceUrl: 'https://service.example.test',
    nexusUrl: 'http://127.0.0.1:3200',
    root: ROOT,
    ...(clientRegion === undefined ? {} : { clientRegion }),
  });
  const ask = async (pathname: string) => {
    const fulfilled: { status?: number; json?: unknown }[] = [];
    await handler?.({
      request: () => ({ url: () => `${BASE_URL}${pathname}`, method: () => 'GET', headers: () => ({}) }),
      fulfill: async (options) => {
        fulfilled.push(options);
      },
    });
    return fulfilled[0];
  };
  return { fixture, ask };
}

describe('the synthetic launch fixture and the client-region route', () => {
  it('answers an unknown country by default, and does not count it as a violation', async () => {
    const { fixture, ask } = await install();
    const answer = await ask('/api/marketplace/client-region');

    expect(answer).toMatchObject({ json: { country: null } });
    expect(answer?.status).toBeUndefined();
    expect(fixture.summary().violations).toEqual([]);
  });

  it('answers the country a launch run with a region policy asks for', async () => {
    const { ask } = await install('DE');
    expect(await ask('/api/marketplace/client-region')).toMatchObject({ json: { country: 'DE' } });
  });

  it('refuses a region that is not an ISO alpha-2 code', async () => {
    await expect(install('Germany')).rejects.toThrow('ISO alpha-2');
  });

  it('still rejects an API route it does not know', async () => {
    const { fixture, ask } = await install();
    expect(await ask('/api/marketplace/unknown')).toMatchObject({ status: 400 });
    expect(fixture.summary().violations).toHaveLength(1);
  });
});
