import type { Session } from '@synonymdev/pubky';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TagKind } from '@/application/tag/tag.types';
import { CommerceController } from '@/controllers/commerce/commerce';
import { HomeserverService } from '@/services/homeserver/homeserver';
import { SocialProfileService } from '@/services/homeserver/social-profile';
import { socialNexusServesV1 } from '@/services/nexus/social-v1';
import { useAuthStore } from '@/stores/auth/auth.store';
import { asOpaque } from '@/test-utils/type-assertions';
import { useMarketplaceTags } from './useMarketplaceTags';

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => [] }));
vi.mock('@/controllers/commerce/commerce', () => ({ CommerceController: { fetchShopTags: vi.fn() } }));
vi.mock('@/services/nexus/social-v1', () => ({ socialNexusServesV1: vi.fn() }));

const owner = 'dzswkfy7ek3bqnoc89jxuqqfbzhjrj6mi8qthgbxxcqkdugm3rio';
const target = { kind: TagKind.SHOP, ownerPubky: owner } as const;
const session = asOpaque<Session>({ info: { publicKey: { z32: () => owner }, capabilities: ['/:rw'] } });

describe('Market community tag controls', () => {
  beforeEach(() => {
    useAuthStore.setState({ currentUserPubky: owner, session, sessionOwner: 'shop' });
    vi.mocked(socialNexusServesV1).mockResolvedValue(true);
  });

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
});
