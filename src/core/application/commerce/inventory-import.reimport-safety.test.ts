import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceInventoryImportApplication } from '@/application/commerce/inventory-import';
import { listingToCanonicalRows } from '@/application/commerce/inventory-listing-map';
import type { CommerceListingRecord } from '@/libs/commerce/marketplace-records';
import type { SellerPaymentConfig } from '@/libs/commerce/payment-methods';
import { ClientErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { MarketplaceShopClientService, type SyncManyEnvelope } from '@/services/marketplace/marketplace-shop-client';
import { createCommerceListingFixture } from '@/test/fixtures/commerce/commerce';
import { IMPORT_GATES_PASSING, IMPORT_SETTINGS_COMPLETE } from '@/test-utils/import-settings';
import { BytesFile, MemoryImportStore } from '@/test-utils/inventory-import-harness';
import { asOpaque } from '@/test-utils/type-assertions';

const PUBKY = 'y'.repeat(52);

vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return {
    ...actual,
    getCommerceAdapterMode: () => 'transaction-service',
    getMarketplaceUrl: () => 'https://marketplace-service.example.test',
    isDurableCommerceMode: () => true,
  };
});

vi.mock('@/services/marketplace/marketplace-session', () => ({
  MarketplaceSessionService: {
    getActiveSession: () => ({ token: 'identity', pubky: PUBKY, capabilities: '', expiresAt: Date.now() + 60_000 }),
  },
}));

vi.mock('@/services/marketplace/marketplace-inventory-session', () => ({
  MarketplaceInventorySessionService: {
    getCoveringBearer: (sellerPubky: string) =>
      sellerPubky === PUBKY ? { token: 'inventory', source: 'inventory' } : null,
  },
}));

const NO_METHOD: SellerPaymentConfig = { bitcoinAvailable: false, bitcoinOfferAvailable: true, paypalAvailable: false };

const REAL_PACKAGE = { weightGrams: 1_234, lengthMillimeters: 310, widthMillimeters: 205, heightMillimeters: 95 };

const utf8 = (text: string) => new TextEncoder().encode(text);

function syncAll(listings: readonly { listing_id: string }[]): { readonly ok: true; readonly value: SyncManyEnvelope } {
  return {
    ok: true,
    value: asOpaque<SyncManyEnvelope>({
      schema_version: BigInt(1),
      kind: 'listing.sync_many',
      results: listings.map((listing) => ({ listing_id: listing.listing_id, status: 200 })),
    }),
  };
}

const wooFile = () =>
  new BytesFile(
    utf8(
      [
        'ID,Type,SKU,Name,Published,Description,In stock?,Stock,Regular price',
        '1,simple,sock-1,Socks,1,Warm socks,1,5,26',
      ].join('\n'),
    ),
    'socks.csv',
    'text/csv',
  );

describe('re-importing a listing that is already stored', () => {
  let store: MemoryImportStore;
  let puts: CommerceListingRecord[];
  let stored: CommerceListingRecord[];
  let payment: () => Promise<SellerPaymentConfig>;
  let localRecords: () => Promise<readonly CommerceListingRecord[]>;

  const liveListing = (overrides: Partial<CommerceListingRecord> = {}) =>
    createCommerceListingFixture({
      listingId: 'sock-1',
      ownerPubky: PUBKY,
      revision: 4,
      package: REAL_PACKAGE,
      ...overrides,
    });

  beforeEach(() => {
    store = new MemoryImportStore();
    puts = [];
    stored = [liveListing()];
    payment = async () => IMPORT_GATES_PASSING.loadPaymentConfig();
    localRecords = async () => stored;
  });

  function app() {
    return CommerceInventoryImportApplication.forSeller(PUBKY, {
      ...IMPORT_GATES_PASSING,
      loadPaymentConfig: () => payment(),
      store,
      currentItems: async () =>
        MarketplaceShopClientService.currentItemsFromRows(stored.flatMap(listingToCanonicalRows)),
      localRecords: () => localRecords(),
      putListing: async (record) => {
        const current = stored.find((entry) => entry.listingId === record.listingId);
        if (current && current.revision >= record.revision) {
          throw Err.client(ClientErrorCode.CONFLICT, 'The published listing changed.', {
            service: ErrorService.Homeserver,
            operation: 'putVerifiedPublicListing',
          });
        }
        puts.push(record);
        stored = [...stored.filter((entry) => entry.listingId !== record.listingId), record];
      },
      listingExists: async () => false,
      syncMany: async (listings) => syncAll(listings),
    });
  }

  function attachPhotos() {
    const media = JSON.stringify(createCommerceListingFixture().media);
    for (const [key, value] of store.payloads) {
      const row = JSON.parse(value) as { extraFields: Record<string, string> };
      store.payloads.set(key, JSON.stringify({ ...row, extraFields: { ...row.extraFields, media_json: media } }));
    }
  }

  async function reimport(file: BytesFile = wooFile()) {
    const importer = app();
    const planned = await importer.planFile(file, IMPORT_SETTINGS_COMPLETE);
    if (planned.status !== 'planned') throw new Error('plan');
    attachPhotos();
    const published = await importer.publish(planned.manifestId);
    return { planned, published };
  }

  describe('a shop-system file names no package', () => {
    it('keeps the real package of a live listing when a payment block keeps it live', async () => {
      payment = async () => NO_METHOD;
      const { published } = await reimport();
      expect(published).toMatchObject({ status: 'complete', keptLive: 1 });
      expect(puts).toHaveLength(1);
      expect(puts[0]).toMatchObject({ state: 'active', revision: 5, package: REAL_PACKAGE });
      expect(puts[0]?.title).toBe('Socks');
    });

    it('keeps the real package on an ordinary update too, while the gates pass', async () => {
      await reimport();
      expect(puts[0]).toMatchObject({ state: 'active', revision: 5, package: REAL_PACKAGE });
    });

    it('keeps the real package of a paused listing that a block leaves paused', async () => {
      stored = [liveListing({ state: 'paused' })];
      payment = async () => NO_METHOD;
      await reimport();
      expect(puts[0]).toMatchObject({ state: 'paused', package: REAL_PACKAGE });
    });
  });

  describe('a canonical file that carries a package', () => {
    const canonicalFile = (packageOverride: CommerceListingRecord['package']) =>
      new BytesFile(
        utf8(
          JSON.stringify(
            listingToCanonicalRows(liveListing({ package: packageOverride, title: 'Socks, new package' })),
          ),
        ),
        'catalog.json',
        'application/json',
      );
    const NEW_PACKAGE = { weightGrams: 900, lengthMillimeters: 250, widthMillimeters: 180, heightMillimeters: 60 };

    it('applies the package the file supplies, on a kept-live re-import and on an ordinary one', async () => {
      payment = async () => NO_METHOD;
      await reimport(canonicalFile(NEW_PACKAGE));
      expect(puts[0]).toMatchObject({ state: 'active', title: 'Socks, new package', package: NEW_PACKAGE });

      puts = [];
      stored = [liveListing()];
      payment = async () => IMPORT_GATES_PASSING.loadPaymentConfig();
      await reimport(canonicalFile(NEW_PACKAGE));
      expect(puts[0]).toMatchObject({ package: NEW_PACKAGE });
    });
  });

  describe('when the stored listings cannot be read', () => {
    beforeEach(() => {
      localRecords = async () => {
        throw new Error('local cache unavailable');
      };
    });

    it('treats the listing as new: never kept live, so a gate block saves it paused and the stored one is not overwritten', async () => {
      payment = async () => NO_METHOD;
      const { published } = await reimport();
      expect(published.status).toBe('conflict');
      expect(puts).toEqual([]);
      expect(stored[0]).toMatchObject({
        state: 'active',
        revision: 4,
        package: REAL_PACKAGE,
        title: 'Vintage leather boots',
      });
    });

    it('writes nothing over the stored listing when the gates pass either', async () => {
      const { published } = await reimport();
      expect(published.status).toBe('conflict');
      expect(puts).toEqual([]);
    });

    it('still publishes a listing that is not stored yet', async () => {
      stored = [];
      const { published } = await reimport();
      expect(published).toMatchObject({ status: 'complete', published: 1 });
      expect(puts[0]).toMatchObject({ state: 'active', revision: 1 });
    });
  });
});
