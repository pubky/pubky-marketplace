import { TagResult } from 'pubky-app-specs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TagKind } from '@/application/tag/tag.types';
import { db } from '@/database/franky/franky';
import { HttpMethod } from '@/libs/http/http.types';
import type { Pubky } from '@/models/models.types';
import { buildCompositeId } from '@/models/models.utils';
import { PostCountsModel } from '@/models/post/counts/postCounts';
import { PostTagsModel } from '@/models/post/tags/postTags';
import { UserCountsModel } from '@/models/user/counts/userCounts';
import { UserTagsModel } from '@/models/user/tags/userTags';
import { TagNormalizer } from '@/pipes/tag/tag.normalizer';
import { HomeserverService } from '@/services/homeserver/homeserver';
import { asOpaque } from '@/test-utils/type-assertions';
import type { TTagEventParams } from './tag.types';

// Mock HomeserverService
vi.mock('@/services/homeserver/social-writes', () => ({
  SocialWriteService: { requireEpoch: vi.fn(async () => 'legacy'), getEpoch: vi.fn(async () => 'legacy') },
}));

vi.mock('@/services/homeserver/homeserver', () => ({
  HomeserverService: {
    request: vi.fn(),
    putBlob: vi.fn(),
    getJsonIfFound: vi.fn(),
    canCurrentHostSessionWrite: vi.fn(() => true),
    canCurrentSessionWrite: vi.fn(() => true),
  },
}));

// Mock pubky-app-specs
vi.mock('pubky-app-specs', () => ({
  PubkySpecsBuilder: class {
    createTag(_uri: string, label: string) {
      return {
        tag: { label, toJson: () => ({ label }) },
        meta: { url: `pubky://tagger/pub/pubky.app/tags/${label}` },
      };
    }
  },
  postUriBuilder: (authorId: string, postId: string) => `pubky://${authorId}/pub/pubky.app/posts/${postId}`,
  userUriBuilder: (userId: string) => `pubky://${userId}`,
}));

// Test data
const testData = {
  authorPubky: 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy' as Pubky,
  taggerPubky: 'o1gg96ewuojmopcjbz8895478wdtxtzzuxnfjjz8o8e77csa1ngo' as Pubky,
  taggedUserPubky: 'y4euc88xboik1ev3axy9m9ajuedo8gx1mh1n7ms8zoxm5s1b1h9y' as Pubky,
  postId: 'abc123xyz',
  get postTaggedId() {
    return buildCompositeId({ pubky: this.authorPubky, id: this.postId });
  },
  get userTaggedId() {
    return this.taggedUserPubky;
  },
};

// Helper functions - Generic tag params builder
const createTagParams = (label: string, kind: TagKind): TTagEventParams => ({
  taggedId: kind === TagKind.POST ? testData.postTaggedId : testData.userTaggedId,
  label,
  taggerId: testData.taggerPubky,
  taggedKind: kind,
});

const getSavedTags = async (kind: TagKind) => {
  const id = kind === TagKind.POST ? testData.postTaggedId : testData.userTaggedId;
  const table = kind === TagKind.POST ? PostTagsModel.table : UserTagsModel.table;
  return await table.get(id);
};

const setupExistingTag = async (label: string, kind: TagKind) => {
  const id = kind === TagKind.POST ? testData.postTaggedId : testData.userTaggedId;
  const model = kind === TagKind.POST ? PostTagsModel : UserTagsModel;

  await model.create({
    id,
    tags: [
      {
        label,
        taggers: [testData.taggerPubky],
        taggers_count: 1,
        relationship: true,
      },
    ],
  });
};

describe('TagController', () => {
  let TagController: typeof import('./tag').TagController;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock HomeserverService.request to resolve successfully
    vi.spyOn(HomeserverService, 'request').mockResolvedValue(undefined);

    vi.spyOn(TagNormalizer, 'to').mockImplementation((uri: string, label: string, pubky: Pubky) => {
      return asOpaque<TagResult>({
        tag: { label, toJson: () => ({ label }), free: vi.fn() },
        meta: { url: `pubky://${pubky}/pub/pubky.app/tags/${label}` },
        free: vi.fn(),
      });
    });

    // Initialize database and clear tables
    await db.initialize();
    await db.transaction(
      'rw',
      [PostTagsModel.table, PostCountsModel.table, UserTagsModel.table, UserCountsModel.table],
      async () => {
        await PostTagsModel.table.clear();
        await PostCountsModel.table.clear();
        await UserTagsModel.table.clear();
        await UserCountsModel.table.clear();
      },
    );

    // Import TagController after mocks are set up
    const tagModule = await import('./tag');
    TagController = tagModule.TagController;
  });

  describe('commitCreate', () => {
    describe('POST tags', () => {
      it('should save post tag and sync to homeserver', async () => {
        await TagController.commitCreate(createTagParams('javascript', TagKind.POST));

        const savedTags = await getSavedTags(TagKind.POST);
        expect(savedTags).toBeTruthy();
        expect(savedTags!.tags).toHaveLength(1);
        expect(savedTags!.tags[0].label).toBe('javascript');
        expect(savedTags!.tags[0].taggers_count).toBe(1);
        expect(savedTags!.tags[0].relationship).toBe(true);

        // Verify homeserver sync was called
        expect(HomeserverService.request).toHaveBeenCalledWith({
          method: HttpMethod.PUT,
          url: expect.stringContaining('pubky://'),
          bodyJson: expect.any(Object),
        });
      });

      it('should normalize post tag label (trim and lowercase)', async () => {
        await TagController.commitCreate(createTagParams('  JavaScript  ', TagKind.POST));

        const savedTags = await getSavedTags(TagKind.POST);
        expect(savedTags!.tags[0].label).toBe('javascript');

        // Verify homeserver sync was called
        expect(HomeserverService.request).toHaveBeenCalledWith({
          method: HttpMethod.PUT,
          url: expect.stringContaining('pubky://'),
          bodyJson: expect.any(Object),
        });
      });

      it('should rollback post tag when homeserver create fails', async () => {
        vi.spyOn(HomeserverService, 'request').mockRejectedValueOnce(new Error('Failed to PUT to homeserver: 403'));

        await expect(TagController.commitCreate(createTagParams('javascript', TagKind.POST))).rejects.toThrow(
          'Failed to PUT to homeserver: 403',
        );

        const savedTags = await getSavedTags(TagKind.POST);
        expect(savedTags?.tags ?? []).toHaveLength(0);
      });
    });

    describe('USER tags', () => {
      it('should save user tag and sync to homeserver', async () => {
        await TagController.commitCreate(createTagParams('developer', TagKind.USER));

        const savedTags = await getSavedTags(TagKind.USER);
        expect(savedTags).toBeTruthy();
        expect(savedTags!.tags).toHaveLength(1);
        expect(savedTags!.tags[0].label).toBe('developer');
        expect(savedTags!.tags[0].taggers_count).toBe(1);
        expect(savedTags!.tags[0].relationship).toBe(true);

        expect(HomeserverService.request).toHaveBeenCalledWith({
          method: HttpMethod.PUT,
          url: expect.stringContaining('pubky://'),
          bodyJson: expect.any(Object),
        });
      });

      it('should normalize user tag label (trim and lowercase)', async () => {
        await TagController.commitCreate(createTagParams('  Developer  ', TagKind.USER));

        const savedTags = await getSavedTags(TagKind.USER);
        expect(savedTags!.tags[0].label).toBe('developer');

        expect(HomeserverService.request).toHaveBeenCalledWith({
          method: HttpMethod.PUT,
          url: expect.stringContaining('pubky://'),
          bodyJson: expect.any(Object),
        });
      });

      it('should rollback user tag when homeserver create fails', async () => {
        vi.spyOn(HomeserverService, 'request').mockRejectedValueOnce(new Error('Failed to PUT to homeserver: 403'));

        await expect(TagController.commitCreate(createTagParams('developer', TagKind.USER))).rejects.toThrow(
          'Failed to PUT to homeserver: 403',
        );

        const savedTags = await getSavedTags(TagKind.USER);
        expect(savedTags?.tags ?? []).toHaveLength(0);
      });
    });
  });

  describe('commitDelete', () => {
    describe('POST tags', () => {
      beforeEach(async () => {
        await setupExistingTag('javascript', TagKind.POST);
      });

      it('should remove post tag and sync to homeserver', async () => {
        await TagController.commitDelete(createTagParams('javascript', TagKind.POST));

        const savedTags = await getSavedTags(TagKind.POST);
        expect(savedTags!.tags).toHaveLength(0);

        // Verify homeserver sync was called
        expect(HomeserverService.request).toHaveBeenCalledWith({
          method: HttpMethod.DELETE,
          url: expect.stringContaining('pubky://'),
        });
      });

      it('should normalize post tag label (trim and lowercase)', async () => {
        await TagController.commitDelete(createTagParams('  JavaScript  ', TagKind.POST));

        const savedTags = await getSavedTags(TagKind.POST);
        expect(savedTags!.tags).toHaveLength(0);

        // Verify homeserver sync was called
        expect(HomeserverService.request).toHaveBeenCalledWith({
          method: HttpMethod.DELETE,
          url: expect.stringContaining('pubky://'),
        });
      });

      it('should rollback post tag when homeserver delete fails', async () => {
        vi.spyOn(HomeserverService, 'request').mockRejectedValueOnce(
          new Error('Failed to DELETE from homeserver: 403'),
        );

        await expect(TagController.commitDelete(createTagParams('javascript', TagKind.POST))).rejects.toThrow(
          'Failed to DELETE from homeserver: 403',
        );

        const savedTags = await getSavedTags(TagKind.POST);
        expect(savedTags!.tags).toHaveLength(1);
        expect(savedTags!.tags[0].label).toBe('javascript');
        expect(savedTags!.tags[0].taggers_count).toBe(1);
      });
    });

    describe('USER tags', () => {
      beforeEach(async () => {
        await setupExistingTag('developer', TagKind.USER);
      });

      it('should remove user tag and sync to homeserver', async () => {
        await TagController.commitDelete(createTagParams('developer', TagKind.USER));

        const savedTags = await getSavedTags(TagKind.USER);
        expect(savedTags!.tags).toHaveLength(0);

        expect(HomeserverService.request).toHaveBeenCalledWith({
          method: HttpMethod.DELETE,
          url: expect.stringContaining('pubky://'),
        });
      });

      it('should normalize user tag label (trim and lowercase)', async () => {
        await TagController.commitDelete(createTagParams('  Developer  ', TagKind.USER));

        const savedTags = await getSavedTags(TagKind.USER);
        expect(savedTags!.tags).toHaveLength(0);

        expect(HomeserverService.request).toHaveBeenCalledWith({
          method: HttpMethod.DELETE,
          url: expect.stringContaining('pubky://'),
        });
      });

      it('should rollback user tag when homeserver delete fails', async () => {
        vi.spyOn(HomeserverService, 'request').mockRejectedValueOnce(
          new Error('Failed to DELETE from homeserver: 403'),
        );

        await expect(TagController.commitDelete(createTagParams('developer', TagKind.USER))).rejects.toThrow(
          'Failed to DELETE from homeserver: 403',
        );

        const savedTags = await getSavedTags(TagKind.USER);
        expect(savedTags!.tags).toHaveLength(1);
        expect(savedTags!.tags[0].label).toBe('developer');
        expect(savedTags!.tags[0].taggers_count).toBe(1);
      });
    });
  });

  describe('getViewerUserTagLabels', () => {
    it('answers the labels the viewer put on users, most used first', async () => {
      const viewer = 'o1gg96ewuojmopcjbz8895478wdtxtzzuxnfjjz8o8e77csa1ngo' as Pubky;
      await UserTagsModel.upsert({
        id: 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy' as Pubky,
        tags: [
          { label: 'trusted', taggers: [viewer], taggers_count: 1, relationship: true },
          { label: 'fast', taggers: [viewer], taggers_count: 1, relationship: true },
        ],
      });
      await UserTagsModel.upsert({
        id: 'y4euc88xboik1ev3axy9m9ajuedo8gx1mh1n7ms8zoxm5s1b1h9y' as Pubky,
        tags: [{ label: 'trusted', taggers: [viewer], taggers_count: 1, relationship: true }],
      });

      await expect(TagController.getViewerUserTagLabels(viewer, 8)).resolves.toEqual(['trusted', 'fast']);
    });
  });
});

describe('Market social v1 tags', () => {
  const viewer = 'dzswkfy7ek3bqnoc89jxuqqfbzhjrj6mi8qthgbxxcqkdugm3rio';
  const seller = '8kkppkmiubfq4pxn6f73nqrhhhgkb5xyfprntc9si3np9ydbotto';
  it.each(['same tab', 'another tab'] as const)(
    'does not restore an outgoing viewer’s tag after sign-out in %s during the index-address read',
    async (source) => {
      const { TagController } = await import('./tag');
      const { SocialWriteService } = await import('@/services/homeserver/social-writes');
      const { MarketplaceTagsModel } = await import('@/models/marketplace/tags/marketplaceTags');
      const { endAuthScope } = await import('@/controllers/auth/auth-scope');
      const { bumpAuthEpoch } = await import('@/controllers/auth/auth-epoch');
      const rowId = `shop:${seller}`;
      const params = { taggedId: seller, taggedKind: TagKind.SHOP, taggerId: viewer, label: 'art' };
      const tagUri = `pubky://${viewer}/pub/social/v1/tags/01BHZZZZZZZZZZZZZZZZZZZZZZ.json`;
      vi.mocked(SocialWriteService.requireEpoch).mockResolvedValueOnce('v1');
      const read = Promise.withResolvers<{ found: false }>();
      vi.mocked(HomeserverService.getJsonIfFound).mockClear().mockReturnValueOnce(read.promise);
      vi.mocked(HomeserverService.request).mockClear();
      await MarketplaceTagsModel.upsert({
        id: rowId,
        tags: [{ label: 'art', taggers: [viewer], taggers_count: 1, relationship: true, tag_uri: tagUri }],
      });
      const pending = TagController.commitDelete(params);
      await vi.waitFor(() => expect(HomeserverService.getJsonIfFound).toHaveBeenCalledWith({ url: tagUri }));
      if (source === 'same tab') endAuthScope();
      else bumpAuthEpoch();
      const nextViewerTag = { label: 'new-account', taggers: [seller], taggers_count: 1, relationship: true };
      await MarketplaceTagsModel.upsert({ id: rowId, tags: [nextViewerTag] });
      const cancelled = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      if (source === 'same tab') read.reject(new Error('Owner no longer signed in'));
      else read.resolve({ found: false });
      await cancelled;
      expect((await MarketplaceTagsModel.findById(rowId))?.tags).toEqual([nextViewerTag]);
      expect(HomeserverService.request).not.toHaveBeenCalled();
    },
  );

  it('does not start an outgoing viewer’s local create after the profile lookup completes', async () => {
    const { TagController } = await import('./tag');
    const { SocialWriteService } = await import('@/services/homeserver/social-writes');
    const { MarketplaceTagsModel } = await import('@/models/marketplace/tags/marketplaceTags');
    const { endAuthScope } = await import('@/controllers/auth/auth-scope');
    const lookup = Promise.withResolvers<'v1'>();
    vi.mocked(SocialWriteService.requireEpoch).mockReturnValueOnce(lookup.promise);
    vi.mocked(HomeserverService.putBlob).mockClear();
    const rowId = `shop:${seller}`;
    await MarketplaceTagsModel.table.delete(rowId);
    const pending = TagController.commitCreate({
      taggedId: seller,
      taggedKind: TagKind.SHOP,
      taggerId: viewer,
      label: 'art',
    });
    endAuthScope();
    const cancelled = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    lookup.resolve('v1');
    await cancelled;
    expect(await MarketplaceTagsModel.findById(rowId)).toBeNull();
    expect(HomeserverService.putBlob).not.toHaveBeenCalled();
  });

  it('writes spec bytes under the viewer and preserves the commerce target and non-ASCII case', async () => {
    const { SocialWriteService } = await import('@/services/homeserver/social-writes');
    const { TagController } = await import('./tag');
    const { buildTag, decodeObject } = await import('pubky-social-specs');
    vi.mocked(SocialWriteService.requireEpoch).mockResolvedValueOnce('v1');
    const target = `pubky://${seller}/pub/pubky.app/marketplace/v1/listings/boots`;
    const url = buildTag(viewer, target, 'ABC-ЦЕНА').url;
    await TagController.commitCreate({
      taggedId: `${seller}:boots`,
      taggedKind: TagKind.LISTING,
      taggerId: viewer,
      label: 'ABC-ЦЕНА',
    });
    const put = vi.mocked(HomeserverService.putBlob).mock.calls.at(-1)![0];
    expect(put.url).toBe(url);
    expect(decodeObject(url, put.blob, 'tag')).toMatchObject({ uri: target, label: 'abc-ЦЕНА' });
    const { MarketplaceTagsModel } = await import('@/models/marketplace/tags/marketplaceTags');
    const stored = await MarketplaceTagsModel.findById(`listing:${seller}:boots`);
    expect(stored?.tags[0]?.label).toBe('abc-ЦЕНА');
    vi.mocked(SocialWriteService.requireEpoch).mockResolvedValueOnce('v1');
    await TagController.commitDelete({
      taggedId: `${seller}:boots`,
      taggedKind: TagKind.LISTING,
      taggerId: viewer,
      label: 'abc-ЦЕНА',
    });
    expect(HomeserverService.request).toHaveBeenCalledWith({ method: HttpMethod.DELETE, url });
  });
});
