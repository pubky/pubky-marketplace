import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TagKind } from '@/application/tag/tag.types';
import * as commerceConfig from '@/config/commerce';
import { NEXUS_LISTINGS_PER_PAGE } from '@/config/nexus';
import type { CommerceListingRecord } from '@/libs/commerce/marketplace-records';
import { ClientErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { CommerceCatalogEntryModel, CommerceListingModel } from '@/models/commerce/commerce.models';
import { CommerceRecordNormalizer } from '@/pipes/commerce/commerce.normalizer';
import { CommerceHomeserverService } from '@/services/homeserver/commerce/commerce';
import { LocalCommerceService } from '@/services/local/commerce/commerce';
import { NexusMarketplaceService } from '@/services/nexus/marketplace/marketplace';
import type { NexusListingDetails } from '@/services/nexus/marketplace/marketplace.types';
import { COMMERCE_FIXTURE_SELLER, createCommerceListingFixture } from '@/test/fixtures/commerce/commerce';
import { setStoreSeller } from '@/test-utils/store-mode';
import { CommerceApplication } from './commerce';

const SELLER_REFRESH_FIXTURE = JSON.parse(
  readFileSync(resolve(__dirname, '../../../test/fixtures/commerce/live/seller-dashboard-refresh-v23.json'), 'utf8'),
) as { nexus: NexusListingDetails[]; canonical: Array<{ record: unknown }> };

const SELLER = COMMERCE_FIXTURE_SELLER;
const OTHER_SELLER = 's'.repeat(52);
const LISTINGS_DIR = `pubky://${SELLER}/pub/pubky.app/marketplace/v1/listings/`;

const listing = (listingId: string, overrides: Partial<CommerceListingRecord> = {}) =>
  createCommerceListingFixture({ listingId, ...overrides });

/**
 * Serves `records` as the seller's listing directory (ordered by listing id, paged after a cursor
 * like the homeserver) and each record at its path; `raw` serves other bodies at given ids.
 */
function serveHomeserver(records: unknown[], raw: Record<string, unknown> = {}) {
  const byId = new Map<string, unknown>(Object.entries(raw));
  for (const record of records) byId.set((record as CommerceListingRecord).listingId, record);
  const urls = [...byId.keys()].sort().map((id) => `${LISTINGS_DIR}${id}`);
  const listPage = vi
    .spyOn(CommerceHomeserverService, 'listPage')
    .mockImplementation(async (directory, limit, cursor) => {
      if (directory !== LISTINGS_DIR) return [];
      const start = cursor === undefined ? 0 : urls.indexOf(cursor) + 1;
      return urls.slice(start, start + limit);
    });
  const fetchJsonIfFound = vi.spyOn(CommerceHomeserverService, 'fetchJsonIfFound').mockImplementation(async (url) => {
    const id = url.slice(url.lastIndexOf('/') + 1);
    return byId.has(id) ? { found: true, json: byId.get(id) } : { found: false };
  });
  return { listPage, fetchJsonIfFound };
}

function spyOnIndex() {
  return [
    vi.spyOn(NexusMarketplaceService, 'fetchListingStream'),
    vi.spyOn(NexusMarketplaceService, 'fetchListingDetails'),
    vi.spyOn(NexusMarketplaceService, 'fetchListingDetailsOnce'),
    vi.spyOn(NexusMarketplaceService, 'fetchListingTags'),
    vi.spyOn(NexusMarketplaceService, 'fetchShopTags'),
    vi.spyOn(NexusMarketplaceService, 'fetchShopReputation'),
    vi.spyOn(NexusMarketplaceService, 'fetchShopReviews'),
    vi.spyOn(NexusMarketplaceService, 'fetchListingReviews'),
  ];
}

describe('CommerceApplication store catalog', () => {
  let index: ReturnType<typeof spyOnIndex>;

  beforeEach(async () => {
    setStoreSeller(SELLER);
    vi.spyOn(commerceConfig, 'getCommerceAdapterMode').mockReturnValue('transaction-service');
    index = spyOnIndex();
    await CommerceCatalogEntryModel.table.clear();
    await CommerceListingModel.table.clear();
  });

  afterEach(() => {
    for (const spy of index) expect(spy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    setStoreSeller(undefined);
  });

  it('builds from each canonical record the catalog entry the index served for it', () => {
    const indexed = CommerceRecordNormalizer.nexusListingStream(SELLER_REFRESH_FIXTURE.nexus);
    const fromRecords = SELLER_REFRESH_FIXTURE.canonical.map(({ record }) =>
      CommerceRecordNormalizer.catalogEntryFromListingRecord(CommerceRecordNormalizer.listing(record)),
    );

    expect(fromRecords).toHaveLength(indexed.length);
    for (const entry of fromRecords) {
      expect(entry).toEqual({
        ...indexed.find(({ id }) => id === entry.id),
        reputation: null,
        listing_reputation: null,
      });
    }
  });

  it("caches a shop's active listings from the seller's homeserver, sandbox included", async () => {
    vi.mocked(commerceConfig.getCommerceAdapterMode).mockReturnValue('sandbox');
    serveHomeserver([listing('boots_01'), listing('paused_01', { state: 'paused' }), listing('hat_01')]);

    await CommerceApplication.fetchSellerCatalogListings(SELLER);

    const entries = await CommerceCatalogEntryModel.table.toArray();
    expect(entries.map(({ listing_id }) => listing_id).sort()).toEqual(['boots_01', 'hat_01']);
    expect(entries.find(({ listing_id }) => listing_id === 'boots_01')).toEqual(
      CommerceRecordNormalizer.catalogEntryFromListingRecord(listing('boots_01')),
    );
    // Discovery caches index-shaped entries only, as the index path does.
    expect(await CommerceListingModel.table.count()).toBe(0);
  });

  it('reads every directory page after the last URL of the one before', async () => {
    const records = Array.from({ length: NEXUS_LISTINGS_PER_PAGE + 2 }, (_, i) =>
      listing(`item_${String(i).padStart(3, '0')}`),
    );
    const { listPage } = serveHomeserver(records);

    await CommerceApplication.fetchSellerCatalogListings(SELLER);

    expect(listPage.mock.calls).toEqual([
      [LISTINGS_DIR, NEXUS_LISTINGS_PER_PAGE, undefined],
      [
        LISTINGS_DIR,
        NEXUS_LISTINGS_PER_PAGE,
        `${LISTINGS_DIR}item_${String(NEXUS_LISTINGS_PER_PAGE - 1).padStart(3, '0')}`,
      ],
    ]);
    expect(await CommerceCatalogEntryModel.table.count()).toBe(records.length);
  });

  it('skips a missing, invalid or misplaced record and keeps the rest of the shop', async () => {
    const { fetchJsonIfFound } = serveHomeserver([listing('boots_01')], {
      broken_01: { recordType: 'listing', title: 'Not a listing' },
      moved_01: listing('other_01'),
    });
    vi.mocked(CommerceHomeserverService.listPage).mockResolvedValueOnce([
      `${LISTINGS_DIR}boots_01`,
      `${LISTINGS_DIR}broken_01`,
      `${LISTINGS_DIR}gone_01`,
      `${LISTINGS_DIR}moved_01`,
      `${LISTINGS_DIR}not a listing id!`,
    ]);

    await CommerceApplication.fetchSellerCatalogListings(SELLER);

    expect((await CommerceCatalogEntryModel.table.toArray()).map(({ listing_id }) => listing_id)).toEqual(['boots_01']);
    expect(fetchJsonIfFound).toHaveBeenCalledTimes(4);
  });

  it("refreshes the seller's own listings in every state but removed, committing only newer records", async () => {
    await LocalCommerceService.upsertListing(listing('boots_01', { revision: 2 }), 'synced');
    serveHomeserver([
      listing('boots_01', { revision: 2, title: 'Already cached boots' }),
      listing('paused_01', { state: 'paused' }),
      listing('ended_01', { state: 'ended' }),
      listing('removed_01', { state: 'removed' }),
    ]);

    await CommerceApplication.refreshListingsBySeller(SELLER);

    const listings = await LocalCommerceService.getListingsBySeller(SELLER);
    expect(listings.map(({ listing_id }) => listing_id).sort()).toEqual(['boots_01', 'ended_01', 'paused_01']);
    expect(listings.find(({ listing_id }) => listing_id === 'boots_01')?.record.title).toBe('Vintage leather boots');
    expect((await CommerceCatalogEntryModel.table.toArray()).map(({ listing_id }) => listing_id).sort()).toEqual([
      'boots_01',
      'ended_01',
      'paused_01',
    ]);
  });

  it("rejects the seller's refresh on a record naming another listing, before touching the cache", async () => {
    serveHomeserver([listing('boots_01')], { moved_01: listing('other_01') });

    await expect(CommerceApplication.refreshListingsBySeller(SELLER)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      service: ErrorService.Homeserver,
      message: 'Seller catalog contains an invalid listing identity.',
    });
    expect(await CommerceCatalogEntryModel.table.count()).toBe(0);
  });

  it('bounds the directory read: the refresh rejects past the page limit and a shop page keeps what it read', async () => {
    let page = 0;
    vi.spyOn(CommerceHomeserverService, 'listPage').mockImplementation(async (_directory, limit) => {
      page += 1;
      return Array.from({ length: limit }, (_, i) => `${LISTINGS_DIR}p${page}_${i}`);
    });
    vi.spyOn(CommerceHomeserverService, 'fetchJsonIfFound').mockResolvedValue({ found: false });

    await expect(CommerceApplication.refreshListingsBySeller(SELLER)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      service: ErrorService.Homeserver,
      message: 'Seller catalog refresh exceeded its bounded page limit.',
    });
    expect(page).toBe(100);

    page = 0;
    await expect(CommerceApplication.fetchSellerCatalogListings(SELLER)).resolves.toBeUndefined();
    expect(page).toBe(100);
  });

  it("reads only the store seller's catalog for the catalog grid", async () => {
    const { listPage } = serveHomeserver([listing('boots_01')]);

    await CommerceApplication.fetchCatalogListings({ saleFormat: 'auction' });
    await CommerceApplication.fetchCatalogListings({ sellerId: OTHER_SELLER });
    await CommerceApplication.fetchSellerSetCatalogListings([OTHER_SELLER]);
    await CommerceApplication.fetchFollowedSellerCatalogListings([OTHER_SELLER]);

    expect(listPage).toHaveBeenCalledOnce();
    expect((await CommerceCatalogEntryModel.table.toArray()).map(({ listing_id }) => listing_id)).toEqual(['boots_01']);
  });

  it("confirms a deletion from the homeserver's 404 alone", async () => {
    const notFound = Err.client(ClientErrorCode.NOT_FOUND, 'Not found', {
      service: ErrorService.Homeserver,
      operation: 'fetchJson',
      context: { statusCode: 404 },
    });
    const unreachable = Err.client(ClientErrorCode.NOT_FOUND, 'Not found', {
      service: ErrorService.Marketplace,
      operation: 'fetchJson',
    });

    await expect(CommerceApplication.isListingConfirmedRemoved(SELLER, 'boots_01', notFound)).resolves.toBe(true);
    await expect(CommerceApplication.isListingConfirmedRemoved(SELLER, 'boots_01', unreachable)).resolves.toBe(false);
  });

  it("observes a watched listing on the seller's homeserver", async () => {
    vi.mocked(commerceConfig.getCommerceAdapterMode).mockReturnValue('sandbox');
    const buyer = 'b'.repeat(52);
    const watched = listing('boots_01', { revision: 4 });
    serveHomeserver([watched]);
    vi.spyOn(LocalCommerceService, 'getFavorites').mockResolvedValue([
      { id: `${buyer}:${SELLER}:boots_01`, owner_id: buyer, listing_id: `${SELLER}:boots_01`, created_at: 1 },
    ]);
    vi.spyOn(LocalCommerceService, 'getWatchSnapshots').mockResolvedValue([]);
    const save = vi.spyOn(LocalCommerceService, 'saveWatchDetection').mockResolvedValue();

    await CommerceApplication.runWatchlistDetection(buyer);

    expect(save.mock.calls[0]?.[1]).toEqual([
      expect.objectContaining({ listing_id: `${SELLER}:boots_01`, index_revision: 4, index_state: 'active' }),
    ]);
    expect(await LocalCommerceService.getCatalogEntry(`${SELLER}:boots_01`)).toEqual(
      CommerceRecordNormalizer.catalogEntryFromListingRecord(watched),
    );
  });

  it('shows no tags, reviews or ratings, without asking the index', async () => {
    await expect(CommerceApplication.fetchMarketplaceTags({ kind: TagKind.SHOP, taggedId: SELLER })).resolves.toEqual(
      [],
    );
    await expect(
      CommerceApplication.fetchMarketplaceTags({ kind: TagKind.LISTING, taggedId: `${SELLER}:boots_01` }),
    ).resolves.toEqual([]);
    await expect(CommerceApplication.fetchListingRating(SELLER, 'boots_01')).resolves.toBe('unavailable');
    await expect(CommerceApplication.fetchSellerReputationOverview(SELLER)).resolves.toEqual({ status: 'unavailable' });
    await expect(CommerceApplication.fetchSellerReviews(SELLER)).resolves.toEqual({ status: 'unavailable' });
    await expect(CommerceApplication.fetchListingReviews(SELLER, 'boots_01')).resolves.toEqual({
      status: 'unavailable',
    });
  });
});
