import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCommerceListingFixture, createCommerceShopFixture } from '@/test/fixtures/commerce/commerce';
import {
  BoundedTtlCache,
  fetchListingForMetadata,
  fetchShopForMetadata,
  OG_COMMERCE_CACHE_MAX_ENTRIES,
  OG_COMMERCE_CACHE_TTL_MS,
  OG_RECORD_MAX_BYTES,
  readBoundedTextBody,
  RECORD_FETCH_TIMEOUT_MS,
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

  it('rejects oversized listing and shop JSON responses before parsing and never caches them', async () => {
    const oversizedPayload = JSON.stringify({
      ...createCommerceShopFixture({ ownerPubky: seller }),
      extra: 'x'.repeat(OG_RECORD_MAX_BYTES + 1024),
    });
    fetchMock
      .mockResolvedValueOnce(
        new Response(oversizedPayload, {
          status: 200,
          headers: { 'content-length': String(Buffer.byteLength(oversizedPayload, 'utf8')) },
        }),
      )
      .mockResolvedValueOnce(new Response(oversizedPayload, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(createCommerceShopFixture({ ownerPubky: seller })), { status: 200 }),
      );

    // Content-Length cap rejection
    await expect(fetchShopForMetadata(seller)).resolves.toEqual({ kind: 'unavailable', reason: 'too_large' });
    // Streamed chunk cap rejection without Content-Length
    await expect(fetchShopForMetadata(seller)).resolves.toEqual({ kind: 'unavailable', reason: 'too_large' });
    // Oversized failure was not cached, so a normal subsequent read recovers
    await expect(fetchShopForMetadata(seller)).resolves.toMatchObject({ kind: 'found' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('strips unknown passthrough fields from listings and shops before caching', async () => {
    const fixture = createCommerceListingFixture({ ownerPubky: seller, listingId: 'passthrough_01' });
    fixture.media = fixture.media.map((media) => ({
      ...media,
      url: media.url.replace('y'.repeat(52), seller),
    }));
    const bloatedListing = {
      ...fixture,
      unknownTopLevelBlob: 'x'.repeat(50_000),
      location: { ...fixture.location, unknownNestedBlob: 'y'.repeat(10_000) },
      media: fixture.media.map((item) => ({ ...item, unknownMediaBlob: 'z'.repeat(10_000) })),
    };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(bloatedListing), { status: 200 }));

    const result = await fetchListingForMetadata(seller, 'passthrough_01');
    expect(result.kind).toBe('found');
    if (result.kind === 'found') {
      expect(result.record).not.toHaveProperty('unknownTopLevelBlob');
      expect(result.record.location).not.toHaveProperty('unknownNestedBlob');
      expect(result.record.media[0]).not.toHaveProperty('unknownMediaBlob');
    }

    const bloatedShop = {
      ...createCommerceShopFixture({ ownerPubky: seller }),
      unknownShopBlob: 'q'.repeat(50_000),
      location: { countryCode: 'US', unknownLocBlob: 'w'.repeat(10_000) },
    };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(bloatedShop), { status: 200 }));

    const shopResult = await fetchShopForMetadata(seller);
    expect(shopResult.kind).toBe('found');
    if (shopResult.kind === 'found') {
      expect(shopResult.record).not.toHaveProperty('unknownShopBlob');
      expect(shopResult.record.location).not.toHaveProperty('unknownLocBlob');
    }
  });

  it('enforces total byte budget and per-entry byte cap with LRU eviction on BoundedTtlCache', () => {
    const cache = new BoundedTtlCache<string>({ maxEntries: 10, maxTotalBytes: 100, maxEntryBytes: 60 });

    expect(cache.set('too-big', 'payload', 60_000, 61)).toBe(false);
    expect(cache.size).toBe(0);

    expect(cache.set('a', 'A', 60_000, 45)).toBe(true);
    expect(cache.set('b', 'B', 60_000, 45)).toBe(true);
    expect(cache.byteSize).toBe(90);

    // Access 'a' so 'b' becomes least-recently-used.
    expect(cache.get('a')).toBe('A');
    expect(cache.set('c', 'C', 60_000, 45)).toBe(true);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('A');
    expect(cache.get('c')).toBe('C');
    expect(cache.byteSize).toBe(90);
  });

  it.each([
    ['short-then-long', 1_200, RECORD_FETCH_TIMEOUT_MS],
    ['long-then-short', RECORD_FETCH_TIMEOUT_MS, 1_200],
  ] as const)(
    'honors both caller timeouts during %s concurrent fetchShopForMetadata single-flight',
    async (_order, firstTimeoutMs, secondTimeoutMs) => {
      vi.useFakeTimers();
      try {
        const shop = createCommerceShopFixture({ ownerPubky: seller });
        fetchMock.mockImplementationOnce(
          () =>
            new Promise<Response>((resolve) => {
              setTimeout(() => resolve(new Response(JSON.stringify(shop), { status: 200 })), 1_500);
            }),
        );

        const firstPromise = fetchShopForMetadata(seller, { timeoutMs: firstTimeoutMs });
        const secondPromise = fetchShopForMetadata(seller, { timeoutMs: secondTimeoutMs });
        expect(fetchMock).toHaveBeenCalledTimes(1);

        const shortPromise = firstTimeoutMs < secondTimeoutMs ? firstPromise : secondPromise;
        const longPromise = firstTimeoutMs < secondTimeoutMs ? secondPromise : firstPromise;

        await vi.advanceTimersByTimeAsync(1_200);
        await expect(shortPromise).resolves.toEqual({ kind: 'unavailable', reason: 'timeout' });

        // The 4s caller still succeeds at 1500ms and warms shopCache for later hits.
        await vi.advanceTimersByTimeAsync(300);
        await expect(longPromise).resolves.toMatchObject({ kind: 'found', record: { name: shop.name } });

        await expect(fetchShopForMetadata(seller, { timeoutMs: 1_200 })).resolves.toMatchObject({
          kind: 'found',
          record: { name: shop.name },
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('rejects deeply nested sub-256-KiB JSON as validation unavailable without throwing RangeError', async () => {
    const deepJson = `{"a":${'['.repeat(2_000)}0${']'.repeat(2_000)}}`;
    expect(Buffer.byteLength(deepJson, 'utf8')).toBeLessThan(OG_RECORD_MAX_BYTES);

    fetchMock
      .mockResolvedValueOnce(new Response(deepJson, { status: 200 }))
      .mockResolvedValueOnce(new Response(deepJson, { status: 200 }));

    await expect(fetchListingForMetadata(seller, 'deep_listing')).resolves.toEqual({
      kind: 'unavailable',
      reason: 'validation',
    });
    await expect(fetchShopForMetadata(seller)).resolves.toEqual({
      kind: 'unavailable',
      reason: 'validation',
    });
  });

  it('fails closed in readBoundedTextBody without calling res.text() when response has no body stream', async () => {
    const bodylessResponse = new Response(null, { status: 200 });
    expect(bodylessResponse.body).toBeNull();
    const textSpy = vi.spyOn(bodylessResponse, 'text');

    await expect(readBoundedTextBody(bodylessResponse, OG_RECORD_MAX_BYTES)).resolves.toEqual({ unreadable: true });
    expect(textSpy).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(bodylessResponse);
    await expect(fetchListingForMetadata(seller, 'bodyless_01')).resolves.toEqual({
      kind: 'unavailable',
      reason: 'unbounded_body',
    });
    expect(textSpy).not.toHaveBeenCalled();
  });
});
