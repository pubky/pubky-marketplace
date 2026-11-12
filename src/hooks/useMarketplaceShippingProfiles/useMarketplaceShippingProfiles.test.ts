import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import { toast } from '@/molecules/Toaster/toast';
import { useAuthStore } from '@/stores/auth/auth.store';
import { mockAuthStore } from '@/test-utils/stores';
import { asOpaque } from '@/test-utils/type-assertions';
import { useMarketplaceShippingProfiles } from './useMarketplaceShippingProfiles';

const OWNER = 'o'.repeat(52);

vi.mock('@/stores/auth/auth.store', () => ({ useAuthStore: vi.fn() }));
vi.mock('@/molecules/Toaster/toast', () => ({ toast: vi.fn() }));
vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    listShippingProfiles: vi.fn(),
    putShippingProfile: vi.fn(),
    deleteShippingProfile: vi.fn(),
    countListingsUsingShippingProfile: vi.fn(),
    refreshListingsBySeller: vi.fn(),
    getListingsBySeller: vi.fn(),
  },
}));

const INPUT = asOpaque<Parameters<ReturnType<typeof useMarketplaceShippingProfiles>['save']>[1]>({
  name: 'Worldwide',
  currency: 'USD',
  exponent: 2,
  origins: ['US'],
  excludedCountries: [],
  zones: [
    {
      zoneId: 'us',
      name: 'United States',
      countries: ['US'],
      rates: [{ pricing: 'free', rateId: 'f', label: 'Free', estimatedMinDays: 1, estimatedMaxDays: 2 }],
    },
  ],
});

function listing(profileCount: number, overrides: Record<string, unknown> = {}) {
  return {
    profiles: Array.from({ length: profileCount }, (_, index) => ({
      sha256: 'a'.repeat(64),
      record: { profileId: `p${index}` },
    })),
    unreadable: [] as string[],
    truncated: false,
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuthStore).mockImplementation((selector) => selector(mockAuthStore({ currentUserPubky: OWNER })));
  vi.mocked(CommerceController.putShippingProfile).mockResolvedValue({} as never);
});

async function ready(listed = listing(1)) {
  vi.mocked(CommerceController.listShippingProfiles).mockResolvedValue(listed);
  const hook = renderHook(() => useMarketplaceShippingProfiles());
  await waitFor(() => expect(hook.result.current.state.status).toBe('ready'));
  return hook;
}

describe('useMarketplaceShippingProfiles remove', () => {
  it('counts the listings on the homeserver, not the indexed ones, and refuses while one uses the profile', async () => {
    vi.mocked(CommerceController.getListingsBySeller).mockResolvedValue([]);
    vi.mocked(CommerceController.countListingsUsingShippingProfile).mockResolvedValue(2);
    const { result } = await ready();

    let removed = true;
    await act(async () => {
      removed = await result.current.remove('p0');
    });

    expect(removed).toBe(false);
    expect(CommerceController.countListingsUsingShippingProfile).toHaveBeenCalledWith(OWNER, 'p0');
    expect(CommerceController.refreshListingsBySeller).not.toHaveBeenCalled();
    expect(CommerceController.deleteShippingProfile).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining('2 listings') }));
  });

  it('does not delete when the listings cannot be read', async () => {
    vi.mocked(CommerceController.countListingsUsingShippingProfile).mockRejectedValue(new Error('offline'));
    const { result } = await ready();

    let removed = true;
    await act(async () => {
      removed = await result.current.remove('p0');
    });

    expect(removed).toBe(false);
    expect(CommerceController.deleteShippingProfile).not.toHaveBeenCalled();
  });

  it('deletes a profile no listing uses', async () => {
    vi.mocked(CommerceController.countListingsUsingShippingProfile).mockResolvedValue(0);
    const { result } = await ready();

    await act(async () => {
      await result.current.remove('p0');
    });

    expect(CommerceController.deleteShippingProfile).toHaveBeenCalledWith(OWNER, 'p0');
  });
});

describe('useMarketplaceShippingProfiles save', () => {
  it('refuses a new profile when unreadable files fill the directory to the cap', async () => {
    const { result } = await ready(
      listing(30, { unreadable: Array.from({ length: 20 }, (_, index) => `bad${index}`) }),
    );

    let saved = true;
    await act(async () => {
      saved = await result.current.save(null, INPUT);
    });

    expect(saved).toBe(false);
    expect(CommerceController.putShippingProfile).not.toHaveBeenCalled();
  });

  it('refuses a new profile when the directory listing was truncated', async () => {
    const { result } = await ready(listing(3, { truncated: true }));

    await act(async () => {
      await result.current.save(null, INPUT);
    });

    expect(CommerceController.putShippingProfile).not.toHaveBeenCalled();
  });

  it('refuses a new profile before the existing ones have been read', async () => {
    vi.mocked(CommerceController.listShippingProfiles).mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useMarketplaceShippingProfiles());
    await waitFor(() => expect(result.current.state.status).toBe('error'));

    await act(async () => {
      await result.current.save(null, INPUT);
    });

    expect(CommerceController.putShippingProfile).not.toHaveBeenCalled();
  });

  it('saves a new profile when there is room', async () => {
    const { result } = await ready(listing(3));

    let saved = false;
    await act(async () => {
      saved = await result.current.save(null, INPUT);
    });

    expect(saved).toBe(true);
    expect(CommerceController.putShippingProfile).toHaveBeenCalledTimes(1);
  });
});
