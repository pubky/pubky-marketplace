import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
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

describe('CommerceApplication.ensureDefaultShop', () => {
  let localShop: MockInstance<typeof LocalCommerceService.getShop>;
  let published: MockInstance<typeof CommerceHomeserverService.fetchJsonIfFound>;
  let upsert: MockInstance<typeof CommerceApplication.commitUpsertShop>;
  let loadProfile: ReturnType<typeof vi.fn<() => Promise<typeof PROFILE | null>>>;

  beforeEach(() => {
    vi.restoreAllMocks();
    CommerceApplication['defaultShopSession'].clear();
    localShop = vi.spyOn(LocalCommerceService, 'getShop').mockResolvedValue(null);
    vi.spyOn(LocalCommerceService, 'getListingsBySeller').mockResolvedValue([]);
    published = vi.spyOn(CommerceHomeserverService, 'fetchJsonIfFound').mockResolvedValue({ found: false });
    upsert = vi.spyOn(CommerceApplication, 'commitUpsertShop').mockResolvedValue(undefined);
    loadProfile = vi.fn<() => Promise<typeof PROFILE | null>>().mockResolvedValue(PROFILE);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('publishes a storefront from the profile when the seller has none', async () => {
    await CommerceApplication.ensureDefaultShop({
      ownerPubky: SELLER,
      loadProfile,
      location: { countryCode: 'DE' },
    });

    expect(published).toHaveBeenCalledWith(CommerceRecordNormalizer.shopUri(SELLER));
    expect(upsert).toHaveBeenCalledOnce();
    const record = upsert.mock.calls[0][0];
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

    await CommerceApplication.ensureDefaultShop({ ownerPubky: SELLER, loadProfile });

    expect(upsert.mock.calls[0][0].location).toEqual({ countryCode: 'CA' });
  });

  it('never overwrites a published shop', async () => {
    published.mockResolvedValue({ found: true, json: createCommerceShopFixture() });

    await CommerceApplication.ensureDefaultShop({ ownerPubky: SELLER, loadProfile });

    expect(loadProfile).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('never overwrites a local shop, saved or mid-save', async () => {
    localShop.mockResolvedValue(asOpaque<ShopRow>({ ...shopRow, sync_status: 'pending' }));

    await CommerceApplication.ensureDefaultShop({ ownerPubky: SELLER, loadProfile });

    expect(published).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('yields to a settings save that started while the profile loaded', async () => {
    localShop.mockResolvedValueOnce(null).mockResolvedValue(shopRow);

    await CommerceApplication.ensureDefaultShop({ ownerPubky: SELLER, loadProfile });

    expect(upsert).not.toHaveBeenCalled();
  });

  it('does not write when the homeserver cannot be read', async () => {
    published.mockRejectedValue(new Error('homeserver down'));

    await expect(CommerceApplication.ensureDefaultShop({ ownerPubky: SELLER, loadProfile })).rejects.toThrow(
      'homeserver down',
    );
    expect(upsert).not.toHaveBeenCalled();
  });

  it('checks once per seller per session and retries after a failure', async () => {
    upsert.mockRejectedValueOnce(new Error('write failed'));

    await expect(CommerceApplication.ensureDefaultShop({ ownerPubky: SELLER, loadProfile })).rejects.toThrow(
      'write failed',
    );
    await CommerceApplication.ensureDefaultShop({ ownerPubky: SELLER, loadProfile });
    await Promise.all([
      CommerceApplication.ensureDefaultShop({ ownerPubky: SELLER, loadProfile }),
      CommerceApplication.ensureDefaultShop({ ownerPubky: SELLER, loadProfile }),
    ]);

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(published).toHaveBeenCalledTimes(2);
  });
});
