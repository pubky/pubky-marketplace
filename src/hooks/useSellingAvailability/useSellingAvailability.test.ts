import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import { COMMERCE_UNKNOWN_REGION_MESSAGE, SELLING_BLOCKED_MESSAGE } from '@/libs/commerce/region-modes';
import { useAuthStore } from '@/stores/auth/auth.store';
import { resetRegionState, setRegionModes, stubClientRegion } from '@/test-utils/region-modes';
import { asOpaque } from '@/test-utils/type-assertions';
import { useSellingAvailability } from './useSellingAvailability';

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: { getShop: vi.fn() },
}));

const SELLER = 's'.repeat(52);
const LAUNCH = 'EU=blocked,GB=blocked,US=blocked';

function ownShopIn(countryCode: string | null) {
  vi.mocked(CommerceController.getShop).mockResolvedValue(
    countryCode === null ? null : asOpaque({ record: { location: { countryCode } } }),
  );
}

beforeEach(() => {
  resetRegionState();
  vi.mocked(CommerceController.getShop).mockReset();
  useAuthStore.setState({ currentUserPubky: SELLER });
});
afterEach(() => {
  resetRegionState();
  useAuthStore.setState({ currentUserPubky: null });
});

describe('useSellingAvailability', () => {
  it('is inert and reads nothing while no region is blocked', () => {
    setRegionModes('none');
    const fetchStub = stubClientRegion('US');
    const { result } = renderHook(() => useSellingAvailability());
    expect(result.current).toMatchObject({ active: false, blocked: false, held: false });
    expect(fetchStub).not.toHaveBeenCalled();
    expect(CommerceController.getShop).not.toHaveBeenCalled();
  });

  it('blocks a seller whose IP country is blocked, with the selling line', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('US');
    ownShopIn('CH');
    const { result } = renderHook(() => useSellingAvailability());
    await waitFor(() => expect(result.current.blocked).toBe(true));
    expect(result.current).toMatchObject({ source: 'ip', sellingMessage: SELLING_BLOCKED_MESSAGE });
  });

  it('blocks a seller whose own shop is in a blocked country, even from an open IP country', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('CH');
    ownShopIn('DE');
    const { result } = renderHook(() => useSellingAvailability());
    await waitFor(() => expect(result.current.blocked).toBe(true));
    expect(result.current).toMatchObject({ source: 'declared', sellingMessage: SELLING_BLOCKED_MESSAGE });
  });

  it('lets a seller from an open country with an open shop country sell', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('CH');
    ownShopIn('NO');
    const { result } = renderHook(() => useSellingAvailability());
    await waitFor(() => expect(result.current.checking).toBe(false));
    expect(result.current).toMatchObject({ active: true, blocked: false, held: false });
  });

  it('lets a seller with no shop yet sell from an open country', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('CH');
    ownShopIn(null);
    const { result } = renderHook(() => useSellingAvailability());
    await waitFor(() => expect(result.current.checking).toBe(false));
    expect(result.current.blocked).toBe(false);
  });

  it('blocks a seller whose location is unknown with the unknown-region line', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion(null);
    ownShopIn('CH');
    const { result } = renderHook(() => useSellingAvailability());
    await waitFor(() => expect(result.current.blocked).toBe(true));
    expect(result.current).toMatchObject({ source: 'unknown', sellingMessage: COMMERCE_UNKNOWN_REGION_MESSAGE });
  });
});
