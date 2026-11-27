import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMarketplaceNexusUrl } from '@/config/nexus';
import { Logger } from '@/libs/logger/logger';
import { getCommerceAdapterMode } from '@/libs/runtime-config/runtime-config';
import { createCommerceShopFixture, createNexusListingDetailsFixture } from '@/test/fixtures/commerce/commerce';
import {
  CATALOG_LISTINGS_FETCH_TIMEOUT_MS,
  CATALOG_LISTINGS_MAX_BYTES,
  CATALOG_SHOP_FETCH_TIMEOUT_MS,
  fetchMarketplaceCatalogForSsr,
  resetOgCatalogCacheForTests,
} from './ogCatalogData';
import { OG_COMMERCE_CACHE_TTL_MS, OG_COMMERCE_REVALIDATE } from './ogCommerceData';

vi.mock('@synonymdev/pubky', () => ({
  Client: class {
    fetch(input: RequestInfo | URL, init?: RequestInit) {
      return globalThis.fetch(input, init);
    }
  },
  resolvePubky: (url: string) => url.replace('pubky://', 'https://'),
}));

vi.mock('@/libs/runtime-config/runtime-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/runtime-config/runtime-config')>();
  return {
    ...actual,
    getCommerceAdapterMode: vi.fn(() => 'transaction-service'),
  };
});

describe('fetchMarketplaceCatalogForSsr', () => {
  beforeEach(() => {
    resetOgCatalogCacheForTests();
    vi.mocked(getCommerceAdapterMode).mockReturnValue('transaction-service');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps a fixture listing stream into catalog cards and caches like listing OG', async () => {
    const fixture = createNexusListingDetailsFixture();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify([fixture]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(createCommerceShopFixture()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const { listings, shops } = await fetchMarketplaceCatalogForSsr();

    expect(fetchMock).toHaveBeenCalledWith(
      `${getMarketplaceNexusUrl()}/v0/stream/listings?state=active&limit=30`,
      expect.objectContaining({
        next: { revalidate: OG_COMMERCE_REVALIDATE },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(listings).toHaveLength(1);
    expect(listings[0]?.title).toBe('Vintage leather boots');
    expect(listings[0]?.listingId).toBe('boots_01');
    expect(shops).toHaveLength(1);
    expect(shops[0]?.name).toBe('Satoshi Vintage');
  });

  it('skips Nexus in sandbox mode', async () => {
    vi.mocked(getCommerceAdapterMode).mockReturnValue('sandbox');
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await expect(fetchMarketplaceCatalogForSsr()).resolves.toEqual({ listings: [], shops: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns an empty catalog when the stream is not ok', async () => {
    vi.spyOn(Logger, 'warn').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));

    await expect(fetchMarketplaceCatalogForSsr()).resolves.toEqual({ listings: [], shops: [] });
  });

  it('returns an empty catalog for a malformed stream payload', async () => {
    vi.spyOn(Logger, 'warn').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ not: 'an array' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(fetchMarketplaceCatalogForSsr()).resolves.toEqual({ listings: [], shops: [] });
  });

  it('keeps listings when a shop record fetch fails', async () => {
    vi.spyOn(Logger, 'warn').mockImplementation(() => {});
    const fixture = createNexusListingDetailsFixture();
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify([fixture]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
      .mockResolvedValueOnce(new Response('missing', { status: 500 }));

    const { listings, shops } = await fetchMarketplaceCatalogForSsr();

    expect(listings).toHaveLength(1);
    expect(shops).toEqual([]);
  });

  it('starts every seller shop fetch at once for a 30-seller stream', async () => {
    const listings = listingsFromSellers(30);

    let inFlight = 0;
    let maxInFlight = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/v0/stream/listings')) {
        return new Response(JSON.stringify(listings), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 25));
      inFlight -= 1;
      return new Response(JSON.stringify(createCommerceShopFixture()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const { listings: catalog, shops } = await fetchMarketplaceCatalogForSsr();

    expect(catalog).toHaveLength(30);
    expect(shops).toHaveLength(30);
    expect(maxInFlight).toBe(30);
  });

  describe('with a seller whose record fetch never settles', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      vi.spyOn(Logger, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('renders the catalog without that shop once the per-seller budget passes', async () => {
      const listings = listingsFromSellers(7);
      const stalledSeller = listings[0]!.owner_id;
      const shopRequests: string[] = [];
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/v0/stream/listings')) {
          return new Response(JSON.stringify(listings), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        shopRequests.push(url);
        // Ignores the abort signal, like a PKARR lookup that never answers.
        if (url.includes(stalledSeller)) return new Promise<Response>(() => {});
        return new Response(JSON.stringify(createCommerceShopFixture()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      let settled = false;
      const pending = fetchMarketplaceCatalogForSsr().then((payload) => {
        settled = true;
        return payload;
      });

      await vi.advanceTimersByTimeAsync(CATALOG_SHOP_FETCH_TIMEOUT_MS - 1);
      expect(shopRequests).toHaveLength(7);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      const { listings: catalog, shops } = await pending;

      expect(catalog).toHaveLength(7);
      expect(shops).toHaveLength(6);
      expect(CATALOG_SHOP_FETCH_TIMEOUT_MS).toBe(1_200);
    });
  });

  it('serves cached catalog SSR payloads for 5 minutes and deduplicates concurrent cold reads', async () => {
    vi.useFakeTimers();
    try {
      const fixture = createNexusListingDetailsFixture();
      let resolveStream: ((response: Response) => void) | undefined;
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
        const url = String(input);
        if (url.includes('/v0/stream/listings')) {
          return new Promise<Response>((resolve) => {
            resolveStream = resolve;
          });
        }
        return Promise.resolve(
          new Response(JSON.stringify(createCommerceShopFixture()), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      });

      const first = fetchMarketplaceCatalogForSsr();
      const second = fetchMarketplaceCatalogForSsr();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      resolveStream?.(
        new Response(JSON.stringify([fixture]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );
      const [resultA, resultB] = await Promise.all([first, second]);
      expect(resultA.listings).toHaveLength(1);
      expect(resultB.listings).toHaveLength(1);
      // 1 listing stream + 1 shop read shared across both concurrent callers.
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // Repeat SSR hit within 5-minute TTL makes zero upstream requests.
      const cached = await fetchMarketplaceCatalogForSsr();
      expect(cached.listings).toHaveLength(1);
      expect(cached.shops).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // After 5 minutes, cache expires and re-fetches cleanly.
      vi.advanceTimersByTime(OG_COMMERCE_CACHE_TTL_MS + 1);
      fetchMock.mockImplementation((input) => {
        const url = String(input);
        if (url.includes('/v0/stream/listings')) {
          return Promise.resolve(
            new Response(JSON.stringify([fixture]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify(createCommerceShopFixture()), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      });
      await fetchMarketplaceCatalogForSsr();
      expect(fetchMock).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not cache failed Nexus responses', async () => {
    vi.spyOn(Logger, 'warn').mockImplementation(() => {});
    const fixture = createNexusListingDetailsFixture();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('down', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([fixture]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(createCommerceShopFixture()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    await expect(fetchMarketplaceCatalogForSsr()).resolves.toEqual({ listings: [], shops: [] });
    const recovered = await fetchMarketplaceCatalogForSsr();
    expect(recovered.listings).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('recovers a failed seller shop on the next SSR hit within 5 minutes while keeping Nexus listings cached', async () => {
    vi.spyOn(Logger, 'warn').mockImplementation(() => {});
    const fixture = createNexusListingDetailsFixture();
    const shop = createCommerceShopFixture();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify([fixture]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
      .mockResolvedValueOnce(new Response('homeserver down', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(shop), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );

    const degraded = await fetchMarketplaceCatalogForSsr();
    expect(degraded.listings).toHaveLength(1);
    expect(degraded.shops).toEqual([]);

    const recovered = await fetchMarketplaceCatalogForSsr();
    expect(recovered.listings).toHaveLength(1);
    expect(recovered.shops).toHaveLength(1);
    expect(recovered.shops[0]?.name).toBe(shop.name);
    // 1 Nexus stream read + 2 shop reads (no second Nexus stream call).
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/v0/stream/listings'))).toHaveLength(1);
  });

  it('times out a hung Nexus fetch, clears the single-flight slot, and recovers without caching empty', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(Logger, 'warn').mockImplementation(() => {});
    try {
      const fixture = createNexusListingDetailsFixture();
      const shop = createCommerceShopFixture();
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementationOnce(() => new Promise<Response>(() => {}))
        .mockResolvedValueOnce(
          new Response(JSON.stringify([fixture]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(shop), { status: 200, headers: { 'Content-Type': 'application/json' } }),
        );

      const hung = fetchMarketplaceCatalogForSsr();
      await vi.advanceTimersByTimeAsync(CATALOG_LISTINGS_FETCH_TIMEOUT_MS);
      await expect(hung).resolves.toEqual({ listings: [], shops: [] });

      const recovered = await fetchMarketplaceCatalogForSsr();
      expect(recovered.listings).toHaveLength(1);
      expect(recovered.shops).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('times out a hung Nexus response body stream, cancels it, and recovers on the next call', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(Logger, 'warn').mockImplementation(() => {});
    try {
      let canceled = false;
      const hungStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('['));
        },
        cancel() {
          canceled = true;
        },
      });
      const fixture = createNexusListingDetailsFixture();
      const shop = createCommerceShopFixture();
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(hungStream, { status: 200 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify([fixture]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(shop), { status: 200, headers: { 'Content-Type': 'application/json' } }),
        );

      const hung = fetchMarketplaceCatalogForSsr();
      await vi.advanceTimersByTimeAsync(CATALOG_LISTINGS_FETCH_TIMEOUT_MS);
      await expect(hung).resolves.toEqual({ listings: [], shops: [] });
      expect(canceled).toBe(true);

      const recovered = await fetchMarketplaceCatalogForSsr();
      expect(recovered.listings).toHaveLength(1);
      expect(recovered.shops).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects oversized Nexus stream bodies without caching empty and recovers on the next call', async () => {
    vi.spyOn(Logger, 'warn').mockImplementation(() => {});
    const oversized = `[${JSON.stringify({ padding: 'x'.repeat(CATALOG_LISTINGS_MAX_BYTES + 1024) })}]`;
    const fixture = createNexusListingDetailsFixture();
    const shop = createCommerceShopFixture();
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(oversized, {
          status: 200,
          headers: { 'content-length': String(Buffer.byteLength(oversized, 'utf8')) },
        }),
      )
      .mockResolvedValueOnce(new Response(oversized, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([fixture]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(shop), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );

    await expect(fetchMarketplaceCatalogForSsr()).resolves.toEqual({ listings: [], shops: [] });
    await expect(fetchMarketplaceCatalogForSsr()).resolves.toEqual({ listings: [], shops: [] });
    const recovered = await fetchMarketplaceCatalogForSsr();
    expect(recovered.listings).toHaveLength(1);
    expect(recovered.shops).toHaveLength(1);
  });

  it('caps over-limit Nexus stream responses to NEXUS_LISTINGS_PER_PAGE before normalizing and fetching shops', async () => {
    const oversizedStream = listingsFromSellers(45);
    const shopUrls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/v0/stream/listings')) {
        return new Response(JSON.stringify(oversizedStream), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      shopUrls.push(url);
      return new Response(JSON.stringify(createCommerceShopFixture()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const { listings, shops } = await fetchMarketplaceCatalogForSsr();

    expect(listings).toHaveLength(30);
    expect(shops.length).toBeLessThanOrEqual(30);
    expect(shopUrls.length).toBeLessThanOrEqual(30);
  });
});

function listingsFromSellers(count: number) {
  const alphabet = 'ybndrfg8ejkmcpqxot1uwisza345h769';
  return Array.from({ length: count }, (_, index) => {
    const ownerId = `${alphabet[index % alphabet.length]}${'y'.repeat(51)}`;
    return createNexusListingDetailsFixture({
      id: `listing_${index}`,
      owner_id: ownerId,
      uri: `pubky://${ownerId}/pub/pubky.app/marketplace/v1/listings/listing_${index}`,
    });
  });
}
