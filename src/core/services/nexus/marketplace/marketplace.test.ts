import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKETPLACE_ATTESTOR_REQUEST_TIMEOUT_MS } from '@/config/commerce';
import { getNexusUrl } from '@/config/nexus';
import { fetchNexusIfFound, queryNexus } from '@/services/nexus/nexus.utils';
import { createNexusListingDetailsFixture } from '@/test/fixtures/commerce/commerce';
import { NexusMarketplaceService } from './marketplace';
import { marketplaceApi } from './marketplace.api';

vi.mock('@/services/nexus/nexus.utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/nexus/nexus.utils')>();
  return {
    ...actual,
    queryNexus: vi.fn(),
    fetchNexusIfFound: vi.fn(),
  };
});

// Overridable stand-in for PUBKY_RUNTIME_MARKETPLACE_NEXUS_URL: unset (null)
// keeps the real accessor's fallback-to-nexusUrl behavior, which is what the
// pre-existing URL assertions below rely on.
const nexusConfigOverride = vi.hoisted(() => ({ marketplaceNexusUrl: null as string | null }));

vi.mock('@/config/nexus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/nexus')>();
  return {
    ...actual,
    getMarketplaceNexusUrl: () => nexusConfigOverride.marketplaceNexusUrl ?? actual.getMarketplaceNexusUrl(),
  };
});

const mockQueryNexus = vi.mocked(queryNexus);
const mockFetchNexus = vi.mocked(fetchNexusIfFound);

describe('Marketplace API', () => {
  afterEach(() => {
    nexusConfigOverride.marketplaceNexusUrl = null;
  });

  it('builds the bare listing stream URL when no filters are set', () => {
    expect(marketplaceApi.listingStream({})).toBe(`${getNexusUrl()}/v0/stream/listings`);
  });

  it('routes listing stream URLs through the marketplace Nexus override when one is configured', () => {
    nexusConfigOverride.marketplaceNexusUrl = 'https://marketplace-nexus.example.com';

    const url = marketplaceApi.listingStream({ state: 'active' });

    expect(url).toBe('https://marketplace-nexus.example.com/v0/stream/listings?state=active');
    expect(url).not.toContain(getNexusUrl());
  });

  it('serializes server-side filters and pagination as query parameters', () => {
    const url = marketplaceApi.listingStream({
      state: 'active',
      sale_format: 'auction',
      condition: 'like_new',
      skip: 30,
      limit: 30,
    });

    expect(url).toBe(
      `${getNexusUrl()}/v0/stream/listings?state=active&sale_format=auction&condition=like_new&skip=30&limit=30`,
    );
  });

  it('serializes the auction end-time sorting as query parameters', () => {
    const url = marketplaceApi.listingStream({
      state: 'active',
      sorting: 'ends_at',
      order: 'ascending',
    });

    expect(url).toBe(`${getNexusUrl()}/v0/stream/listings?state=active&sorting=ends_at&order=ascending`);
  });

  it('omits undefined and null filters from the query string', () => {
    const url = marketplaceApi.listingStream({
      state: 'active',
      sale_format: undefined,
      condition: undefined,
    });

    expect(url).toBe(`${getNexusUrl()}/v0/stream/listings?state=active`);
    expect(url).not.toContain('sale_format=');
    expect(url).not.toContain('condition=');
  });
});

describe('Marketplace API review streams', () => {
  const SELLER = 's'.repeat(52);

  it.each(['value', 'rating_desc', 'rating_asc'] as const)('sends sort=%s on both review streams', (sort) => {
    expect(marketplaceApi.shopReviews({ seller_id: SELLER, skip: 10, limit: 10, sort })).toBe(
      `${getNexusUrl()}/v0/shop/${SELLER}/reviews?skip=10&limit=10&sort=${sort}`,
    );
    expect(marketplaceApi.listingReviews({ seller_id: SELLER, listing_id: 'boots_01', limit: 10, sort })).toBe(
      `${getNexusUrl()}/v0/listing/${SELLER}/boots_01/reviews?limit=10&sort=${sort}`,
    );
  });

  it('sends no sort parameter without a sort, which keeps the bare list every index serves', () => {
    expect(marketplaceApi.shopReviews({ seller_id: SELLER, skip: 0, limit: 10, sort: undefined })).toBe(
      `${getNexusUrl()}/v0/shop/${SELLER}/reviews?skip=0&limit=10`,
    );
    expect(marketplaceApi.listingReviews({ seller_id: SELLER, listing_id: 'boots_01', skip: 0 })).not.toContain('sort');
  });
});

describe('Marketplace API attestor routes', () => {
  const ATTESTOR = 'w'.repeat(52);

  it('builds the attestor profile URL on the marketplace index', () => {
    expect(marketplaceApi.attestorProfile({ attestor_id: ATTESTOR })).toBe(
      `${getNexusUrl()}/v0/marketplace/attestor/${ATTESTOR}/profile`,
    );
  });

  it('builds the annotations URL with the order refs as one comma-separated parameter (the comma percent-encoded)', () => {
    const refs = ['a'.repeat(64), 'b'.repeat(64)];

    expect(marketplaceApi.attestorAnnotations({ attestor_id: ATTESTOR, order_refs: refs })).toBe(
      `${getNexusUrl()}/v0/marketplace/attestor/${ATTESTOR}/annotations?order_refs=${refs[0]}%2C${refs[1]}`,
    );
  });

  it('routes attestor URLs through the marketplace Nexus override when one is configured', () => {
    nexusConfigOverride.marketplaceNexusUrl = 'https://marketplace-nexus.example.com';

    expect(marketplaceApi.attestorProfile({ attestor_id: ATTESTOR })).toBe(
      `https://marketplace-nexus.example.com/v0/marketplace/attestor/${ATTESTOR}/profile`,
    );
    nexusConfigOverride.marketplaceNexusUrl = null;
  });
});

describe('NexusMarketplaceService attestor reads', () => {
  const ATTESTOR = 'w'.repeat(52);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads the profile in one bounded attempt, answering null for a missing route, without the retrying query', async () => {
    mockFetchNexus.mockResolvedValue({ attestor_id: ATTESTOR });

    await NexusMarketplaceService.fetchAttestorProfile({ attestor_id: ATTESTOR });

    expect(mockFetchNexus).toHaveBeenCalledWith({
      url: marketplaceApi.attestorProfile({ attestor_id: ATTESTOR }),
      timeoutMs: MARKETPLACE_ATTESTOR_REQUEST_TIMEOUT_MS,
    });
    expect(mockQueryNexus).not.toHaveBeenCalled();
  });

  it('reads the annotations in one bounded attempt and returns the aligned answer unchanged', async () => {
    const answer = [null, null];
    mockFetchNexus.mockResolvedValue(answer);
    const order_refs = ['a'.repeat(64), 'b'.repeat(64)];

    await expect(NexusMarketplaceService.fetchAttestorAnnotations({ attestor_id: ATTESTOR, order_refs })).resolves.toBe(
      answer,
    );
    expect(mockFetchNexus).toHaveBeenCalledWith({
      url: marketplaceApi.attestorAnnotations({ attestor_id: ATTESTOR, order_refs }),
      timeoutMs: MARKETPLACE_ATTESTOR_REQUEST_TIMEOUT_MS,
    });
    expect(mockQueryNexus).not.toHaveBeenCalled();
  });
});

describe('NexusMarketplaceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches the listing stream and returns the response unchanged', async () => {
    const listings = [createNexusListingDetailsFixture()];
    mockQueryNexus.mockResolvedValue(listings);

    await expect(NexusMarketplaceService.fetchListingStream({ state: 'active', limit: 30 })).resolves.toEqual(listings);
    expect(mockQueryNexus).toHaveBeenCalledWith({
      url: `${getNexusUrl()}/v0/stream/listings?state=active&limit=30`,
    });
  });

  it('propagates Nexus errors to the caller', async () => {
    mockQueryNexus.mockRejectedValue(new Error('nexus unreachable'));

    await expect(NexusMarketplaceService.fetchListingStream()).rejects.toThrow('nexus unreachable');
  });
});
