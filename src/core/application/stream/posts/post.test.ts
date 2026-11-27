import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileApplication } from '@/application/file/file';
import { PostStreamApplication } from '@/application/stream/posts/post';
import type { Pubky } from '@/models/models.types';
import { PostDetailsModel } from '@/models/post/details/postDetails';
import { UserStreamModel } from '@/models/stream/user/userStream';
import { UserCountsModel } from '@/models/user/counts/userCounts';
import { UserDetailsModel } from '@/models/user/details/userDetails';
import type { UserDetailsModelSchema } from '@/models/user/details/userDetails.schema';
import { UserRelationshipsModel } from '@/models/user/relationships/userRelationships';
import { UserTagsModel } from '@/models/user/tags/userTags';
import { LocalStreamPostsService } from '@/services/local/stream/posts/posts';
import { LocalStreamUsersService } from '@/services/local/stream/users/users';
import {
  type NexusFileDetails,
  type NexusFileUrls,
  type NexusPost,
  type NexusUser,
} from '@/services/nexus/nexus.types';
import { NexusPostStreamService } from '@/services/nexus/stream/posts/postStream';
import { NexusUserStreamService } from '@/services/nexus/stream/users/userStream';
import { asInvalid } from '@/test-utils/type-assertions';

describe('PostStreamApplication', () => {
  const DEFAULT_AUTHOR = 'user-1';

  const BASE_TIMESTAMP = 1000000;

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
      ...overrides?.details,
    },
    counts: {
      replies: 0,
      tags: 0,
      unique_tags: 0,
      reposts: 0,
      ...overrides?.counts,
    },
    tags: [],
    relationships: {
      replied: null,
      reposted: null,
      mentioned: [],
      ...overrides?.relationships,
    },
    bookmark: null,
    ...overrides,
  });

  const createMockNexusPosts = (
    count: number,
    startIndex: number = 1,
    author: string = DEFAULT_AUTHOR,
    startTimestamp: number = BASE_TIMESTAMP,
  ): NexusPost[] => {
    return Array.from({ length: count }, (_, i) => {
      const postId = `post-${startIndex + i}`;
      return createMockNexusPost(postId, author, startTimestamp + i);
    });
  };

  const createMockNexusUser = (userId: string = DEFAULT_AUTHOR, overrides?: Partial<NexusUser>): NexusUser => ({
    details: {
      id: userId,
      name: `User ${userId}`,
      bio: 'Bio',
      links: null,
      status: null,
      image: null,
      indexed_at: BASE_TIMESTAMP,
      ...overrides?.details,
    },
    counts: {
      tagged: 0,
      tags: 0,
      unique_tags: 0,
      posts: 0,
      replies: 0,
      collections: 0,
      following: 0,
      followers: 0,
      friends: 0,
      bookmarks: 0,
      ...overrides?.counts,
    },
    tags: [],
    relationship: {
      following: false,
      followed_by: false,
      ...overrides?.relationship,
    },
    ...overrides,
  });

  const createTestData = (postCount = 1, author = DEFAULT_AUTHOR) => ({
    cacheMissPostIds: Array.from({ length: postCount }, (_, i) => `${author}:post-${i + 1}`),
    mockNexusPosts: createMockNexusPosts(postCount, 1, author),
  });

  const setupDefaultMocks = () => ({
    persistPosts: vi.spyOn(LocalStreamPostsService, 'persistPosts').mockResolvedValue({ attachmentMetadata: [] }),
    persistFiles: vi.spyOn(FileApplication, 'persistFiles').mockResolvedValue(undefined),
    getUserDetails: vi.spyOn(UserDetailsModel, 'findByIdsPreserveOrder'),
  });

  const mockAllUsersCached = (count = 1, author = DEFAULT_AUTHOR) => {
    return Array.from({ length: count }, () => ({ id: author }) as UserDetailsModelSchema);
  };

  beforeEach(async () => {
    vi.restoreAllMocks();
    await PostDetailsModel.table.clear();
    await UserDetailsModel.table.clear();
    await UserCountsModel.table.clear();
    await UserRelationshipsModel.table.clear();
    await UserTagsModel.table.clear();
    await UserStreamModel.table.clear();
  });

  describe('fetchMissingPostsFromNexus', () => {
    const viewerId = 'user-viewer' as Pubky;

    it('should fetch and persist posts when postBatch exists', async () => {
      const { cacheMissPostIds, mockNexusPosts } = createTestData(2);
      const mocks = setupDefaultMocks();
      mocks.getUserDetails.mockResolvedValue(mockAllUsersCached(2));

      const fetchPostsByIdsSpy = vi.spyOn(NexusPostStreamService, 'fetchByIds').mockResolvedValue(mockNexusPosts);

      await PostStreamApplication.fetchMissingPostsFromNexus({
        cacheMissPostIds,
        viewerId,
      });

      expect(fetchPostsByIdsSpy).toHaveBeenCalledWith({
        post_ids: cacheMissPostIds,
        viewer_id: viewerId,
      });
      expect(mocks.persistPosts).toHaveBeenCalledWith({ posts: mockNexusPosts });
      expect(mocks.persistFiles).toHaveBeenCalledWith([]);
    });

    it('passes its signal on to the post write', async () => {
      const { cacheMissPostIds, mockNexusPosts } = createTestData(1);
      const mocks = setupDefaultMocks();
      mocks.getUserDetails.mockResolvedValue(mockAllUsersCached(1));
      vi.spyOn(NexusPostStreamService, 'fetchByIds').mockResolvedValue(mockNexusPosts);
      const scope = new AbortController();

      await PostStreamApplication.fetchMissingPostsFromNexus({ cacheMissPostIds, viewerId, signal: scope.signal });

      expect(mocks.persistPosts).toHaveBeenCalledWith({ posts: mockNexusPosts, signal: scope.signal });
    });

    it('passes its signal on to the reposted originals write', async () => {
      const { mockNexusPosts } = createTestData(1);
      const mocks = setupDefaultMocks();
      mocks.getUserDetails.mockResolvedValue(mockAllUsersCached(1));
      vi.spyOn(LocalStreamPostsService, 'getNotPersistedPostsInCache').mockResolvedValue([`${DEFAULT_AUTHOR}:post-0`]);
      vi.spyOn(NexusPostStreamService, 'fetchByIds').mockResolvedValue(mockNexusPosts);
      const scope = new AbortController();

      await PostStreamApplication.fetchOriginalPostsByUris({
        repostedUris: [`pubky://${DEFAULT_AUTHOR}/pub/pubky.app/posts/post-0`],
        viewerId,
        signal: scope.signal,
      });

      expect(mocks.persistPosts).toHaveBeenCalledWith({ posts: mockNexusPosts, signal: scope.signal });
    });

    it('should fetch and persist users when cacheMissUserIds exist', async () => {
      const { cacheMissPostIds, mockNexusPosts } = createTestData(1);
      const mockNexusUsers = [createMockNexusUser(DEFAULT_AUTHOR)];
      const mocks = setupDefaultMocks();
      mocks.getUserDetails.mockResolvedValue([undefined]);

      vi.spyOn(NexusPostStreamService, 'fetchByIds').mockResolvedValue(mockNexusPosts);
      const fetchUsersByIdsSpy = vi.spyOn(NexusUserStreamService, 'fetchByIds').mockResolvedValue(mockNexusUsers);

      const persistUsersSpy = vi.spyOn(LocalStreamUsersService, 'persistUsers').mockResolvedValue([]);

      await PostStreamApplication.fetchMissingPostsFromNexus({
        cacheMissPostIds,
        viewerId,
      });

      expect(fetchUsersByIdsSpy).toHaveBeenCalledWith({
        user_ids: [DEFAULT_AUTHOR],
        viewer_id: viewerId,
      });
      expect(persistUsersSpy).toHaveBeenCalledWith(mockNexusUsers);
    });

    it('should handle when userBatch is null/undefined', async () => {
      const { cacheMissPostIds, mockNexusPosts } = createTestData(1);
      const mocks = setupDefaultMocks();
      mocks.getUserDetails.mockResolvedValue([undefined]);

      vi.spyOn(NexusPostStreamService, 'fetchByIds').mockResolvedValue(mockNexusPosts);
      vi.spyOn(NexusUserStreamService, 'fetchByIds').mockResolvedValue(asInvalid<NexusUser[]>(undefined));

      const persistUsersSpy = vi.spyOn(LocalStreamUsersService, 'persistUsers').mockResolvedValue([]);

      await PostStreamApplication.fetchMissingPostsFromNexus({
        cacheMissPostIds,
        viewerId,
      });

      expect(persistUsersSpy).toHaveBeenCalledWith(undefined);
    });

    it('should not fetch users when all users are already cached', async () => {
      const { cacheMissPostIds, mockNexusPosts } = createTestData(1);
      const mocks = setupDefaultMocks();
      mocks.getUserDetails.mockResolvedValue(mockAllUsersCached(1));

      vi.spyOn(NexusPostStreamService, 'fetchByIds').mockResolvedValue(mockNexusPosts);
      const fetchUsersByIdsSpy = vi.spyOn(NexusUserStreamService, 'fetchByIds');

      await PostStreamApplication.fetchMissingPostsFromNexus({
        cacheMissPostIds,
        viewerId,
      });

      expect(fetchUsersByIdsSpy).not.toHaveBeenCalled();
    });

    it('should handle when cacheMissPostIds is empty array', async () => {
      const cacheMissPostIds: string[] = [];
      const mocks = setupDefaultMocks();

      const fetchPostsByIdsSpy = vi.spyOn(NexusPostStreamService, 'fetchByIds').mockResolvedValue([]);

      await PostStreamApplication.fetchMissingPostsFromNexus({
        cacheMissPostIds,
        viewerId,
      });

      expect(fetchPostsByIdsSpy).toHaveBeenCalledWith({
        post_ids: [],
        viewer_id: viewerId,
      });
      expect(mocks.persistPosts).toHaveBeenCalledWith({ posts: [] });
    });

    it('should handle when postBatch is empty array', async () => {
      const { cacheMissPostIds } = createTestData(1);
      const mocks = setupDefaultMocks();

      vi.spyOn(NexusPostStreamService, 'fetchByIds').mockResolvedValue([]);

      await PostStreamApplication.fetchMissingPostsFromNexus({
        cacheMissPostIds,
        viewerId,
      });

      expect(mocks.persistPosts).toHaveBeenCalledWith({ posts: [] });
    });

    it('should handle when userBatch is empty array', async () => {
      const { cacheMissPostIds, mockNexusPosts } = createTestData(1);
      const mocks = setupDefaultMocks();
      mocks.getUserDetails.mockResolvedValue([undefined]);

      vi.spyOn(NexusPostStreamService, 'fetchByIds').mockResolvedValue(mockNexusPosts);
      vi.spyOn(NexusUserStreamService, 'fetchByIds').mockResolvedValue([]);

      const persistUsersSpy = vi.spyOn(LocalStreamUsersService, 'persistUsers');

      await PostStreamApplication.fetchMissingPostsFromNexus({
        cacheMissPostIds,
        viewerId,
      });

      expect(persistUsersSpy).toHaveBeenCalledWith([]);
    });

    it('should handle error gracefully when NexusPostStreamService.fetchByIds fails', async () => {
      const { cacheMissPostIds } = createTestData(1);
      const fetchPostsByIdsSpy = vi
        .spyOn(NexusPostStreamService, 'fetchByIds')
        .mockRejectedValue(new Error('Network error'));

      await PostStreamApplication.fetchMissingPostsFromNexus({
        cacheMissPostIds,
        viewerId,
      });

      expect(fetchPostsByIdsSpy).toHaveBeenCalled();
    });

    it('should handle error gracefully when persistPosts fails', async () => {
      const { cacheMissPostIds, mockNexusPosts } = createTestData(1);
      vi.spyOn(NexusPostStreamService, 'fetchByIds').mockResolvedValue(mockNexusPosts);
      vi.spyOn(LocalStreamPostsService, 'persistPosts').mockRejectedValue(new Error('Failed to persist posts'));

      await PostStreamApplication.fetchMissingPostsFromNexus({
        cacheMissPostIds,
        viewerId,
      });

      expect(LocalStreamPostsService.persistPosts).toHaveBeenCalled();
    });

    it('should handle error gracefully when file persistence fails', async () => {
      const { cacheMissPostIds, mockNexusPosts } = createTestData(1);
      const mockAttachments: NexusFileDetails[] = [
        {
          id: 'file-1',
          name: 'file-1',
          src: '',
          content_type: 'image/png',
          size: 100,
          created_at: 0,
          indexed_at: 0,
          metadata: {},
          owner_id: 'user-1',
          uri: 'pubky://user-1/pub/pubky.app/files/file-1',
          urls: {} as NexusFileUrls,
        },
        {
          id: 'file-2',
          name: 'file-2',
          src: '',
          content_type: 'image/png',
          size: 200,
          created_at: 0,
          indexed_at: 0,
          metadata: {},
          owner_id: 'user-1',
          uri: 'pubky://user-1/pub/pubky.app/files/file-2',
          urls: {} as NexusFileUrls,
        },
      ];

      const fetchPostsByIdsSpy = vi.spyOn(NexusPostStreamService, 'fetchByIds').mockResolvedValue(mockNexusPosts);
      vi.spyOn(LocalStreamPostsService, 'persistPosts').mockResolvedValue({
        attachmentMetadata: mockAttachments,
      });
      const persistFilesSpy = vi
        .spyOn(FileApplication, 'persistFiles')
        .mockRejectedValue(new Error('Failed to persist files'));

      const getUserDetailsSpy = vi.spyOn(UserDetailsModel, 'findByIdsPreserveOrder');
      const persistUsersSpy = vi.spyOn(LocalStreamUsersService, 'persistUsers');

      await PostStreamApplication.fetchMissingPostsFromNexus({
        cacheMissPostIds,
        viewerId,
      });

      expect(persistFilesSpy).toHaveBeenCalledWith(mockAttachments);
      expect(fetchPostsByIdsSpy).toHaveBeenCalledTimes(1);
      expect(getUserDetailsSpy).not.toHaveBeenCalled();
      expect(persistUsersSpy).not.toHaveBeenCalled();
    });

    it('should handle error gracefully when NexusUserStreamService.fetchByIds fails', async () => {
      const { cacheMissPostIds, mockNexusPosts } = createTestData(1);
      const mocks = setupDefaultMocks();
      mocks.getUserDetails.mockResolvedValue([undefined]);

      vi.spyOn(NexusPostStreamService, 'fetchByIds').mockResolvedValue(mockNexusPosts);
      const fetchUsersByIdsSpy = vi
        .spyOn(NexusUserStreamService, 'fetchByIds')
        .mockRejectedValue(new Error('Network error fetching users'));

      await PostStreamApplication.fetchMissingPostsFromNexus({
        cacheMissPostIds,
        viewerId,
      });

      expect(fetchUsersByIdsSpy).toHaveBeenCalled();
    });

    it('should handle error gracefully when persistUsers fails', async () => {
      const { cacheMissPostIds, mockNexusPosts } = createTestData(1);
      const mockNexusUsers = [createMockNexusUser(DEFAULT_AUTHOR)];
      const mocks = setupDefaultMocks();
      mocks.getUserDetails.mockResolvedValue([undefined]);

      vi.spyOn(NexusPostStreamService, 'fetchByIds').mockResolvedValue(mockNexusPosts);
      vi.spyOn(NexusUserStreamService, 'fetchByIds').mockResolvedValue(mockNexusUsers);

      vi.spyOn(LocalStreamUsersService, 'persistUsers').mockRejectedValue(new Error('Failed to persist users'));

      await PostStreamApplication.fetchMissingPostsFromNexus({
        cacheMissPostIds,
        viewerId,
      });

      expect(LocalStreamUsersService.persistUsers).toHaveBeenCalled();
    });

    it('should handle multiple posts with same author', async () => {
      const { cacheMissPostIds, mockNexusPosts } = createTestData(2);
      const mocks = setupDefaultMocks();
      mocks.getUserDetails.mockResolvedValue(mockAllUsersCached(2));

      const fetchPostsByIdsSpy = vi.spyOn(NexusPostStreamService, 'fetchByIds').mockResolvedValue(mockNexusPosts);
      const fetchUsersByIdsSpy = vi.spyOn(NexusUserStreamService, 'fetchByIds');
      const persistUsersSpy = vi.spyOn(LocalStreamUsersService, 'persistUsers');

      await PostStreamApplication.fetchMissingPostsFromNexus({
        cacheMissPostIds,
        viewerId,
      });

      expect(fetchPostsByIdsSpy).toHaveBeenCalledTimes(1);
      expect(fetchUsersByIdsSpy).not.toHaveBeenCalled();
      expect(persistUsersSpy).not.toHaveBeenCalled();
    });

    it('should handle posts with different authors', async () => {
      const cacheMissPostIds = [`author-1:post-1`, `author-2:post-2`];
      const mockNexusPosts: NexusPost[] = [
        createMockNexusPost('post-1', 'author-1', BASE_TIMESTAMP),
        createMockNexusPost('post-2', 'author-2', BASE_TIMESTAMP + 1),
      ];
      const mockNexusUsers = [createMockNexusUser('author-1'), createMockNexusUser('author-2')];
      const mocks = setupDefaultMocks();
      mocks.getUserDetails.mockResolvedValue([undefined, undefined]);

      vi.spyOn(NexusPostStreamService, 'fetchByIds').mockResolvedValue(mockNexusPosts);
      const fetchUsersByIdsSpy = vi.spyOn(NexusUserStreamService, 'fetchByIds').mockResolvedValue(mockNexusUsers);

      const persistUsersSpy = vi.spyOn(LocalStreamUsersService, 'persistUsers').mockResolvedValue([]);

      await PostStreamApplication.fetchMissingPostsFromNexus({
        cacheMissPostIds,
        viewerId,
      });

      expect(fetchUsersByIdsSpy).toHaveBeenCalled();
      expect(persistUsersSpy).toHaveBeenCalledWith(mockNexusUsers);
    });

    it('should handle when getNotPersistedUsersInCache returns partial users', async () => {
      const cacheMissPostIds = [`author-1:post-1`, `author-2:post-2`];
      const mockNexusPosts: NexusPost[] = [
        createMockNexusPost('post-1', 'author-1', BASE_TIMESTAMP),
        createMockNexusPost('post-2', 'author-2', BASE_TIMESTAMP + 1),
      ];
      const mockNexusUsers = [createMockNexusUser('author-2')];
      const mocks = setupDefaultMocks();
      mocks.getUserDetails.mockResolvedValue([{ id: 'author-1' } as UserDetailsModelSchema, undefined]);

      vi.spyOn(NexusPostStreamService, 'fetchByIds').mockResolvedValue(mockNexusPosts);
      const fetchUsersByIdsSpy = vi.spyOn(NexusUserStreamService, 'fetchByIds').mockResolvedValue(mockNexusUsers);

      const persistUsersSpy = vi.spyOn(LocalStreamUsersService, 'persistUsers').mockResolvedValue([]);

      await PostStreamApplication.fetchMissingPostsFromNexus({
        cacheMissPostIds,
        viewerId,
      });

      expect(fetchUsersByIdsSpy).toHaveBeenCalledWith({
        user_ids: ['author-2'],
        viewer_id: viewerId,
      });
      expect(persistUsersSpy).toHaveBeenCalledWith(mockNexusUsers);
    });

    it('should handle error gracefully when getNotPersistedUsersInCache fails', async () => {
      const { cacheMissPostIds, mockNexusPosts } = createTestData(1);
      setupDefaultMocks();

      vi.spyOn(NexusPostStreamService, 'fetchByIds').mockResolvedValue(mockNexusPosts);
      vi.spyOn(UserDetailsModel, 'findByIdsPreserveOrder').mockRejectedValue(new Error('Database query failed'));

      await PostStreamApplication.fetchMissingPostsFromNexus({
        cacheMissPostIds,
        viewerId,
      });

      expect(UserDetailsModel.findByIdsPreserveOrder).toHaveBeenCalled();
    });

    it('should fetch original posts for reposts', async () => {
      const repostAuthor = 'reposter-user';
      const originalAuthor = 'original-author';
      const originalPostUri = `pubky://${originalAuthor}/pub/pubky.app/posts/original-post`;
      const originalPostCompositeId = `${originalAuthor}:original-post`;

      // Create a repost that references an original post
      const repostNexusPost = createMockNexusPost('repost-1', repostAuthor, BASE_TIMESTAMP, {
        relationships: {
          replied: null,
          reposted: originalPostUri,
          mentioned: [],
        },
      });

      // Original post that will be fetched
      const originalNexusPost = createMockNexusPost('original-post', originalAuthor, BASE_TIMESTAMP - 1000);

      const mocks = setupDefaultMocks();
      mocks.getUserDetails.mockResolvedValue([{ id: repostAuthor } as UserDetailsModelSchema]);

      // Mock post fetching service
      const fetchPostsByIdsSpy = vi
        .spyOn(NexusPostStreamService, 'fetchByIds')
        .mockResolvedValueOnce([repostNexusPost]) // fetchMissingPostsFromNexus: posts
        .mockResolvedValueOnce([originalNexusPost]); // fetchOriginalPostsByUris: original posts

      // Mock user fetching service for original post's author
      vi.spyOn(NexusUserStreamService, 'fetchByIds').mockResolvedValue([createMockNexusUser(originalAuthor)]);

      // Mock that original post is NOT in cache (needs to be fetched)
      vi.spyOn(LocalStreamPostsService, 'getNotPersistedPostsInCache').mockResolvedValueOnce([originalPostCompositeId]);

      await PostStreamApplication.fetchMissingPostsFromNexus({
        cacheMissPostIds: [`${repostAuthor}:repost-1`],
        viewerId,
      });

      // Should have called fetchByIds to fetch original post
      expect(fetchPostsByIdsSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          post_ids: expect.arrayContaining([originalPostCompositeId]),
        }),
      );
    });

    it('should not fetch original posts when they are already in local DB', async () => {
      const repostAuthor = 'reposter-user';
      const originalAuthor = 'original-author';
      const originalPostUri = `pubky://${originalAuthor}/pub/pubky.app/posts/original-post`;

      // Create a repost that references an original post
      const repostNexusPost = createMockNexusPost('repost-1', repostAuthor, BASE_TIMESTAMP, {
        relationships: {
          replied: null,
          reposted: originalPostUri,
          mentioned: [],
        },
      });

      const mocks = setupDefaultMocks();
      mocks.getUserDetails.mockResolvedValue([{ id: repostAuthor } as UserDetailsModelSchema]);

      const fetchPostsByIdsSpy = vi
        .spyOn(NexusPostStreamService, 'fetchByIds')
        .mockResolvedValueOnce([repostNexusPost]);

      // Mock that original post IS in cache (no need to fetch)
      vi.spyOn(LocalStreamPostsService, 'getNotPersistedPostsInCache').mockResolvedValueOnce([]);

      await PostStreamApplication.fetchMissingPostsFromNexus({
        cacheMissPostIds: [`${repostAuthor}:repost-1`],
        viewerId,
      });

      // Should only have called fetchByIds once (for the repost, not for original)
      expect(fetchPostsByIdsSpy).toHaveBeenCalledTimes(1);
    });

    it('should not fetch original posts when there are no reposts', async () => {
      const { cacheMissPostIds, mockNexusPosts } = createTestData(2);

      const mocks = setupDefaultMocks();
      mocks.getUserDetails.mockResolvedValue(mockAllUsersCached(2));

      const fetchPostsByIdsSpy = vi.spyOn(NexusPostStreamService, 'fetchByIds').mockResolvedValueOnce(mockNexusPosts);

      await PostStreamApplication.fetchMissingPostsFromNexus({
        cacheMissPostIds,
        viewerId,
      });

      // Should only have called fetchByIds once (for the posts, not for any originals)
      expect(fetchPostsByIdsSpy).toHaveBeenCalledTimes(1);
    });

    it('should handle error gracefully when fetching original posts fails', async () => {
      const repostAuthor = 'reposter-user';
      const originalAuthor = 'original-author';
      const originalPostUri = `pubky://${originalAuthor}/pub/pubky.app/posts/original-post`;
      const originalPostCompositeId = `${originalAuthor}:original-post`;

      const repostNexusPost = createMockNexusPost('repost-1', repostAuthor, BASE_TIMESTAMP, {
        relationships: {
          replied: null,
          reposted: originalPostUri,
          mentioned: [],
        },
      });

      const mocks = setupDefaultMocks();
      mocks.getUserDetails.mockResolvedValue([{ id: repostAuthor } as UserDetailsModelSchema]);

      vi.spyOn(NexusPostStreamService, 'fetchByIds')
        .mockResolvedValueOnce([repostNexusPost]) // fetchMissingPostsFromNexus: posts
        .mockRejectedValueOnce(new Error('Failed to fetch original posts')); // fetchOriginalPostsByUris fails

      vi.spyOn(LocalStreamPostsService, 'getNotPersistedPostsInCache').mockResolvedValueOnce([originalPostCompositeId]);

      // Should not throw - error should be handled gracefully
      await expect(
        PostStreamApplication.fetchMissingPostsFromNexus({
          cacheMissPostIds: [`${repostAuthor}:repost-1`],
          viewerId,
        }),
      ).resolves.not.toThrow();
    });

    it('should handle multiple reposts with different original posts', async () => {
      const repostAuthor = 'reposter-user';
      const originalAuthor1 = 'original-author-1';
      const originalAuthor2 = 'original-author-2';
      const originalPostUri1 = `pubky://${originalAuthor1}/pub/pubky.app/posts/original-1`;
      const originalPostUri2 = `pubky://${originalAuthor2}/pub/pubky.app/posts/original-2`;

      const repostNexusPosts = [
        createMockNexusPost('repost-1', repostAuthor, BASE_TIMESTAMP, {
          relationships: { replied: null, reposted: originalPostUri1, mentioned: [] },
        }),
        createMockNexusPost('repost-2', repostAuthor, BASE_TIMESTAMP + 1, {
          relationships: { replied: null, reposted: originalPostUri2, mentioned: [] },
        }),
      ];

      const originalNexusPosts = [
        createMockNexusPost('original-1', originalAuthor1, BASE_TIMESTAMP - 1000),
        createMockNexusPost('original-2', originalAuthor2, BASE_TIMESTAMP - 2000),
      ];

      const mocks = setupDefaultMocks();
      mocks.getUserDetails.mockResolvedValue([{ id: repostAuthor } as UserDetailsModelSchema]);

      const fetchPostsByIdsSpy = vi
        .spyOn(NexusPostStreamService, 'fetchByIds')
        .mockResolvedValueOnce(repostNexusPosts)
        .mockResolvedValueOnce(originalNexusPosts);

      vi.spyOn(NexusUserStreamService, 'fetchByIds').mockResolvedValue([
        createMockNexusUser(originalAuthor1),
        createMockNexusUser(originalAuthor2),
      ]);

      vi.spyOn(LocalStreamPostsService, 'getNotPersistedPostsInCache').mockResolvedValueOnce([
        `${originalAuthor1}:original-1`,
        `${originalAuthor2}:original-2`,
      ]);

      await PostStreamApplication.fetchMissingPostsFromNexus({
        cacheMissPostIds: [`${repostAuthor}:repost-1`, `${repostAuthor}:repost-2`],
        viewerId,
      });

      // Should have fetched both original posts
      expect(fetchPostsByIdsSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          post_ids: expect.arrayContaining([`${originalAuthor1}:original-1`, `${originalAuthor2}:original-2`]),
        }),
      );
    });
  });
});
