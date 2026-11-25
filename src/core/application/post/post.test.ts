import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostApplication } from '@/application/post/post';
import { PostStreamApplication } from '@/application/stream/posts/post';
import type { TFetchPostTaggersParams } from '@/controllers/post/post.types';
import type { Pubky } from '@/models/models.types';
import type { PostCountsModelSchema } from '@/models/post/counts/postCounts.schema';
import type { PostDetailsModelSchema } from '@/models/post/details/postDetails.schema';
import type { TagCollectionModelSchema } from '@/models/shared/tag/tag.schema';
import { LocalPostService } from '@/services/local/post/post';
import { LocalPostTagService } from '@/services/local/tag/post/tag.post';
import type { NexusTag, NexusTaggers } from '@/services/nexus/nexus.types';
import { NexusPostService } from '@/services/nexus/post/post';

vi.mock('@/services/local/post/post', () => ({
  LocalPostService: {
    readDetails: vi.fn(),
    readCounts: vi.fn(),
    readTags: vi.fn(),
  },
}));

vi.mock('@/services/local/tag/post/tag.post', () => ({
  LocalPostTagService: {
    mergeTags: vi.fn(),
  },
}));

describe('Post Application', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetch', () => {
    const mockPostDetails: PostDetailsModelSchema = {
      id: 'author:post123',
      content: 'Test post',
      kind: 'short',
      uri: 'pubky://author/pub/pubky.app/posts/post123',
      indexed_at: Date.now(),
      attachments: null,
    };

    it('should fetch post from Nexus and return persisted data', async () => {
      const mockViewerId = 'test-viewer-id' as Pubky;
      const fetchMissingSpy = vi
        .spyOn(PostStreamApplication, 'fetchMissingPostsFromNexus')
        .mockResolvedValue(undefined);
      const readSpy = vi.spyOn(LocalPostService, 'readDetails').mockResolvedValueOnce(mockPostDetails);

      const result = await PostApplication.fetch({
        compositeId: 'author:post123',
        viewerId: mockViewerId,
      });

      expect(fetchMissingSpy).toHaveBeenCalledWith({
        cacheMissPostIds: ['author:post123'],
        viewerId: mockViewerId,
      });
      expect(readSpy).toHaveBeenCalledTimes(1);
      expect(readSpy).toHaveBeenCalledWith({ postId: 'author:post123' });
      expect(result).toEqual(mockPostDetails);
    });

    it('should return null when post not found on Nexus', async () => {
      const mockViewerId = 'test-viewer-id' as Pubky;
      const fetchMissingSpy = vi
        .spyOn(PostStreamApplication, 'fetchMissingPostsFromNexus')
        .mockResolvedValue(undefined);
      const readSpy = vi.spyOn(LocalPostService, 'readDetails').mockResolvedValueOnce(null);

      const result = await PostApplication.fetch({
        compositeId: 'author:post123',
        viewerId: mockViewerId,
      });

      expect(fetchMissingSpy).toHaveBeenCalledWith({
        cacheMissPostIds: ['author:post123'],
        viewerId: mockViewerId,
      });
      expect(readSpy).toHaveBeenCalledTimes(1);
      expect(readSpy).toHaveBeenCalledWith({ postId: 'author:post123' });
      expect(result).toBeNull();
    });

    it('should propagate errors from PostStreamApplication', async () => {
      const mockViewerId = 'test-viewer-id' as Pubky;
      vi.spyOn(PostStreamApplication, 'fetchMissingPostsFromNexus').mockRejectedValue(new Error('Nexus error'));

      await expect(
        PostApplication.fetch({
          compositeId: 'author:post123',
          viewerId: mockViewerId,
        }),
      ).rejects.toThrow('Nexus error');
    });
  });

  describe('getCounts', () => {
    it('should call LocalPostService.readCounts', async () => {
      const mockCounts: PostCountsModelSchema = {
        id: 'author:post123',
        tags: 5,
        unique_tags: 3,
        replies: 10,
        reposts: 2,
      };

      const getCountsSpy = vi.spyOn(LocalPostService, 'readCounts').mockResolvedValue(mockCounts);

      const result = await PostApplication.getCounts({ compositeId: 'author:post123' });

      expect(getCountsSpy).toHaveBeenCalledWith('author:post123');
      expect(result).toEqual(mockCounts);
    });
  });

  describe('getTags', () => {
    it('should call LocalPostService.readTags', async () => {
      const mockTags: TagCollectionModelSchema<string>[] = [
        {
          id: 'author:post123',
          tags: [{ label: 'tag1', taggers: ['test-viewer-id'] as Pubky[], taggers_count: 0, relationship: false }],
        },
      ];

      const getTagsSpy = vi.spyOn(LocalPostService, 'readTags').mockResolvedValue(mockTags);

      const result = await PostApplication.getTags({ compositeId: 'author:post123' });

      expect(getTagsSpy).toHaveBeenCalledWith('author:post123');
      expect(result).toEqual(mockTags);
    });
  });

  describe('fetchTags', () => {
    const params = {
      compositeId: 'author:post123',
      skip: 0,
      limit: 3,
      viewerId: 'viewer123' as Pubky,
    };

    it('should return empty tags without merging local state', async () => {
      const nexusSpy = vi.spyOn(NexusPostService, 'getPostTags').mockResolvedValue([]);
      const mergeSpy = vi.spyOn(LocalPostTagService, 'mergeTags').mockResolvedValue(undefined);

      const result = await PostApplication.fetchTags(params);

      expect(result).toEqual([]);
      expect(nexusSpy).toHaveBeenCalledWith(params);
      expect(mergeSpy).not.toHaveBeenCalled();
    });

    it('should merge non-empty Nexus tags into local state', async () => {
      const tags: NexusTag[] = [
        { label: 'bitcoin', taggers: ['viewer123' as Pubky], taggers_count: 1, relationship: true },
      ];
      const nexusSpy = vi.spyOn(NexusPostService, 'getPostTags').mockResolvedValue(tags);
      const mergeSpy = vi.spyOn(LocalPostTagService, 'mergeTags').mockResolvedValue(undefined);

      const result = await PostApplication.fetchTags(params);

      expect(result).toEqual(tags);
      expect(nexusSpy).toHaveBeenCalledWith(params);
      expect(mergeSpy).toHaveBeenCalledWith({
        postId: params.compositeId,
        tags,
        viewerId: params.viewerId,
      });
    });
  });

  describe('getDetails', () => {
    it('should call LocalPostService.readDetails and enrich with moderation', async () => {
      const mockPost: PostDetailsModelSchema = {
        id: 'author:post123',
        content: 'Test post',
        indexed_at: Date.now(),
        kind: 'short',
        uri: 'pubky://author/pub/pubky.app/posts/post123',
        attachments: null,
      };

      const readSpy = vi.spyOn(LocalPostService, 'readDetails').mockResolvedValue(mockPost);

      const result = await PostApplication.getDetails({ compositeId: 'author:post123' });

      expect(readSpy).toHaveBeenCalledWith({ postId: 'author:post123' });
      expect(result).toEqual({
        ...mockPost,
        is_moderated: false,
        is_blurred: false,
      });
    });

    it('should return null when post does not exist', async () => {
      const readSpy = vi.spyOn(LocalPostService, 'readDetails').mockResolvedValue(null);

      const result = await PostApplication.getDetails({ compositeId: 'nonexistent:post' });

      expect(readSpy).toHaveBeenCalledWith({ postId: 'nonexistent:post' });
      expect(result).toBeNull();
    });
  });

  describe('fetchTaggers', () => {
    it('should delegate to NexusPostService.getPostTaggers', async () => {
      const params: TFetchPostTaggersParams = {
        compositeId: 'author:post123',
        label: 'bitcoin',
        skip: 10,
        limit: 20,
      };
      const mockTaggers: NexusTaggers = { relationship: false, users: ['user1' as Pubky] };
      const taggersSpy = vi.spyOn(NexusPostService, 'getPostTaggers').mockResolvedValue(mockTaggers);

      const result = await PostApplication.fetchTaggers(params);

      expect(taggersSpy).toHaveBeenCalledWith(params);
      expect(result).toEqual(mockTaggers);
    });

    it('should propagate errors from NexusPostService.getPostTaggers', async () => {
      const params: TFetchPostTaggersParams = {
        compositeId: 'author:post123',
        label: 'bitcoin',
      };
      const taggersSpy = vi.spyOn(NexusPostService, 'getPostTaggers').mockRejectedValue(new Error('Nexus failed'));

      await expect(PostApplication.fetchTaggers(params)).rejects.toThrow('Nexus failed');
      expect(taggersSpy).toHaveBeenCalledWith(params);
    });
  });
});
