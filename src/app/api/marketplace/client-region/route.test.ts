/** @vitest-environment node */
import { afterEach, describe, expect, it } from 'vitest';
import { resetRuntimeConfigForTests } from '@/libs/runtime-config/runtime-config';
import { PUBKY_RUNTIME_ENV_NAMES } from '@/libs/runtime-config/runtime-config.schema';
import { GET } from './route';

const ask = (headers: Record<string, string> = {}) =>
  GET(new Request('https://shop.example/api/marketplace/client-region', { headers }));

afterEach(() => {
  delete process.env[PUBKY_RUNTIME_ENV_NAMES.clientRegionHeader];
  resetRuntimeConfigForTests();
});

describe('GET /api/marketplace/client-region', () => {
  it('answers the country the edge put in x-client-region, never cached', async () => {
    const response = await ask({ 'x-client-region': 'DE' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ country: 'DE' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.has('set-cookie')).toBe(false);
  });

  it('reads the country in any case', async () => {
    expect(await (await ask({ 'X-Client-Region': 'gb' })).json()).toEqual({ country: 'GB' });
  });

  it.each([
    ['no header', {}],
    ['the unknown marker', { 'x-client-region': 'XX' }],
    ['a Tor marker', { 'x-client-region': 'T1' }],
    ['an empty value', { 'x-client-region': '' }],
    ['a list', { 'x-client-region': 'DE, US' }],
    ['a name', { 'x-client-region': 'Germany' }],
  ])('answers an unknown country for %s', async (_label, headers) => {
    const response = await ask(headers);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ country: null });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('reads the header the deploy names, and ignores x-client-region then', async () => {
    process.env[PUBKY_RUNTIME_ENV_NAMES.clientRegionHeader] = 'x-vercel-ip-country';
    resetRuntimeConfigForTests();
    expect(await (await ask({ 'x-vercel-ip-country': 'US' })).json()).toEqual({ country: 'US' });
    expect(await (await ask({ 'x-client-region': 'US' })).json()).toEqual({ country: null });
  });

  it('is a dynamic route, so no build ever renders it for one visitor', async () => {
    const route = await import('./route');
    expect(route.dynamic).toBe('force-dynamic');
  });
});
