import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostApplication } from '@/application/post/post';
import type { TFetchPostTaggersParams } from '@/controllers/post/post.types';
import { db } from '@/database/franky/franky';
import type { Pubky } from '@/models/models.types';
import { buildCompositeId } from '@/models/models.utils';
import { PostCountsModel } from '@/models/post/counts/postCounts';
import { PostDetailsModel } from '@/models/post/details/postDetails';
import type { PostDetailsModelSchema } from '@/models/post/details/postDetails.schema';
import { PostRelationshipsModel } from '@/models/post/relationships/postRelationships';
import { PostTagsModel } from '@/models/post/tags/postTags';
import type { NexusTaggers } from '@/services/nexus/nexus.types';

const testData = {
  authorPubky: 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy' as Pubky,
  postId: 'abc123xyz',
  get fullPostId() {
    return buildCompositeId({ pubky: this.authorPubky, id: this.postId });
  },
};

const setupExistingPost = async () => {
  const postDetails: PostDetailsModelSchema = {
    id: testData.fullPostId,
    content: 'Test post content',
    indexed_at: Date.now(),
    kind: 'short', // PubkyAppPostKind.Short
    uri: `pubky://${testData.authorPubky}/pub/pubky.app/posts/${testData.postId}`,
    attachments: null,
  };

  await PostDetailsModel.table.add(postDetails);
  await PostCountsModel.table.add({
    id: testData.fullPostId,
    tags: 0,
    unique_tags: 0,
    replies: 0,
    reposts: 0,
  });
  await PostRelationshipsModel.table.add({
    id: testData.fullPostId,
    replied: null,
    reposted: null,
    mentioned: [],
  });
};

describe('PostController', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    // Initialize database and clear tables
    await db.initialize();
    await db.transaction(
      'rw',
      [PostDetailsModel.table, PostCountsModel.table, PostRelationshipsModel.table, PostTagsModel.table],
      async () => {
        await PostDetailsModel.table.clear();
        await PostCountsModel.table.clear();
        await PostRelationshipsModel.table.clear();
        await PostTagsModel.table.clear();
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getDetails', () => {
    it('should return post details when post exists', async () => {
      await setupExistingPost();
      const { PostController } = await import('./post');

      const result = await PostController.getDetails({ compositeId: testData.fullPostId });

      expect(result).toBeDefined();
      expect(result?.id).toBe(testData.fullPostId);
      expect(result?.content).toBe('Test post content');
      expect(result?.kind).toBe('short');
      expect(result?.uri).toBe(`pubky://${testData.authorPubky}/pub/pubky.app/posts/${testData.postId}`);
    });

    it('should return null when post not found', async () => {
      const { PostController } = await import('./post');

      const result = await PostController.getDetails({ compositeId: 'nonexistent:post' });

      expect(result).toBeNull();
    });
  });

  describe('getCounts', () => {
    it('should return post counts when they exist', async () => {
      await setupExistingPost();
      const { PostController } = await import('./post');

      const result = await PostController.getCounts({ compositeId: testData.fullPostId });

      expect(result).toBeDefined();
      expect(result!.id).toBe(testData.fullPostId);
      expect(result!.tags).toBe(0);
      expect(result!.unique_tags).toBe(0);
      expect(result!.replies).toBe(0);
      expect(result!.reposts).toBe(0);
    });

    it('should return null when post not found', async () => {
      const { PostController } = await import('./post');

      const result = await PostController.getCounts({ compositeId: 'nonexistent:post' });

      expect(result).toBeNull();
    });

    it('should include all count fields in response', async () => {
      await setupExistingPost();

      // Update counts to non-zero values
      await PostCountsModel.table.update(testData.fullPostId, {
        tags: 5,
        unique_tags: 3,
        replies: 10,
        reposts: 2,
      });

      const { PostController } = await import('./post');
      const result = await PostController.getCounts({ compositeId: testData.fullPostId });

      expect(result!.tags).toBe(5);
      expect(result!.unique_tags).toBe(3);
      expect(result!.replies).toBe(10);
      expect(result!.reposts).toBe(2);
    });
  });

  describe('fetch', () => {
    const mockViewerId = 'test-viewer-id' as Pubky;

    it('should delegate to PostApplication.fetch', async () => {
      const { PostController } = await import('./post');

      const fetchSpy = vi.spyOn(PostApplication, 'fetch').mockResolvedValue(null);

      try {
        await PostController.fetch({ compositeId: 'author:post123', viewerId: mockViewerId });
        expect(fetchSpy).toHaveBeenCalledWith({ compositeId: 'author:post123', viewerId: mockViewerId });
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('should return null when PostApplication.fetch returns null', async () => {
      const { PostController } = await import('./post');

      const fetchSpy = vi.spyOn(PostApplication, 'fetch').mockResolvedValue(null);

      try {
        const post = await PostController.fetch({
          compositeId: 'nonexistent:post',
          viewerId: mockViewerId,
        });
        expect(post).toBeNull();
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('should propagate error when PostApplication.fetch throws', async () => {
      const { PostController } = await import('./post');

      const fetchSpy = vi.spyOn(PostApplication, 'fetch').mockRejectedValueOnce(new Error('Nexus error'));

      try {
        await expect(PostController.fetch({ compositeId: 'error:post', viewerId: mockViewerId })).rejects.toThrow(
          'Nexus error',
        );
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  describe('fetchTaggers', () => {
    it('should call PostApplication.fetchTaggers and return result', async () => {
      const { PostController } = await import('./post');
      const params: TFetchPostTaggersParams = {
        compositeId: testData.fullPostId,
        label: 'bitcoin',
        skip: 0,
        limit: 20,
      };
      const mockTaggers: NexusTaggers = { relationship: false, users: ['user1' as Pubky] };

      const fetchTaggersSpy = vi.spyOn(PostApplication, 'fetchTaggers').mockResolvedValue(mockTaggers);

      try {
        const result = await PostController.fetchTaggers(params);

        expect(fetchTaggersSpy).toHaveBeenCalledWith(params);
        expect(result).toEqual(mockTaggers);
      } finally {
        fetchTaggersSpy.mockRestore();
      }
    });

    it('should propagate errors from PostApplication.fetchTaggers', async () => {
      const { PostController } = await import('./post');
      const params: TFetchPostTaggersParams = {
        compositeId: testData.fullPostId,
        label: 'bitcoin',
      };

      const fetchTaggersSpy = vi.spyOn(PostApplication, 'fetchTaggers').mockRejectedValue(new Error('Nexus failed'));

      try {
        await expect(PostController.fetchTaggers(params)).rejects.toThrow('Nexus failed');
        expect(fetchTaggersSpy).toHaveBeenCalledWith(params);
      } finally {
        fetchTaggersSpy.mockRestore();
      }
    });
  });
});
