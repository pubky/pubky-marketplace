import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import type { CommerceShopRecord } from '@/libs/commerce/marketplace-records';
import { DEFAULT_SHOP_COUNTRY_CODE } from '@/pipes/commerce/default-shop';
import { CommerceHomeserverService } from '@/services/homeserver/commerce/commerce';
import { LocalCommerceService } from '@/services/local/commerce/commerce';
import { COMMERCE_FIXTURE_SELLER, createCommerceListingFixture } from '@/test/fixtures/commerce/commerce';
import { resetRegionState, setRegionModes } from '@/test-utils/region-modes';
import { CommerceApplication } from './commerce';

const SELLER = COMMERCE_FIXTURE_SELLER;
const PROFILE = { name: 'Satoshi', bio: 'Bitcoin goods.' };
const LAUNCH = 'EU=blocked,GB=blocked,US=blocked';

describe('CommerceApplication default storefront under the region modes', () => {
  let put: MockInstance<typeof CommerceHomeserverService.putJson>;

  beforeEach(() => {
    vi.restoreAllMocks();
    resetRegionState();
    CommerceApplication['shopWrites'].clear();
    vi.spyOn(LocalCommerceService, 'getShop').mockResolvedValue(null);
    vi.spyOn(LocalCommerceService, 'getListingsBySeller').mockResolvedValue([]);
    vi.spyOn(LocalCommerceService, 'stageShopSync').mockResolvedValue(undefined);
    vi.spyOn(LocalCommerceService, 'upsertShop').mockResolvedValue(undefined);
    vi.spyOn(LocalCommerceService, 'completeSyncJob').mockResolvedValue(undefined);
    vi.spyOn(CommerceHomeserverService, 'fetchJsonIfFound').mockResolvedValue({ found: false });
    put = vi.spyOn(CommerceHomeserverService, 'putJson').mockResolvedValue(undefined);
  });
  afterEach(() => {
    resetRegionState();
    vi.restoreAllMocks();
  });

  const written = () => put.mock.calls.map(([, record]) => record as CommerceShopRecord);

  it('publishes no default shop in the default country while that country is blocked', async () => {
    expect(DEFAULT_SHOP_COUNTRY_CODE).toBe('US');
    setRegionModes(LAUNCH);

    await CommerceApplication.commitCreateDefaultShop({ ownerPubky: SELLER, profile: PROFILE });

    expect(put).not.toHaveBeenCalled();
  });

  it('still publishes the shop of a seller whose listing says where it is', async () => {
    setRegionModes(LAUNCH);
    vi.mocked(LocalCommerceService.getListingsBySeller).mockResolvedValue([
      { record: createCommerceListingFixture({ location: { countryCode: 'CA' } }) },
    ] as Awaited<ReturnType<typeof LocalCommerceService.getListingsBySeller>>);

    await CommerceApplication.commitCreateDefaultShop({ ownerPubky: SELLER, profile: PROFILE });

    expect(written()[0].location).toEqual({ countryCode: 'CA' });
  });

  it('still publishes the shop of a seller with a known country, as the seller said', async () => {
    setRegionModes(LAUNCH);

    await CommerceApplication.commitCreateDefaultShop({
      ownerPubky: SELLER,
      profile: PROFILE,
      location: { countryCode: 'DE' },
    });

    expect(written()[0].location).toEqual({ countryCode: 'DE' });
  });

  it.each([undefined, 'none', 'EU=blocked,GB=blocked', 'EU=nuanced,GB=nuanced,US=nuanced'])(
    'keeps the US as the default country while it is not blocked (modes: %s)',
    async (modes) => {
      setRegionModes(modes);
      put.mockClear();

      await CommerceApplication.commitCreateDefaultShop({ ownerPubky: SELLER, profile: PROFILE });

      expect(written()[0].location).toEqual({ countryCode: 'US' });
    },
  );
});
