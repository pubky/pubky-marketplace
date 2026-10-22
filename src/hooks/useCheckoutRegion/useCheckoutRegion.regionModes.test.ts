import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import { REGION_UNAVAILABLE_MESSAGE } from '@/libs/commerce/eu-region';
import { BUYING_FROM_BLOCKED_SHOP_MESSAGE, COMMERCE_BLOCKED_MESSAGE } from '@/libs/commerce/region-modes';
import { useBuyerCountryStore } from '@/stores/buyer-country/buyer-country.store';
import { resetRegionState, setRegionModes, stubClientRegion } from '@/test-utils/region-modes';
import { useCheckoutRegion } from './useCheckoutRegion';

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    setBuyerCountry: vi.fn((code: string | null) => useBuyerCountryStore.getState().setCountry(code)),
    refreshShopOrGetCached: vi.fn(),
    getSellerAnnualLimit: vi.fn(),
  },
}));

const SELLER_US = 'u'.repeat(52);
const SELLER_CH = 'c'.repeat(52);
const BUYER = 'b'.repeat(52);
const LAUNCH = 'EU=blocked,GB=blocked,US=blocked';

const shops: Record<string, { sellerStatus: string; location: { countryCode: string } }> = {
  [SELLER_US]: { sellerStatus: 'private', location: { countryCode: 'US' } },
  [SELLER_CH]: { sellerStatus: 'private', location: { countryCode: 'CH' } },
};

const region = (sellers: string[], requiresDeliveryAddress = true) =>
  renderHook(() =>
    useCheckoutRegion({
      sellerPubkys: sellers,
      hasDigital: false,
      requiresDeliveryAddress,
      addressCountry: 'CH',
      currentUserPubky: BUYER,
    }),
  );

beforeEach(() => {
  resetRegionState();
  vi.mocked(CommerceController.refreshShopOrGetCached).mockImplementation(
    async (pubky) => shops[String(pubky)] as never,
  );
  vi.mocked(CommerceController.getSellerAnnualLimit).mockResolvedValue({ enabled: true, limitReached: false });
});
afterEach(() => resetRegionState());

describe('useCheckoutRegion under the region modes', () => {
  it('keeps Pay disabled, silently, while the visitor region is read, then lets an open-country visitor through', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('CH');
    const { result } = region([SELLER_CH]);
    expect(result.current.blocked).toBe(true);
    expect(result.current.commerce).toMatchObject({ checking: true, blocked: false });
    await waitFor(() => expect(result.current.blocked).toBe(false));
    expect(result.current.commerce).toMatchObject({ active: true, blocked: false, held: false });
  });

  it('blocks Pay for a visitor in a blocked region and says why once', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('US');
    const { result } = region([SELLER_CH]);
    await waitFor(() => expect(result.current.commerce.blocked).toBe(true));
    expect(result.current).toMatchObject({ blocked: true, refusal: null, needsCountryField: false });
    expect(result.current.commerce.message).toBe(COMMERCE_BLOCKED_MESSAGE);
  });

  it('blocks Pay when a seller in the cart has a shop in a blocked country', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('CH');
    const { result } = region([SELLER_CH, SELLER_US]);
    await waitFor(() => expect(result.current.commerce.blocked).toBe(true));
    expect(result.current.blocked).toBe(true);
    expect(result.current.commerce.message).toBe(BUYING_FROM_BLOCKED_SHOP_MESSAGE);
  });

  it('blocks Pay for a remembered blocked country', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('CH');
    useBuyerCountryStore.setState({ country: 'DE' });
    const { result } = region([SELLER_CH], false);
    expect(result.current.commerce).toMatchObject({ blocked: true, source: 'declared' });
    expect(result.current.blocked).toBe(true);
  });

  it('keeps the nuanced fence for a nuanced region in a mixed policy', async () => {
    setRegionModes('EU=nuanced,GB=nuanced,US=blocked');
    stubClientRegion('CH');
    shops[SELLER_CH] = { sellerStatus: 'trader', location: { countryCode: 'CH' } };
    const { result } = renderHook(() =>
      useCheckoutRegion({
        sellerPubkys: [SELLER_CH],
        hasDigital: false,
        requiresDeliveryAddress: true,
        addressCountry: 'DE',
        currentUserPubky: BUYER,
      }),
    );
    await waitFor(() => expect(result.current.refusal).toBe(REGION_UNAVAILABLE_MESSAGE));
    expect(result.current.commerce.blocked).toBe(false);
    shops[SELLER_CH] = { sellerStatus: 'private', location: { countryCode: 'CH' } };
  });

  it('is unchanged, and asks nothing, while no region is blocked', async () => {
    setRegionModes('EU=nuanced,GB=nuanced');
    const fetchStub = stubClientRegion('US');
    const { result } = region([SELLER_US]);
    await waitFor(() => expect(result.current.declarations[SELLER_US]).toBe('private'));
    expect(result.current.commerce).toMatchObject({ active: false, held: false });
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
