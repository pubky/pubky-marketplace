import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { buildCompositeId } from '@/models/models.utils';
import { PostCountsModel } from '@/models/post/counts/postCounts';
import { PostDetailsModel } from '@/models/post/details/postDetails';
import { DELETED } from '@/models/post/details/postDetails.constants';
import { PostRelationshipsModel } from '@/models/post/relationships/postRelationships';
import { PostTagsModel } from '@/models/post/tags/postTags';
import { PostTtlModel } from '@/models/post/ttl/postTtl';
import { TagModel } from '@/models/shared/tag/tag';
import { type PostStreamId, PostStreamTypes } from '@/models/stream/post/postStream.types';
import { PostStreamModel } from '@/models/stream/post/tables/postStream';
import { LocalStreamPostsService } from '@/services/local/stream/posts/posts';
import type {
  NexusFileDetails,
  NexusFileUrls,
  NexusPost,
  NexusPostDetails,
  NexusPostWithAttachmentMetadata,
  NexusTag,
} from '@/services/nexus/nexus.types';
import { asOpaque } from '@/test-utils/type-assertions';

describe('LocalStreamPostsService', () => {
  const streamId: PostStreamId = PostStreamTypes.TIMELINE_ALL_ALL;
  const DEFAULT_AUTHOR = 'user-1';
  const BASE_TIMESTAMP = 1000000;

  // ============================================================================
  // Test Helpers
  // ============================================================================

  const createMockNexusPost = (
    postId: string,
    author: string = DEFAULT_AUTHOR,
    timestamp: number = BASE_TIMESTAMP,
    overrides?: Partial<NexusPost>,
  ): NexusPost => ({
    details: {
      id: postId,
      content: `Post ${postId} content`,
      kind: 'short' as const,
      uri: `https://pubky.app/${author}/pub/pubky.app/posts/${postId}`,
      author,
      indexed_at: timestamp,
      attachments: null,
      ...(overrides?.details as NexusPostDetails | undefined),
    },
    counts: {
      replies: 0,
      tags: 0,
      unique_tags: 0,
      reposts: 0,
      ...overrides?.counts,
    },
    tags: overrides?.tags ?? [],
    relationships: {
      replied: null,
      reposted: null,
      mentioned: [],
      ...overrides?.relationships,
    },
    bookmark: null,
    ...overrides,
  });

  const postId = (id: string) => buildCompositeId({ pubky: DEFAULT_AUTHOR, id });

  const createStream = async (postIds: string[]) => {
    await PostStreamModel.table.put({ id: streamId, stream: postIds });
  };

  const verifyStream = async (expectedPostIds: string[]) => {
    const result = await PostStreamModel.table.get(streamId);
    expect(result).toBeTruthy();
    expect(result!.stream).toEqual(expectedPostIds);
  };

  const verifyStreamDoesNotExist = async () => {
    const result = await PostStreamModel.table.get(streamId);
    expect(result).toBeUndefined();
  };

  const verifyPostPersisted = async (compositePostId: string, expectedContent: string) => {
    const details = await PostDetailsModel.findById(compositePostId);
    expect(details).toBeTruthy();
    expect(details?.content).toBe(expectedContent);

    const counts = await PostCountsModel.findById(compositePostId);
    expect(counts).toBeTruthy();

    const relationships = await PostRelationshipsModel.findById(compositePostId);
    expect(relationships).toBeTruthy();

    const tags = await PostTagsModel.findById(compositePostId);
    expect(tags).toBeTruthy();

    const ttl = await PostTtlModel.findById(compositePostId);
    expect(ttl).toBeTruthy();
    expect(ttl?.lastUpdatedAt).toBeGreaterThan(0);
  };

  const persistAndVerifyPost = async (
    postId: string,
    author: string,
    timestamp: number = BASE_TIMESTAMP,
    overrides?: Partial<NexusPost>,
  ) => {
    const mockPost = createMockNexusPost(postId, author, timestamp, overrides);
    const compositeId = buildCompositeId({ pubky: author, id: postId });

    const result = await LocalStreamPostsService.persistPosts({ posts: [mockPost] });

    const expectedAttachments = mockPost.details.attachments || [];
    expect(result).toEqual({ attachmentMetadata: expectedAttachments });
    return { compositeId, mockPost };
  };

  beforeEach(async () => {
    // Restore all mocks first to ensure clean state (removes any spies from previous tests)
    vi.restoreAllMocks();
    // Clear all mocks to reset call history
    vi.clearAllMocks();

    // Clear all relevant tables
    await PostStreamModel.table.clear();
    await PostDetailsModel.table.clear();
    await PostCountsModel.table.clear();
    await PostRelationshipsModel.table.clear();
    await PostTagsModel.table.clear();
    await PostTtlModel.table.clear();
  });

  describe('persistPosts', () => {
    it('should persist posts and return post attachments', async () => {
      const mockPosts: NexusPost[] = [createMockNexusPost('post-1', 'user-1'), createMockNexusPost('post-2', 'user-2')];

      const result = await LocalStreamPostsService.persistPosts({ posts: mockPosts });

      expect(result).toEqual({ attachmentMetadata: [] });
      await verifyPostPersisted(buildCompositeId({ pubky: 'user-1', id: 'post-1' }), 'Post post-1 content');
      await verifyPostPersisted(buildCompositeId({ pubky: 'user-2', id: 'post-2' }), 'Post post-2 content');
    });

    it('should handle posts with tags', async () => {
      const mockTag: NexusTag = {
        label: 'tech',
        taggers: ['user-2'],
        taggers_count: 1,
        relationship: true,
      };
      const { compositeId } = await persistAndVerifyPost('post-1', 'user-1', BASE_TIMESTAMP, {
        tags: [new TagModel(mockTag)],
      });

      const postTags = await PostTagsModel.findById(compositeId);
      expect(postTags).toBeTruthy();
      expect(postTags?.tags).toHaveLength(1);
      expect(postTags?.tags[0].label).toBe('tech');
      expect(postTags?.tags[0].taggers).toEqual(['user-2']);
    });

    it('should handle posts with relationships', async () => {
      const repliedUri = 'https://pubky.app/user-2/pub/pubky.app/posts/parent-post';
      const { compositeId } = await persistAndVerifyPost('post-1', 'user-1', BASE_TIMESTAMP, {
        relationships: {
          replied: repliedUri,
          reposted: null,
          mentioned: ['user-3'],
        },
      });

      const relationships = await PostRelationshipsModel.findById(compositeId);
      expect(relationships).toBeTruthy();
      expect(relationships?.replied).toBe(repliedUri);
      expect(relationships?.reposted).toBeNull();
      expect(relationships?.mentioned).toEqual(['user-3']);
    });

    it('should remove author from post details', async () => {
      const { compositeId } = await persistAndVerifyPost('post-1', 'user-1', BASE_TIMESTAMP);

      const postDetails = await PostDetailsModel.findById(compositeId);
      expect(postDetails).toBeTruthy();
      // Author should not be in details (it's in the composite ID)
      expect(asOpaque<{ author?: string }>(postDetails).author).toBeUndefined();
    });

    it('should handle empty array', async () => {
      const result = await LocalStreamPostsService.persistPosts({ posts: [] });

      expect(result).toEqual({ attachmentMetadata: [] });
    });

    it('should handle posts with empty tags array', async () => {
      const { compositeId } = await persistAndVerifyPost('post-1', 'user-1', BASE_TIMESTAMP, {
        tags: [],
      });

      const postTags = await PostTagsModel.findById(compositeId);
      expect(postTags).toBeTruthy();
      expect(postTags?.tags).toEqual([]);
    });

    it('should handle posts with multiple tags', async () => {
      const mockTag1: NexusTag = {
        label: 'tech',
        taggers: ['user-2'],
        taggers_count: 1,
        relationship: true,
      };
      const mockTag2: NexusTag = {
        label: 'coding',
        taggers: ['user-3'],
        taggers_count: 1,
        relationship: false,
      };
      const { compositeId } = await persistAndVerifyPost('post-1', 'user-1', BASE_TIMESTAMP, {
        tags: [new TagModel(mockTag1), new TagModel(mockTag2)],
      });

      const postTags = await PostTagsModel.findById(compositeId);
      expect(postTags).toBeTruthy();
      expect(postTags?.tags).toHaveLength(2);
      expect(postTags?.tags[0].label).toBe('tech');
      expect(postTags?.tags[1].label).toBe('coding');
    });

    it('should handle posts with all null relationships', async () => {
      const { compositeId } = await persistAndVerifyPost('post-1', 'user-1', BASE_TIMESTAMP, {
        relationships: {
          replied: null,
          reposted: null,
          mentioned: [],
        },
      });

      const relationships = await PostRelationshipsModel.findById(compositeId);
      expect(relationships).toBeTruthy();
      expect(relationships?.replied).toBeNull();
      expect(relationships?.reposted).toBeNull();
      expect(relationships?.mentioned).toEqual([]);
    });

    it('should propagate error when bulkSave fails', async () => {
      const mockPosts: NexusPost[] = [createMockNexusPost('post-1', 'user-1')];

      // Mock PostDetailsModel.bulkSave to throw error
      const databaseError = Err.database(DatabaseErrorCode.WRITE_FAILED, 'Failed to save post details', {
        service: ErrorService.Local,
        operation: 'bulkSave',
      });
      vi.spyOn(PostDetailsModel, 'bulkSave').mockRejectedValue(databaseError);

      await expect(LocalStreamPostsService.persistPosts({ posts: mockPosts })).rejects.toThrow(
        'Failed to save post details',
      );
    });

    it('should handle posts with different authors correctly', async () => {
      const mockPosts: NexusPost[] = [
        createMockNexusPost('post-1', 'author-1'),
        createMockNexusPost('post-2', 'author-2'),
        createMockNexusPost('post-3', 'author-1'),
      ];

      const result = await LocalStreamPostsService.persistPosts({ posts: mockPosts });

      expect(result).toEqual({ attachmentMetadata: [] });

      // Verify all posts were persisted
      await verifyPostPersisted(buildCompositeId({ pubky: 'author-1', id: 'post-1' }), 'Post post-1 content');
      await verifyPostPersisted(buildCompositeId({ pubky: 'author-2', id: 'post-2' }), 'Post post-2 content');
      await verifyPostPersisted(buildCompositeId({ pubky: 'author-1', id: 'post-3' }), 'Post post-3 content');
    });

    it('should collect and return attachments_metadata from posts', async () => {
      const fileMetadata = (id: string, uri: string): NexusFileDetails => ({
        id,
        name: id,
        src: '',
        content_type: 'image/png',
        size: 100,
        created_at: 0,
        indexed_at: 0,
        metadata: {},
        owner_id: 'user-1',
        uri,
        urls: {} as NexusFileUrls,
      });

      const meta1 = fileMetadata('file-1', 'pubky://user-1/pub/pubky.app/files/file-1');
      const meta2 = fileMetadata('file-2', 'pubky://user-1/pub/pubky.app/files/file-2');
      const meta3 = fileMetadata('file-3', 'pubky://user-2/pub/pubky.app/files/file-3');

      const mockPosts: NexusPostWithAttachmentMetadata[] = [
        { ...createMockNexusPost('post-1', 'user-1'), attachments_metadata: [meta1, meta2] },
        { ...createMockNexusPost('post-2', 'user-2'), attachments_metadata: [meta3] },
        { ...createMockNexusPost('post-3', 'user-3') },
      ];

      const result = await LocalStreamPostsService.persistPosts({ posts: mockPosts });

      expect(result).toEqual({
        attachmentMetadata: [meta1, meta2, meta3],
      });
    });

    it('should handle posts without attachments_metadata', async () => {
      const mockPosts: NexusPostWithAttachmentMetadata[] = [{ ...createMockNexusPost('post-1', 'user-1') }];

      const result = await LocalStreamPostsService.persistPosts({ posts: mockPosts });

      expect(result).toEqual({ attachmentMetadata: [] });
    });
  });

  describe('persistPosts - tombstone guard', () => {
    // Regression coverage for the bug where Nexus's by-ids endpoint could
    // return a just-deleted post (Nexus eventual consistency between the
    // delete index and the post-by-id read path), and `bulkSave` would
    // overwrite the local `[DELETED]` tombstone, making the post visible again.

    it('skips writing all records for ids whose existing PostDetails.content is [DELETED]', async () => {
      const compositeId = buildCompositeId({ pubky: 'author-1', id: 'tombstoned' });

      // Seed a tombstone retained in an existing local database.
      await PostDetailsModel.table.put({
        id: compositeId,
        content: DELETED,
        indexed_at: BASE_TIMESTAMP,
        kind: 'collection',
        uri: 'pubky://author-1/pub/pubky.app/posts/tombstoned',
        attachments: null,
      });

      // Use the helper's default content (`Post tombstoned content`) — what
      // matters is that it differs from the `[DELETED]` tombstone we just
      // seeded, so the guard's behavior is observable.
      const reanimating = createMockNexusPost('tombstoned', 'author-1', BASE_TIMESTAMP);

      await LocalStreamPostsService.persistPosts({ posts: [reanimating] });

      // Content must remain the tombstone — Nexus must not be able to
      // overwrite it via the cache-miss flow.
      const persisted = await PostDetailsModel.findById(compositeId);
      expect(persisted!.content).toBe(DELETED);

      // Auxiliary records must NOT be repopulated either — the hard-delete
      // branch removed them deliberately; reinstating them would create
      // orphan records pointing at a deleted post.
      expect(await PostCountsModel.findById(compositeId)).toBeFalsy();
      expect(await PostRelationshipsModel.findById(compositeId)).toBeFalsy();
      expect(await PostTagsModel.findById(compositeId)).toBeFalsy();
    });

    it('still persists non-tombstoned posts in the same batch', async () => {
      const tombstonedId = buildCompositeId({ pubky: 'author-1', id: 'tombstoned' });
      const liveId = buildCompositeId({ pubky: 'author-2', id: 'live' });

      await PostDetailsModel.table.put({
        id: tombstonedId,
        content: DELETED,
        indexed_at: BASE_TIMESTAMP,
        kind: 'short',
        uri: 'pubky://author-1/pub/pubky.app/posts/tombstoned',
        attachments: null,
      });

      const batch = [
        createMockNexusPost('tombstoned', 'author-1', BASE_TIMESTAMP),
        createMockNexusPost('live', 'author-2', BASE_TIMESTAMP),
      ];

      await LocalStreamPostsService.persistPosts({ posts: batch });

      // Tombstone is preserved.
      const tombstone = await PostDetailsModel.findById(tombstonedId);
      expect(tombstone!.content).toBe(DELETED);
      expect(await PostCountsModel.findById(tombstonedId)).toBeFalsy();

      // Live post writes through normally — uses the helper's default content.
      const live = await PostDetailsModel.findById(liveId);
      expect(live!.content).toBe('Post live content');
      expect(await PostCountsModel.findById(liveId)).toBeTruthy();
    });
  });

  describe('when the signal aborts during a read', () => {
    /** Runs `read` through to the database, then aborts as a sign-out landing during the read would. */
    const thenAbort =
      <A extends unknown[], R>(read: (...args: A) => Promise<R>, controller: AbortController) =>
      async (...args: A): Promise<R> => {
        const result = await read(...args);
        controller.abort();
        return result;
      };
    const abortAfterDetailsRead = (controller: AbortController) =>
      vi
        .spyOn(PostDetailsModel, 'findByIdsPreserveOrder')
        .mockImplementationOnce(thenAbort((ids) => PostDetailsModel.findByIdsPreserveOrder(ids), controller));

    it('persistPosts saves nothing once the tombstone lookup returns', async () => {
      const controller = new AbortController();
      abortAfterDetailsRead(controller);
      const compositeId = buildCompositeId({ pubky: 'author-1', id: 'late' });

      await expect(
        LocalStreamPostsService.persistPosts({
          posts: [createMockNexusPost('late', 'author-1')],
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ name: 'AbortError' });

      expect(await PostDetailsModel.findById(compositeId)).toBeFalsy();
      expect(await PostCountsModel.findById(compositeId)).toBeFalsy();
      expect(await PostTagsModel.findById(compositeId)).toBeFalsy();
      expect(await PostTtlModel.findById(compositeId)).toBeFalsy();
    });

    it('persistNewStreamChunk leaves a new stream unwritten', async () => {
      const controller = new AbortController();
      vi.spyOn(PostStreamModel, 'findById').mockImplementationOnce(
        thenAbort((id) => PostStreamModel.findById(id), controller),
      );

      await expect(
        LocalStreamPostsService.persistNewStreamChunk({
          streamId,
          stream: [postId('post-1')],
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ name: 'AbortError' });

      await verifyStreamDoesNotExist();
    });

    it('persistNewStreamChunk leaves an existing stream unchanged when the sort read returns', async () => {
      await createStream([postId('post-1')]);
      const controller = new AbortController();
      abortAfterDetailsRead(controller);

      await expect(
        LocalStreamPostsService.persistNewStreamChunk({
          streamId,
          stream: [postId('post-2')],
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ name: 'AbortError' });

      await verifyStream([postId('post-1')]);
    });
  });

  describe('persistNewStreamChunk', () => {
    it('should append new stream chunk to existing stream', async () => {
      const initialStream = [postId('post-1'), postId('post-2')];
      const newChunk = [postId('post-3'), postId('post-4')];

      await createStream(initialStream);
      await LocalStreamPostsService.persistNewStreamChunk({ streamId, stream: newChunk });

      await verifyStream([...initialStream, ...newChunk]);
    });

    it('should handle appending to empty stream', async () => {
      const newChunk = [postId('post-1'), postId('post-2')];

      await createStream([]);
      await LocalStreamPostsService.persistNewStreamChunk({ streamId, stream: newChunk });

      await verifyStream(newChunk);
    });

    it('should handle appending empty chunk', async () => {
      const initialStream = [postId('post-1')];

      await createStream(initialStream);
      await LocalStreamPostsService.persistNewStreamChunk({ streamId, stream: [] });

      await verifyStream(initialStream);
    });

    it('should propagate error when PostStreamModel.findById throws in persistNewStreamChunk', async () => {
      const databaseError = Err.database(DatabaseErrorCode.QUERY_FAILED, 'Database query failed', {
        service: ErrorService.Local,
        operation: 'findById',
        context: { streamId },
      });
      vi.spyOn(PostStreamModel, 'findById').mockRejectedValue(databaseError);

      await expect(
        LocalStreamPostsService.persistNewStreamChunk({
          streamId,
          stream: [postId('post-1')],
        }),
      ).rejects.toThrow('Database query failed');
    });

    it('should propagate error when PostDetailsModel.findByIdsPreserveOrder throws', async () => {
      await createStream([postId('post-1')]);

      const databaseError = Err.database(DatabaseErrorCode.QUERY_FAILED, 'Database query failed', {
        service: ErrorService.Local,
        operation: 'findByIdsPreserveOrder',
      });
      vi.spyOn(PostDetailsModel, 'findByIdsPreserveOrder').mockRejectedValue(databaseError);

      await expect(
        LocalStreamPostsService.persistNewStreamChunk({
          streamId,
          stream: [postId('post-2')],
        }),
      ).rejects.toThrow('Database query failed');
    });

    it('should propagate error when PostStreamModel.upsert throws in persistNewStreamChunk', async () => {
      await createStream([postId('post-1')]);
      await LocalStreamPostsService.persistPosts({
        posts: [createMockNexusPost('post-1', DEFAULT_AUTHOR), createMockNexusPost('post-2', DEFAULT_AUTHOR)],
      });

      const databaseError = Err.database(DatabaseErrorCode.WRITE_FAILED, 'Failed to upsert stream', {
        service: ErrorService.Local,
        operation: 'upsert',
        context: { streamId },
      });
      vi.spyOn(PostStreamModel, 'upsert').mockRejectedValue(databaseError);

      await expect(
        LocalStreamPostsService.persistNewStreamChunk({
          streamId,
          stream: [postId('post-2')],
        }),
      ).rejects.toThrow('Failed to upsert stream');
    });
  });

  describe('getNotPersistedPostsInCache', () => {
    it('should return post IDs that are not in cache', async () => {
      const postIds = [postId('post-1'), postId('post-2'), postId('post-3')];
      // Only persist post-1
      await PostDetailsModel.create({
        id: postId('post-1'),
        content: 'Post 1',
        kind: 'short',
        indexed_at: BASE_TIMESTAMP,
        uri: `https://pubky.app/${DEFAULT_AUTHOR}/pub/pubky.app/posts/post-1`,
        attachments: null,
      });

      const result = await LocalStreamPostsService.getNotPersistedPostsInCache(postIds);

      expect(result).toEqual([postId('post-2'), postId('post-3')]);
    });

    it('should return empty array when all posts are in cache', async () => {
      const postIds = [postId('post-1'), postId('post-2')];
      // Persist both posts
      await PostDetailsModel.create({
        id: postId('post-1'),
        content: 'Post 1',
        kind: 'short',
        indexed_at: BASE_TIMESTAMP,
        uri: `https://pubky.app/${DEFAULT_AUTHOR}/pub/pubky.app/posts/post-1`,
        attachments: null,
      });
      await PostDetailsModel.create({
        id: postId('post-2'),
        content: 'Post 2',
        kind: 'short',
        indexed_at: BASE_TIMESTAMP + 1,
        uri: `https://pubky.app/${DEFAULT_AUTHOR}/pub/pubky.app/posts/post-2`,
        attachments: null,
      });

      const result = await LocalStreamPostsService.getNotPersistedPostsInCache(postIds);

      expect(result).toEqual([]);
    });

    it('should return all post IDs when none are in cache', async () => {
      const postIds = [postId('post-1'), postId('post-2')];

      const result = await LocalStreamPostsService.getNotPersistedPostsInCache(postIds);

      expect(result).toEqual(postIds);
    });

    it('should handle empty array', async () => {
      const result = await LocalStreamPostsService.getNotPersistedPostsInCache([]);

      expect(result).toEqual([]);
    });

    it('should preserve order of missing posts', async () => {
      const postIds = [postId('post-1'), postId('post-2'), postId('post-3'), postId('post-4')];
      // Only persist post-2
      await PostDetailsModel.create({
        id: postId('post-2'),
        content: 'Post 2',
        kind: 'short',
        indexed_at: BASE_TIMESTAMP,
        uri: `https://pubky.app/${DEFAULT_AUTHOR}/pub/pubky.app/posts/post-2`,
        attachments: null,
      });

      const result = await LocalStreamPostsService.getNotPersistedPostsInCache(postIds);

      // Should preserve order: post-1, post-3, post-4 (post-2 is filtered out)
      expect(result).toEqual([postId('post-1'), postId('post-3'), postId('post-4')]);
    });

    it('should propagate error when PostDetailsModel.findByIdsPreserveOrder throws', async () => {
      const postIds = [postId('post-1')];
      const databaseError = Err.database(DatabaseErrorCode.QUERY_FAILED, 'Database query failed', {
        service: ErrorService.Local,
        operation: 'getNotPersistedPostsInCache',
      });
      vi.spyOn(PostDetailsModel, 'findByIdsPreserveOrder').mockRejectedValue(databaseError);

      await expect(LocalStreamPostsService.getNotPersistedPostsInCache(postIds)).rejects.toThrow(
        'Database query failed',
      );
    });
  });
});
