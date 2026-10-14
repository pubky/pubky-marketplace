import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { db } from '@/database/franky/franky';
import type { CommerceShopRecord } from '@/libs/commerce/marketplace-records';
import { CommerceShopModel, CommerceSyncJobModel } from '@/models/commerce/commerce.models';
import { CommerceRecordNormalizer } from '@/pipes/commerce/commerce.normalizer';
import { CommerceHomeserverService } from '@/services/homeserver/commerce/commerce';
import { LocalCommerceService } from '@/services/local/commerce/commerce';
import {
  COMMERCE_FIXTURE_SELLER,
  createCommerceListingFixture,
  createCommerceShopFixture,
} from '@/test/fixtures/commerce/commerce';
import { asOpaque } from '@/test-utils/type-assertions';
import { CommerceApplication } from './commerce';

const SELLER = COMMERCE_FIXTURE_SELLER;
const PROFILE = { name: 'Satoshi', bio: 'Bitcoin goods.' };
type ShopRow = NonNullable<Awaited<ReturnType<typeof LocalCommerceService.getShop>>>;
const shopRow = asOpaque<ShopRow>({ record: createCommerceShopFixture(), sync_status: 'synced' });

describe('CommerceApplication default storefront', () => {
  let localShop: MockInstance<typeof LocalCommerceService.getShop>;
  let published: MockInstance<typeof CommerceHomeserverService.fetchJsonIfFound>;
  let put: MockInstance<typeof CommerceHomeserverService.putJson>;

  beforeEach(() => {
    vi.restoreAllMocks();
    CommerceApplication['shopWrites'].clear();
    localShop = vi.spyOn(LocalCommerceService, 'getShop').mockResolvedValue(null);
    vi.spyOn(LocalCommerceService, 'getListingsBySeller').mockResolvedValue([]);
    vi.spyOn(LocalCommerceService, 'stageShopSync').mockResolvedValue(undefined);
    vi.spyOn(LocalCommerceService, 'upsertShop').mockResolvedValue(undefined);
    vi.spyOn(LocalCommerceService, 'completeSyncJob').mockResolvedValue(undefined);
    published = vi.spyOn(CommerceHomeserverService, 'fetchJsonIfFound').mockResolvedValue({ found: false });
    put = vi.spyOn(CommerceHomeserverService, 'putJson').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const written = () => put.mock.calls.map(([, record]) => record as CommerceShopRecord);

  describe('needsDefaultShop', () => {
    it('is true when the seller has no local or published shop', async () => {
      await expect(CommerceApplication.needsDefaultShop(SELLER)).resolves.toBe(true);
      expect(published).toHaveBeenCalledWith(CommerceRecordNormalizer.shopUri(SELLER));
    });

    it('is false for a local shop, saved or mid-save', async () => {
      localShop.mockResolvedValue(asOpaque<ShopRow>({ ...shopRow, sync_status: 'pending' }));

      await expect(CommerceApplication.needsDefaultShop(SELLER)).resolves.toBe(false);
      expect(published).not.toHaveBeenCalled();
    });

    it('is false for a published shop', async () => {
      published.mockResolvedValue({ found: true, json: createCommerceShopFixture() });

      await expect(CommerceApplication.needsDefaultShop(SELLER)).resolves.toBe(false);
    });

    it('throws when the homeserver cannot be read', async () => {
      published.mockRejectedValue(new Error('homeserver down'));

      await expect(CommerceApplication.needsDefaultShop(SELLER)).rejects.toThrow('homeserver down');
    });
  });

  describe('commitCreateDefaultShop', () => {
    it('publishes a storefront from the profile', async () => {
      await CommerceApplication.commitCreateDefaultShop({
        ownerPubky: SELLER,
        profile: PROFILE,
        location: { countryCode: 'DE' },
      });

      expect(put).toHaveBeenCalledOnce();
      expect(put.mock.calls[0][0]).toBe(CommerceRecordNormalizer.shopUri(SELLER));
      const [record] = written();
      expect(record).toMatchObject({
        ownerPubky: SELLER,
        recordType: 'shop',
        revision: 1,
        name: 'Satoshi',
        bio: 'Bitcoin goods.',
        location: { countryCode: 'DE' },
      });
      expect(() => CommerceRecordNormalizer.shop(record)).not.toThrow();
    });

    it('takes the country from a cached listing when the trigger has none', async () => {
      vi.mocked(LocalCommerceService.getListingsBySeller).mockResolvedValue([
        { record: createCommerceListingFixture({ location: { countryCode: 'CA' } }) },
      ] as Awaited<ReturnType<typeof LocalCommerceService.getListingsBySeller>>);

      await CommerceApplication.commitCreateDefaultShop({ ownerPubky: SELLER, profile: PROFILE });

      expect(written()[0].location).toEqual({ countryCode: 'CA' });
    });

    it('never overwrites a local shop that appeared before the write', async () => {
      localShop.mockResolvedValue(shopRow);

      await CommerceApplication.commitCreateDefaultShop({ ownerPubky: SELLER, profile: PROFILE });

      expect(put).not.toHaveBeenCalled();
    });

    describe('racing a settings save', () => {
      const saved = createCommerceShopFixture({ ownerPubky: SELLER, name: 'My own shop' });

      beforeEach(() => {
        // A local shop table: a staged write is visible to later reads.
        let row: ShopRow | null = null;
        localShop.mockImplementation(async () => row);
        vi.mocked(LocalCommerceService.stageShopSync).mockImplementation(async (record) => {
          row = asOpaque<ShopRow>({ record, sync_status: 'pending' });
        });
      });

      it('yields to a settings save that started first', async () => {
        await Promise.all([
          CommerceApplication.commitUpsertShop(saved),
          CommerceApplication.commitCreateDefaultShop({ ownerPubky: SELLER, profile: PROFILE }),
        ]);

        expect(written().map((record) => record.name)).toEqual(['My own shop']);
      });

      it('lets a settings save that starts during the default write land last', async () => {
        let releaseDefault!: () => void;
        put.mockImplementationOnce(() => new Promise((resolve) => (releaseDefault = () => resolve(undefined))));

        const createDefault = CommerceApplication.commitCreateDefaultShop({ ownerPubky: SELLER, profile: PROFILE });
        await vi.waitFor(() => expect(put).toHaveBeenCalledOnce());
        const save = CommerceApplication.commitUpsertShop(saved);
        await Promise.resolve();
        expect(put).toHaveBeenCalledOnce();
        releaseDefault();
        await Promise.all([createDefault, save]);

        expect(written().map((record) => record.name)).toEqual(['Satoshi', 'My own shop']);
      });
    });

    it('keeps the queue moving after a failed write', async () => {
      put.mockRejectedValueOnce(new Error('write failed'));

      await expect(
        CommerceApplication.commitCreateDefaultShop({ ownerPubky: SELLER, profile: PROFILE }),
      ).rejects.toThrow('write failed');
      await CommerceApplication.commitUpsertShop(createCommerceShopFixture({ ownerPubky: SELLER }));

      expect(put).toHaveBeenCalledTimes(2);
      expect(CommerceApplication['shopWrites'].size).toBe(0);
    });
  });
});

describe('CommerceApplication default storefront, with the local database', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    CommerceApplication['shopWrites'].clear();
    await db.initialize();
    await Promise.all([CommerceShopModel.table.clear(), CommerceSyncJobModel.table.clear()]);
    vi.spyOn(CommerceHomeserverService, 'fetchJsonIfFound').mockResolvedValue({ found: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retries after a failed write instead of reading its staged row as a settings save', async () => {
    const put = vi
      .spyOn(CommerceHomeserverService, 'putJson')
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValue(undefined);

    await expect(CommerceApplication.commitCreateDefaultShop({ ownerPubky: SELLER, profile: PROFILE })).rejects.toThrow(
      'offline',
    );
    expect(await LocalCommerceService.getShop(SELLER)).toBeNull();
    expect(await CommerceSyncJobModel.table.count()).toBe(0);
    await expect(CommerceApplication.needsDefaultShop(SELLER)).resolves.toBe(true);

    await CommerceApplication.commitCreateDefaultShop({ ownerPubky: SELLER, profile: PROFILE });

    expect(put).toHaveBeenCalledTimes(2);
    expect(await LocalCommerceService.getShop(SELLER)).toMatchObject({
      sync_status: 'synced',
      record: { name: 'Satoshi' },
    });
  });

  it('keeps a failed settings save pending, as before', async () => {
    vi.spyOn(CommerceHomeserverService, 'putJson').mockRejectedValue(new TypeError('offline'));
    const saved = createCommerceShopFixture({ ownerPubky: SELLER, name: 'My own shop' });

    await expect(CommerceApplication.commitUpsertShop(saved)).rejects.toThrow('offline');

    expect(await LocalCommerceService.getShop(SELLER)).toMatchObject({ sync_status: 'pending', record: saved });
  });
});
