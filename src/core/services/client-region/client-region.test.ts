import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubClientRegion } from '@/test-utils/region-modes';
import { ClientRegionService } from './client-region';

afterEach(() => vi.unstubAllGlobals());

describe('ClientRegionService.fetchCountry', () => {
  it('asks the Shop route without caching and returns the country', async () => {
    const fetchStub = stubClientRegion('DE');
    await expect(ClientRegionService.fetchCountry()).resolves.toBe('DE');
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0];
    expect(url).toBe('/api/marketplace/client-region');
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store', credentials: 'same-origin' });
  });

  it('returns null when the edge could not tell', async () => {
    stubClientRegion(null);
    await expect(ClientRegionService.fetchCountry()).resolves.toBeNull();
  });

  it('throws when the route fails', async () => {
    stubClientRegion('fail');
    await expect(ClientRegionService.fetchCountry()).rejects.toMatchObject({ context: { statusCode: 503 } });
  });

  it.each([{ country: 'de' }, { country: 'DEU' }, { country: 1 }, {}])(
    'throws on the invalid answer %j',
    async (body) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
        ),
      );
      await expect(ClientRegionService.fetchCountry()).rejects.toThrow('invalid country');
    },
  );

  it('throws when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(ClientRegionService.fetchCountry()).rejects.toBeDefined();
  });
});
