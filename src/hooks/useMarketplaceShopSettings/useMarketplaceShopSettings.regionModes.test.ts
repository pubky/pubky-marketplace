import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import type { CommerceShopRecord } from '@/libs/commerce/marketplace-records';
import {
  SELLING_BLOCKED_COUNTRY_MESSAGE,
  SHOP_COUNTRY_CHECKING_MESSAGE,
  SHOP_COUNTRY_LOCKED_MESSAGE,
  SHOP_COUNTRY_LOCKED_UNKNOWN_MESSAGE,
} from '@/libs/commerce/region-modes';
import { AppError } from '@/libs/error/error';
import { ClientErrorCode } from '@/libs/error/error.codes';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import { createCommerceShopFixture } from '@/test/fixtures/commerce/commerce';
import { resetRegionState, setRegionModes, stubClientRegion } from '@/test-utils/region-modes';
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

describe('the shop country of a shop that already has one', () => {
  async function loadExistingSeller(countryCode: string) {
    vi.mocked(CommerceController.refreshShop).mockResolvedValue(
      createCommerceShopFixture({ ownerPubky: OWNER, location: { countryCode } }),
    );
    const hook = renderHook(() => useMarketplaceShopSettings());
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    act(() => hook.result.current.form.setValue('sellerStatus', 'private'));
    return hook;
  }

  const save = async (hook: Awaited<ReturnType<typeof loadExistingSeller>>) => {
    let saved = false;
    await act(async () => {
      saved = await hook.result.current.submit();
    });
    return saved;
  };

  const savedCountry = () =>
    (vi.mocked(CommerceController.commitUpsertShop).mock.calls[0]?.[0] as CommerceShopRecord | undefined)?.location
      .countryCode;

  it('cannot be changed from a visitor region inside the block, and publishes nothing', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('DE');
    const hook = await loadExistingSeller('CH');
    await waitFor(() => expect(hook.result.current.countryLockedMessage).toBe(SHOP_COUNTRY_LOCKED_MESSAGE));

    setCountry(hook, 'NO');
    expect(await save(hook)).toBe(false);

    expect(hook.result.current.countryLocked).toBe(true);
    expect(hook.result.current.form.getFieldState('countryCode').error?.message).toBe(SHOP_COUNTRY_LOCKED_MESSAGE);
    expect(CommerceController.commitUpsertShop).not.toHaveBeenCalled();
  });

  it('keeps a blocked shop country in place from a blocked region, even when the new one is open', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('US');
    const hook = await loadExistingSeller('GB');
    await waitFor(() => expect(hook.result.current.countryLocked).toBe(true));

    setCountry(hook, 'CH');
    expect(await save(hook)).toBe(false);

    expect(hook.result.current.form.getFieldState('countryCode').error?.message).toBe(SHOP_COUNTRY_LOCKED_MESSAGE);
    expect(CommerceController.commitUpsertShop).not.toHaveBeenCalled();
  });

  it('still saves the rest of the shop from a blocked region while the country stays as it is', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('DE');
    const hook = await loadExistingSeller('CH');
    await waitFor(() => expect(hook.result.current.countryLocked).toBe(true));

    act(() => hook.result.current.form.setValue('name', 'Renamed Shop', { shouldDirty: true }));
    setCountry(hook, 'ch');
    expect(await save(hook)).toBe(true);

    expect(savedCountry()).toBe('CH');
    expect(CommerceController.commitUpsertShop).toHaveBeenCalledWith(expect.objectContaining({ name: 'Renamed Shop' }));
  });

  it('lets a shop whose saved code names no country be given a real one from a blocked region', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('DE');
    const hook = await loadExistingSeller('ZZ');
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    expect(hook.result.current.countryLocked).toBe(false);
    expect(hook.result.current.countryLockedMessage).toBeNull();

    setCountry(hook, 'CH');
    expect(await save(hook)).toBe(true);

    expect(savedCountry()).toBe('CH');
  });

  it('keeps a saved UK locked from a blocked region, since it names a country (GB)', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('DE');
    const hook = await loadExistingSeller('UK');
    await waitFor(() => expect(hook.result.current.countryLockedMessage).toBe(SHOP_COUNTRY_LOCKED_MESSAGE));

    setCountry(hook, 'CH');
    expect(await save(hook)).toBe(false);

    expect(hook.result.current.countryLocked).toBe(true);
    expect(CommerceController.commitUpsertShop).not.toHaveBeenCalled();
  });

  it('moves a blocked shop country to an open one from a visitor region outside the block', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('CH');
    const hook = await loadExistingSeller('US');
    await waitFor(() => expect(hook.result.current.countryLocked).toBe(false));
    expect(hook.result.current.countryLockedMessage).toBeNull();

    setCountry(hook, 'NO');
    expect(await save(hook)).toBe(true);

    expect(savedCountry()).toBe('NO');
  });

  it('still refuses a blocked new country from a visitor region outside the block', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('CH');
    const hook = await loadExistingSeller('NO');
    await waitFor(() => expect(hook.result.current.countryLocked).toBe(false));

    setCountry(hook, 'DE');
    expect(await save(hook)).toBe(false);

    expect(hook.result.current.form.getFieldState('countryCode').error?.message).toBe(SELLING_BLOCKED_COUNTRY_MESSAGE);
    expect(CommerceController.commitUpsertShop).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown visitor region', null],
    ['a visitor region that could not be read', 'fail' as const],
  ])('cannot be changed from %s while unknown visitors are blocked', async (_label, answer) => {
    setRegionModes(LAUNCH);
    stubClientRegion(answer);
    const hook = await loadExistingSeller('CH');
    await waitFor(() => expect(hook.result.current.countryLockedMessage).toBe(SHOP_COUNTRY_LOCKED_UNKNOWN_MESSAGE));

    setCountry(hook, 'NO');
    expect(await save(hook)).toBe(false);

    expect(hook.result.current.form.getFieldState('countryCode').error?.message).toBe(
      SHOP_COUNTRY_LOCKED_UNKNOWN_MESSAGE,
    );
    expect(CommerceController.commitUpsertShop).not.toHaveBeenCalled();
  });

  it('changes from an unknown visitor region where unknown visitors are not blocked', async () => {
    setRegionModes('US=blocked,UNKNOWN=open');
    stubClientRegion(null);
    const hook = await loadExistingSeller('CH');
    await waitFor(() => expect(hook.result.current.countryLocked).toBe(false));

    setCountry(hook, 'NO');
    expect(await save(hook)).toBe(true);
  });

  it('waits for the visitor region before it lets the country change', async () => {
    setRegionModes(LAUNCH);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    const hook = await loadExistingSeller('CH');

    expect(hook.result.current.countryLockedMessage).toBe(SHOP_COUNTRY_CHECKING_MESSAGE);
    setCountry(hook, 'NO');
    expect(await save(hook)).toBe(false);
    expect(CommerceController.commitUpsertShop).not.toHaveBeenCalled();
  });

  it.each([undefined, 'none', 'EU=nuanced,GB=nuanced,US=nuanced'])(
    'is never locked while no region is blocked (%s)',
    async (modes) => {
      setRegionModes(modes);
      const fetchStub = stubClientRegion('DE');
      const hook = await loadExistingSeller('CH');

      expect(hook.result.current.countryLocked).toBe(false);
      setCountry(hook, 'US');
      expect(await save(hook)).toBe(true);
      expect(fetchStub).not.toHaveBeenCalled();
    },
  );

  it('lets a first-time seller choose a country from any region, since there is nothing to move', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('DE');
    const hook = await loadFirstTimeSeller();
    setCountry(hook, 'CH');

    expect(hook.result.current.countryLocked).toBe(false);
    expect(await save(hook)).toBe(true);
  });
});
