import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import { SELLING_BLOCKED_COUNTRY_MESSAGE } from '@/libs/commerce/region-modes';
import { AppError } from '@/libs/error/error';
import { ClientErrorCode } from '@/libs/error/error.codes';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import { resetRegionState, setRegionModes } from '@/test-utils/region-modes';
import { useMarketplaceShopSettings } from './useMarketplaceShopSettings';

const OWNER = 'y'.repeat(52);

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: { currentUserPubky: string }) => unknown) => selector({ currentUserPubky: OWNER }),
}));

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    getShop: vi.fn(),
    getOrFetchShop: vi.fn(),
    refreshShop: vi.fn(),
    commitUpsertShop: vi.fn(),
    commitCreateMedia: vi.fn(),
  },
}));

vi.mock('@/molecules/Toaster/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/hooks/useMarketplaceMediaUrl/useMarketplaceMediaUrl', async () => {
  return await import('@/test/mocks/marketplace-media-hooks');
});

const LAUNCH = 'EU=blocked,GB=blocked,US=blocked';

async function loadFirstTimeSeller() {
  const hook = renderHook(() => useMarketplaceShopSettings());
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  act(() => {
    hook.result.current.form.setValue('name', 'Quiet Shop');
    hook.result.current.form.setValue('shippingPolicy', 'Ships within a week.');
    hook.result.current.form.setValue('returnPolicy', 'Returns within 14 days.');
    hook.result.current.form.setValue('sellerStatus', 'private');
  });
  return hook;
}

const setCountry = (hook: Awaited<ReturnType<typeof loadFirstTimeSeller>>, countryCode: string) =>
  act(() => hook.result.current.form.setValue('countryCode', countryCode, { shouldDirty: true }));

beforeEach(() => {
  resetRegionState();
  vi.clearAllMocks();
  const missing = new AppError({
    category: ErrorCategory.Client,
    code: ClientErrorCode.NOT_FOUND,
    message: 'No shop',
    service: ErrorService.Homeserver,
    operation: 'getOwnedResponse',
    context: { statusCode: 404 },
  });
  vi.mocked(CommerceController.getOrFetchShop).mockRejectedValue(missing);
  vi.mocked(CommerceController.refreshShop).mockRejectedValue(missing);
  vi.mocked(CommerceController.getShop).mockResolvedValue(null);
});
afterEach(() => resetRegionState());

describe('useMarketplaceShopSettings under the region modes', () => {
  it('starts a new shop with no country, so no blocked country is pre-selected', async () => {
    setRegionModes(LAUNCH);
    const hook = renderHook(() => useMarketplaceShopSettings());
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));

    expect(hook.result.current.form.getValues('countryCode')).toBe('');
    expect(hook.result.current.countryBlocked).toBe(false);
  });

  it.each(['US', 'us', 'DE', 'GB', 'uk'])('refuses %s as the shop country and publishes nothing', async (country) => {
    setRegionModes(LAUNCH);
    const hook = await loadFirstTimeSeller();
    setCountry(hook, country);

    await waitFor(() => expect(hook.result.current.countryBlocked).toBe(true));
    await act(async () => {
      expect(await hook.result.current.submit()).toBe(false);
    });

    expect(hook.result.current.form.getFieldState('countryCode').error?.message).toBe(SELLING_BLOCKED_COUNTRY_MESSAGE);
    expect(CommerceController.commitUpsertShop).not.toHaveBeenCalled();
  });

  it('publishes a shop in a country that is open', async () => {
    setRegionModes(LAUNCH);
    const hook = await loadFirstTimeSeller();
    setCountry(hook, 'ch');

    expect(hook.result.current.countryBlocked).toBe(false);
    await act(async () => {
      expect(await hook.result.current.submit()).toBe(true);
    });
    expect(CommerceController.commitUpsertShop).toHaveBeenCalledWith(
      expect.objectContaining({ location: expect.objectContaining({ countryCode: 'CH' }) }),
    );
  });

  it('lets a seller change a blocked country to an open one and save', async () => {
    setRegionModes(LAUNCH);
    const hook = await loadFirstTimeSeller();
    setCountry(hook, 'US');
    await act(async () => {
      await hook.result.current.submit();
    });
    expect(hook.result.current.form.getFieldState('countryCode').error).toBeDefined();

    setCountry(hook, 'NO');
    await act(async () => {
      expect(await hook.result.current.submit()).toBe(true);
    });
    expect(hook.result.current.form.getFieldState('countryCode').error).toBeUndefined();
  });

  it('keeps any country open to a seller while no region is blocked, the US included', async () => {
    for (const modes of [undefined, 'none', 'EU=nuanced,GB=nuanced,US=nuanced']) {
      setRegionModes(modes);
      vi.mocked(CommerceController.commitUpsertShop).mockClear();
      const hook = await loadFirstTimeSeller();
      setCountry(hook, 'US');
      expect(hook.result.current.countryBlocked).toBe(false);
      await act(async () => {
        expect(await hook.result.current.submit()).toBe(true);
      });
      expect(CommerceController.commitUpsertShop).toHaveBeenCalledTimes(1);
      hook.unmount();
    }
  });
});
