import type { Session } from '@synonymdev/pubky';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TagKind } from '@/application/tag/tag.types';
import { CommerceController } from '@/controllers/commerce/commerce';
import { getTtlRetryDelayMs } from '@/libs/runtime-config/runtime-config';
import { HomeserverService } from '@/services/homeserver/homeserver';
import { SocialProfileService } from '@/services/homeserver/social-profile';
import { socialNexusServesV1 } from '@/services/nexus/social-v1';
import { useAuthStore } from '@/stores/auth/auth.store';
import { asOpaque } from '@/test-utils/type-assertions';
import { type MarketplaceTagTarget, useMarketplaceTags } from './useMarketplaceTags';

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => [] }));
vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: { fetchListingTags: vi.fn(), fetchShopTags: vi.fn() },
}));
vi.mock('@/services/nexus/social-v1', () => ({ socialNexusServesV1: vi.fn() }));

const owner = 'dzswkfy7ek3bqnoc89jxuqqfbzhjrj6mi8qthgbxxcqkdugm3rio';
const target = { kind: TagKind.SHOP, ownerPubky: owner } as const;
const session = asOpaque<Session>({ info: { publicKey: { z32: () => owner }, capabilities: ['/:rw'] } });

describe('Market community tag controls', () => {
  beforeEach(() => {
    vi.mocked(CommerceController.fetchShopTags).mockReset().mockResolvedValue([]);
    vi.mocked(CommerceController.fetchListingTags).mockReset().mockResolvedValue([]);
    useAuthStore.setState({ currentUserPubky: owner, session, sessionOwner: 'shop' });
    vi.mocked(socialNexusServesV1).mockResolvedValue(true);
  });

  afterEach(() => vi.useRealTimers());

  it('keeps legacy controls available while the public v1 index serves resource tags', async () => {
    vi.spyOn(SocialProfileService, 'getEpoch').mockResolvedValue('legacy');
    const { result } = renderHook(() => useMarketplaceTags(target));
    await waitFor(() => expect(result.current.normalizeLabel('ABC-ЦЕНА')).toBe('abc-цена'));
    expect(result.current.socialHandoffUrl).toBeUndefined();
    expect(CommerceController.fetchShopTags).toHaveBeenCalledWith(owner, owner);
  });

  it('offers the migrated standalone viewer a handoff back to the shop inside App', async () => {
    vi.spyOn(SocialProfileService, 'getEpoch').mockResolvedValue('v1');
    const { result } = renderHook(() => useMarketplaceTags(target));
    await waitFor(() => expect(result.current.socialHandoffUrl).toContain('/shop/'));
    expect(result.current.socialHandoffUrl).toContain(owner);
    expect(CommerceController.fetchShopTags).toHaveBeenCalledWith(owner, owner);
  });

  it('preserves v1 non-ASCII labels for the matching App-owned session', async () => {
    useAuthStore.setState({ sessionOwner: 'host' });
    vi.spyOn(SocialProfileService, 'getEpoch').mockResolvedValue('v1');
    const check = vi.spyOn(HomeserverService, 'canCurrentHostSessionWrite');
    const { result } = renderHook(() => useMarketplaceTags(target));
    await waitFor(() => expect(check).toHaveBeenCalledWith(owner, '/pub/social/v1/'));
    expect(result.current.socialHandoffUrl).toBeUndefined();
    expect(result.current.normalizeLabel('ABC-ЦЕНА')).toBe('abc-ЦЕНА');
  });

  it('recovers write availability after a transient read, then stops retrying', async () => {
    vi.useFakeTimers();
    const profile = vi
      .spyOn(SocialProfileService, 'getEpoch')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue('v1');
    const { result } = renderHook(() => useMarketplaceTags(target));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(result.current.socialHandoffUrl).toBeUndefined();
    expect(profile).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(getTtlRetryDelayMs()));
    expect(result.current.socialHandoffUrl).toContain('/shop/');
    await act(async () => vi.advanceTimersByTimeAsync(2 * getTtlRetryDelayMs()));
    expect(profile).toHaveBeenCalledTimes(2);
    expect(CommerceController.fetchShopTags).toHaveBeenCalledTimes(1);
  });

  it('cancels old retries when the target and viewer change or the hook unmounts', async () => {
    vi.useFakeTimers();
    const oldProfile = Promise.withResolvers<'legacy'>();
    const profile = vi.spyOn(SocialProfileService, 'getEpoch').mockReturnValueOnce(oldProfile.promise);
    vi.mocked(CommerceController.fetchShopTags).mockRejectedValue(new Error('offline'));
    vi.mocked(CommerceController.fetchListingTags).mockRejectedValue(new Error('offline'));
    const initialProps: { item: MarketplaceTagTarget } = { item: target };
    const hook = renderHook(({ item }) => useMarketplaceTags(item), { initialProps });
    await act(async () => vi.advanceTimersByTimeAsync(0));
    act(() => useAuthStore.setState({ currentUserPubky: null, session: null, sessionOwner: null }));
    hook.rerender({ item: { kind: TagKind.LISTING, sellerPubky: owner, listingId: 'boots' } });
    await act(async () => {
      oldProfile.reject(new Error('offline'));
      await vi.advanceTimersByTimeAsync(getTtlRetryDelayMs());
    });
    expect(profile).toHaveBeenCalledTimes(1);
    expect(vi.mocked(CommerceController.fetchShopTags).mock.calls).toEqual([
      [owner, owner],
      [owner, undefined],
    ]);
    expect(vi.mocked(CommerceController.fetchListingTags).mock.calls).toEqual([
      [owner, 'boots', undefined],
      [owner, 'boots', undefined],
    ]);
    hook.unmount();
    await act(async () => vi.advanceTimersByTimeAsync(2 * getTtlRetryDelayMs()));
    expect(CommerceController.fetchListingTags).toHaveBeenCalledTimes(2);
  });
});
