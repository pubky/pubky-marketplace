import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NexusPost } from '@/services/nexus/nexus.types';
import { queryNexus } from '@/services/nexus/nexus.utils';
import { NexusPostStreamService } from './postStream';
import { postStreamApi } from './postStream.api';
import type { TStreamPostsByIdsParams } from './postStream.types';

vi.mock('@/services/nexus/nexus.utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/nexus/nexus.utils')>();
  return {
    ...actual,
    queryNexus: vi.fn(),
  };
});

const mockQueryNexus = vi.mocked(queryNexus);

describe('Posts by IDs endpoint', () => {
  const mockPostIds = ['post-id-1', 'post-id-2', 'post-id-3'];
  const mockViewerId = 'viewer-pubky-id';

  it('should generate correct POST request with post IDs only', () => {
    const request = postStreamApi.postsByIds({
      post_ids: mockPostIds,
    });

    expect(request.url).toMatch(/\/stream\/posts\/by_ids$/);
    expect(request.body).toEqual({
      post_ids: mockPostIds,
      include_attachment_metadata: true,
    });
  });

  it('should generate correct POST request with post IDs and viewer_id', () => {
    const request = postStreamApi.postsByIds({
      post_ids: mockPostIds,
      viewer_id: mockViewerId,
    });

    expect(request.url).toMatch(/\/stream\/posts\/by_ids$/);
    expect(request.body).toEqual({
      post_ids: mockPostIds,
      include_attachment_metadata: true,
      viewer_id: mockViewerId,
    });
  });

  it('should handle empty post IDs array', () => {
    const request = postStreamApi.postsByIds({
      post_ids: [],
    });

    expect(request.url).toMatch(/\/stream\/posts\/by_ids$/);
    expect(request.body.post_ids).toEqual([]);
  });

  it('should handle large array of post IDs', () => {
    const largePostIds = Array.from({ length: 100 }, (_, i) => `post-id-${i}`);
    const request = postStreamApi.postsByIds({
      post_ids: largePostIds,
      viewer_id: mockViewerId,
    });

    expect(request.url).toMatch(/\/stream\/posts\/by_ids$/);
    expect(request.body.post_ids).toHaveLength(100);
    expect(request.body.viewer_id).toBe(mockViewerId);
  });

  it('should include include_attachment_metadata when true', () => {
    const request = postStreamApi.postsByIds({
      post_ids: mockPostIds,
      viewer_id: mockViewerId,
      include_attachment_metadata: true,
    });

    expect(request.url).toMatch(/\/stream\/posts\/by_ids$/);
    expect(request.body).toEqual({
      post_ids: mockPostIds,
      viewer_id: mockViewerId,
      include_attachment_metadata: true,
    });
  });

  it('should default include_attachment_metadata to true when not provided', () => {
    const request = postStreamApi.postsByIds({
      post_ids: mockPostIds,
    });

    expect(request.body).toEqual({
      post_ids: mockPostIds,
      include_attachment_metadata: true,
    });
  });

  it('should allow explicitly setting include_attachment_metadata to false', () => {
    const request = postStreamApi.postsByIds({
      post_ids: mockPostIds,
      include_attachment_metadata: false,
    });

    expect(request.body).toEqual({
      post_ids: mockPostIds,
      include_attachment_metadata: false,
    });
  });
});

describe('NexusPostStreamService', () => {
  const mockViewerId = 'viewer-pubky-id';

  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks keeps queued mockResolvedValueOnce values.
    mockQueryNexus.mockReset();
  });

  describe('fetchByIds', () => {
    it('should fetch posts by IDs with viewer_id', async () => {
      // Arrange
      const mockPostIds = ['author1:post1', 'author1:post2', 'author2:post3'];
      const mockPosts: NexusPost[] = [
        { details: { id: 'post1', author: 'author1' } } as NexusPost,
        { details: { id: 'post2', author: 'author1' } } as NexusPost,
        { details: { id: 'post3', author: 'author2' } } as NexusPost,
      ];
      const queryNexusSpy = mockQueryNexus.mockResolvedValue(mockPosts);

      // Act
      const result = await NexusPostStreamService.fetchByIds({
        post_ids: mockPostIds,
        viewer_id: mockViewerId,
      });

      // Assert
      expect(queryNexusSpy).toHaveBeenCalledTimes(1);
      expect(queryNexusSpy).toHaveBeenCalledWith({
        url: expect.stringContaining('/stream/posts/by_ids'),
        method: 'POST',
        body: JSON.stringify({ post_ids: mockPostIds, include_attachment_metadata: true, viewer_id: mockViewerId }),
      });
      expect(result).toEqual(mockPosts);
    });

    it('should fetch posts by IDs without viewer_id', async () => {
      // Arrange
      const mockPostIds = ['author1:post1'];
      const mockPosts: NexusPost[] = [{ details: { id: 'post1', author: 'author1' } } as NexusPost];
      const queryNexusSpy = mockQueryNexus.mockResolvedValue(mockPosts);

      // Act
      const result = await NexusPostStreamService.fetchByIds({ post_ids: mockPostIds });

      // Assert
      expect(queryNexusSpy).toHaveBeenCalledWith({
        url: expect.stringContaining('/stream/posts/by_ids'),
        method: 'POST',
        body: JSON.stringify({ post_ids: mockPostIds, include_attachment_metadata: true }),
      });
      expect(result).toEqual(mockPosts);
    });

    it('should return empty array when fetching empty post IDs', async () => {
      // Arrange
      const queryNexusSpy = mockQueryNexus.mockResolvedValue([]);

      // Act
      const result = await NexusPostStreamService.fetchByIds({ post_ids: [] });

      // Assert
      expect(queryNexusSpy).toHaveBeenCalledWith({
        url: expect.stringContaining('/stream/posts/by_ids'),
        method: 'POST',
        body: JSON.stringify({ post_ids: [], include_attachment_metadata: true }),
      });
      expect(result).toEqual([]);
    });

    it.each([
      { count: 101, chunkSizes: [100, 1] },
      { count: 250, chunkSizes: [100, 100, 50] },
    ])(
      'fetches $count post IDs in $chunkSizes.length requests with the same options',
      async ({ count, chunkSizes }) => {
        const postIds = Array.from({ length: count }, (_, index) => `post-id-${index}`);
        let offset = 0;
        const responses = chunkSizes.map((chunkSize) => {
          const response = postIds
            .slice(offset, offset + chunkSize)
            .map((id) => ({ details: { id, author: 'author-id' } }) as NexusPost);
          offset += chunkSize;
          return response;
        });
        mockQueryNexus.mockResolvedValue([]);
        responses.forEach((response) => mockQueryNexus.mockResolvedValueOnce(response));

        const result = await NexusPostStreamService.fetchByIds({
          post_ids: postIds,
          viewer_id: mockViewerId,
          include_attachment_metadata: false,
        });

        expect(mockQueryNexus).toHaveBeenCalledTimes(chunkSizes.length);
        expect(result).toEqual(responses.flat());
        const requests = mockQueryNexus.mock.calls.map(([params]) => params);
        requests.forEach((request) => {
          expect(request.url).toMatch(/v0\/stream\/posts\/by_ids$/);
          expect(request.method).toBe('POST');
        });
        const bodies = requests.map((request) => JSON.parse(String(request.body)) as TStreamPostsByIdsParams);
        expect(bodies.map((body) => body.post_ids.length)).toEqual(chunkSizes);
        expect(bodies.flatMap((body) => body.post_ids)).toEqual(postIds);
        bodies.forEach((body) => {
          expect(body.viewer_id).toBe(mockViewerId);
          expect(body.include_attachment_metadata).toBe(false);
        });
      },
    );

    it('propagates a rejection from the second request without requesting later chunks', async () => {
      const postIds = Array.from({ length: 250 }, (_, index) => `post-id-${index}`);
      const error = new Error('Post request failed');
      mockQueryNexus.mockResolvedValueOnce([]).mockRejectedValueOnce(error).mockResolvedValueOnce([]);

      await expect(NexusPostStreamService.fetchByIds({ post_ids: postIds })).rejects.toBe(error);
      expect(mockQueryNexus).toHaveBeenCalledTimes(2);
    });
  });
});
