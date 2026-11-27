import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCommerceListingFixture, createCommerceShopFixture } from '@/test/fixtures/commerce/commerce';
import {
  fetchListingForMetadata,
  fetchShopForMetadata,
  OG_COMMERCE_CACHE_MAX_ENTRIES,
  OG_COMMERCE_CACHE_TTL_MS,
  resetOgCommerceCacheForTests,
} from './ogCommerceData';

const { fetchMock, resolvePubkyMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  resolvePubkyMock: vi.fn((url: string) => `https://resolved.example/${url}`),
}));

vi.mock('@synonymdev/pubky', () => ({
  Client: class {
    fetch = fetchMock;
  },
  resolvePubky: resolvePubkyMock,
}));

const seller = '8mmmaouyode95qf7scbt4moytceiga4we5i3fwra71xapmwguwdy';

describe('fetchListingForMetadata', () => {
  beforeEach(() => {
    resetOgCommerceCacheForTests();
    fetchMock.mockReset();
    resolvePubkyMock.mockClear();
  });

  it.each(['aa540efdabb144c0babc304c5d19f1d3', '0035KEX9KTD20'])(
    'resolves production listing id shape %s through the seller homeserver',
    async (listingId) => {
      const fixture = createCommerceListingFixture({ ownerPubky: seller, listingId });
      fixture.media = fixture.media.map((media) => ({
        ...media,
        url: media.url.replace('y'.repeat(52), seller),
      }));
      fetchMock.mockResolvedValue(new Response(JSON.stringify(fixture), { status: 200 }));

      await expect(fetchListingForMetadata(seller, listingId)).resolves.toMatchObject({
        kind: 'found',
        record: { listingId },
      });
      expect(resolvePubkyMock).toHaveBeenCalledWith(
        `pubky://${seller}/pub/pubky.app/marketplace/v1/listings/${listingId}`,
      );
    },
  );

  it('returns unavailable on a record validation failure instead of not-found', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ recordType: 'listing', listingId: 'broken' }), { status: 200 }),
    );

    await expect(fetchListingForMetadata(seller, 'broken')).resolves.toEqual({
      kind: 'unavailable',
      reason: 'validation',
    });
  });

  it('uses the generic card cue only for a genuine not-found response', async () => {
    fetchMock.mockResolvedValue(new Response('Not Found', { status: 404 }));

    await expect(fetchListingForMetadata(seller, 'missing')).resolves.toEqual({ kind: 'not_found' });
  });

  it('returns unavailable for a seller homeserver 5xx response', async () => {
    fetchMock.mockResolvedValue(new Response('upstream failure', { status: 503 }));

    await expect(fetchListingForMetadata(seller, 'server-error')).resolves.toEqual({
      kind: 'unavailable',
      reason: 'http_503',
    });
  });

  it('returns unavailable when a successful response is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('not json', { status: 200 }));

    await expect(fetchListingForMetadata(seller, 'not-json')).resolves.toMatchObject({
      kind: 'unavailable',
      reason: expect.any(String),
    });
  });

  it('returns unavailable on a transient timeout instead of not-found', async () => {
    fetchMock.mockRejectedValue(new DOMException('The operation timed out', 'TimeoutError'));

    await expect(fetchListingForMetadata(seller, 'slow')).resolves.toEqual({
      kind: 'unavailable',
      reason: 'timeout',
    });
  });

  it('returns not-found for a removed listing', async () => {
    const fixture = createCommerceListingFixture({ ownerPubky: seller, state: 'removed' });
    fixture.media = fixture.media.map((media) => ({
      ...media,
      url: media.url.replace('y'.repeat(52), seller),
    }));
    fetchMock.mockResolvedValue(new Response(JSON.stringify(fixture), { status: 200 }));

    await expect(fetchListingForMetadata(seller, fixture.listingId)).resolves.toEqual({ kind: 'not_found' });
  });

  it('caches found listings for 5 minutes and deduplicates concurrent in-flight requests', async () => {
    vi.useFakeTimers();
    try {
      const fixture = createCommerceListingFixture({ ownerPubky: seller, listingId: 'cached_01' });
      fixture.media = fixture.media.map((media) => ({
        ...media,
        url: media.url.replace('y'.repeat(52), seller),
      }));
      let resolveFetch: ((response: Response) => void) | undefined;
      fetchMock.mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      );

      const first = fetchListingForMetadata(seller, 'cached_01');
      const second = fetchListingForMetadata(seller, 'cached_01');
      expect(fetchMock).toHaveBeenCalledTimes(1);

      resolveFetch?.(new Response(JSON.stringify(fixture), { status: 200 }));
      await expect(Promise.all([first, second])).resolves.toMatchObject([
        { kind: 'found', record: { listingId: 'cached_01' } },
        { kind: 'found', record: { listingId: 'cached_01' } },
      ]);

      // Warm cache hit within 5-minute TTL makes no new homeserver fetch.
      await expect(fetchListingForMetadata(seller, 'cached_01')).resolves.toMatchObject({ kind: 'found' });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Expired entry re-fetches once TTL elapses.
      vi.advanceTimersByTime(OG_COMMERCE_CACHE_TTL_MS + 1);
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(fixture), { status: 200 }));
      await expect(fetchListingForMetadata(seller, 'cached_01')).resolves.toMatchObject({ kind: 'found' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never caches unavailable failures so subsequent requests recover', async () => {
    const fixture = createCommerceListingFixture({ ownerPubky: seller, listingId: 'flaky_01' });
    fixture.media = fixture.media.map((media) => ({
      ...media,
      url: media.url.replace('y'.repeat(52), seller),
    }));
    fetchMock
      .mockResolvedValueOnce(new Response('upstream failure', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(fixture), { status: 200 }));

    await expect(fetchListingForMetadata(seller, 'flaky_01')).resolves.toEqual({
      kind: 'unavailable',
      reason: 'http_503',
    });
    await expect(fetchListingForMetadata(seller, 'flaky_01')).resolves.toMatchObject({ kind: 'found' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('caps listing cache entries with LRU eviction', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const listingId = url.slice(url.lastIndexOf('/') + 1);
      const fixture = createCommerceListingFixture({ ownerPubky: seller, listingId });
      fixture.media = fixture.media.map((media) => ({
        ...media,
        url: media.url.replace('y'.repeat(52), seller),
      }));
      return new Response(JSON.stringify(fixture), { status: 200 });
    });

    for (let i = 0; i <= OG_COMMERCE_CACHE_MAX_ENTRIES; i += 1) {
      await fetchListingForMetadata(seller, `item_${i}`);
    }
    expect(fetchMock).toHaveBeenCalledTimes(OG_COMMERCE_CACHE_MAX_ENTRIES + 1);

    // Most recent entry is still cached; the oldest entry was evicted.
    await fetchListingForMetadata(seller, `item_${OG_COMMERCE_CACHE_MAX_ENTRIES}`);
    expect(fetchMock).toHaveBeenCalledTimes(OG_COMMERCE_CACHE_MAX_ENTRIES + 1);

    await fetchListingForMetadata(seller, 'item_0');
    expect(fetchMock).toHaveBeenCalledTimes(OG_COMMERCE_CACHE_MAX_ENTRIES + 2);
  });

  it('caches and deduplicates fetchShopForMetadata reads', async () => {
    const shop = createCommerceShopFixture({ ownerPubky: seller });
    let resolveFetch: ((response: Response) => void) | undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const pending = Promise.all([fetchShopForMetadata(seller), fetchShopForMetadata(seller)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch?.(new Response(JSON.stringify(shop), { status: 200 }));
    await expect(pending).resolves.toMatchObject([
      { kind: 'found', record: { name: shop.name } },
      { kind: 'found', record: { name: shop.name } },
    ]);

    await expect(fetchShopForMetadata(seller)).resolves.toMatchObject({ kind: 'found', record: { name: shop.name } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
