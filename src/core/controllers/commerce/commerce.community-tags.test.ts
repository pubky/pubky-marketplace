import type { Session } from '@synonymdev/pubky';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bumpAuthEpoch } from '@/controllers/auth/auth-epoch';
import { endAuthScope } from '@/controllers/auth/auth-scope';
import { MarketplaceTagsModel } from '@/models/marketplace/tags/marketplaceTags';
import { type MarketplaceTagPage, NexusMarketplaceService } from '@/services/nexus/marketplace/marketplace';
import { useAuthStore } from '@/stores/auth/auth.store';
import { asOpaque } from '@/test-utils/type-assertions';
import { CommerceController } from './commerce';

const seller = '8kkppkmiubfq4pxn6f73nqrhhhgkb5xyfprntc9si3np9ydbotto';
const viewer = 'dzswkfy7ek3bqnoc89jxuqqfbzhjrj6mi8qthgbxxcqkdugm3rio';
const tag = { label: 'handmade', taggers: [], taggers_count: 1, relationship: false };
const oldPage = {
  tags: [{ ...tag, relationship: true, tag_uri: `pubky://${viewer}/pub/social/v1/tags/old.json` }],
  completeResource: true,
};
const activePage = { tags: [tag], completeResource: true };

describe('community tag reads across account changes', () => {
  beforeEach(() => useAuthStore.setState({ currentUserPubky: viewer, session: asOpaque<Session>({}) }));
  afterEach(() => {
    useAuthStore.getState().reset();
  });

  it.each([
    ['the same viewer refreshes again', () => {}],
    ['the host ends this auth scope', () => endAuthScope()],
    ['another tab signs out', () => bumpAuthEpoch()],
    ['the viewer is replaced', () => useAuthStore.setState({ currentUserPubky: seller })],
    ['the same viewer receives a replacement session', () => useAuthStore.setState({ session: asOpaque<Session>({}) })],
  ])('a delayed reply cannot replace the active viewer relationship when %s', async (_event, switchAccount) => {
    const pending = Promise.withResolvers<MarketplaceTagPage>();
    vi.spyOn(NexusMarketplaceService, 'fetchShopTags')
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(activePage);
    const first = CommerceController.fetchShopTags(seller, viewer);
    switchAccount();
    await CommerceController.fetchShopTags(seller, useAuthStore.getState().currentUserPubky!);
    pending.resolve(oldPage);
    await expect(first).resolves.toEqual([]);
    expect(await CommerceController.getShopTags(seller)).toEqual([tag]);
  });

  it('skips a retry scheduled for a previous viewer', async () => {
    const fetch = vi.spyOn(NexusMarketplaceService, 'fetchShopTags').mockResolvedValue(oldPage);
    useAuthStore.setState({ currentUserPubky: seller });
    await expect(CommerceController.fetchShopTags(seller, viewer)).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('discards a guest listing response if sign-in starts before its cache write', async () => {
    useAuthStore.getState().reset();
    vi.spyOn(NexusMarketplaceService, 'fetchListingTags').mockResolvedValue(activePage);
    vi.spyOn(MarketplaceTagsModel, 'findById').mockImplementationOnce(async () => {
      useAuthStore.setState({ currentUserPubky: viewer, session: asOpaque<Session>({}) });
      return null;
    });
    await expect(CommerceController.fetchListingTags(seller, 'boots')).resolves.toEqual([]);
    expect(await CommerceController.getListingTags(seller, 'boots')).toEqual([]);
  });
});
