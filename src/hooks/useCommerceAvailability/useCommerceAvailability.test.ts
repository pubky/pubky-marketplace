import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BUYING_FROM_BLOCKED_SHOP_MESSAGE,
  COMMERCE_BLOCKED_INFO,
  COMMERCE_BLOCKED_MESSAGE,
  COMMERCE_UNKNOWN_REGION_MESSAGE,
} from '@/libs/commerce/region-modes';
import { useBuyerCountryStore } from '@/stores/buyer-country/buyer-country.store';
import { resetRegionState, setRegionModes, stubClientRegion } from '@/test-utils/region-modes';
import { useCommerceAvailability } from './useCommerceAvailability';

const LAUNCH = 'EU=blocked,GB=blocked,US=blocked';

beforeEach(() => resetRegionState());
afterEach(() => resetRegionState());

describe('useCommerceAvailability', () => {
  it('is inert and asks nothing while no region is blocked', () => {
    setRegionModes('EU=nuanced,GB=nuanced');
    const fetchStub = stubClientRegion('US');
    const { result } = renderHook(() => useCommerceAvailability());
    expect(result.current).toMatchObject({ active: false, checking: false, blocked: false, held: false });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('holds commerce, silently, until the visitor region is read, then blocks a blocked IP country', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('US');
    const { result } = renderHook(() => useCommerceAvailability());
    expect(result.current).toMatchObject({ checking: true, held: true, blocked: false, message: null });
    await waitFor(() => expect(result.current.blocked).toBe(true));
    expect(result.current).toMatchObject({
      checking: false,
      held: true,
      source: 'ip',
      message: COMMERCE_BLOCKED_MESSAGE,
      info: COMMERCE_BLOCKED_INFO,
    });
  });

  it('lets a visitor from an open country buy', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('CH');
    const { result } = renderHook(() => useCommerceAvailability());
    await waitFor(() => expect(result.current.checking).toBe(false));
    expect(result.current).toMatchObject({ active: true, blocked: false, held: false, message: null });
  });

  it('blocks at once a visitor who declared a blocked country, even from an open IP country', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('CH');
    useBuyerCountryStore.setState({ country: 'DE' });
    const { result } = renderHook(() => useCommerceAvailability());
    expect(result.current).toMatchObject({ blocked: true, source: 'declared' });
  });

  it('blocks a visitor whose country is unknown, or whose lookup failed, with the unknown-region line', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion(null);
    const unknown = renderHook(() => useCommerceAvailability());
    await waitFor(() => expect(unknown.result.current.blocked).toBe(true));
    expect(unknown.result.current).toMatchObject({ source: 'unknown', message: COMMERCE_UNKNOWN_REGION_MESSAGE });
    unknown.unmount();

    resetRegionState();
    setRegionModes(LAUNCH);
    stubClientRegion('fail');
    const failed = renderHook(() => useCommerceAvailability());
    await waitFor(() => expect(failed.result.current.blocked).toBe(true));
    expect(failed.result.current).toMatchObject({ source: 'unknown', message: COMMERCE_UNKNOWN_REGION_MESSAGE });
  });

  it('blocks commerce with a seller whose shop is in a blocked country', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('CH');
    const { result } = renderHook(() => useCommerceAvailability({ sellerCountry: 'US' }));
    await waitFor(() => expect(result.current.blocked).toBe(true));
    expect(result.current).toMatchObject({ source: 'seller', message: BUYING_FROM_BLOCKED_SHOP_MESSAGE });
  });
});
