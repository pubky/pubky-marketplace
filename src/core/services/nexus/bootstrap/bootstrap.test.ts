import { focusManager, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientErrorCode, ServerErrorCode } from '@/libs/error/error.codes';
import { ErrorCategory } from '@/libs/error/error.types';
import { NexusBootstrapService } from '@/services/nexus/bootstrap/bootstrap';
import { bootstrapApi } from '@/services/nexus/bootstrap/bootstrap.api';

describe('NexusBootstrapService', () => {
  const mockFetch = vi.fn();
  const pubky = 'test-user-123';

  const generateMockResponse = (testUserId: string, testPostId: string) => ({
    users: [
      {
        details: {
          name: 'Bootstrap User',
          bio: 'Bootstrap bio',
          id: testUserId,
          links: null,
          status: null,
          image: null,
          indexed_at: Date.now(),
        },
        counts: {
          tagged: 2,
          tags: 2,
          unique_tags: 2,
          posts: 1,
          replies: 0,
          collections: 0,
          following: 0,
          followers: 0,
          friends: 0,
          bookmarks: 0,
        },
        tags: [
          {
            label: 'developer',
            taggers: ['tagger-user-1', 'tagger-user-2'],
            taggers_count: 2,
            relationship: false,
          },
          {
            label: 'p2p',
            taggers: ['tagger-user-3'],
            taggers_count: 1,
            relationship: false,
          },
        ],
        relationship: {
          following: false,
          followed_by: false,
        },
      },
    ],
    posts: [
      {
        details: {
          id: testPostId,
          content: 'Bootstrap post content',
          kind: 'short',
          uri: `https://pubky.app/${testUserId}/pub/pubky.app/posts/${testPostId}`,
          author: testUserId,
          indexed_at: Date.now(),
          attachments: null,
        },
        counts: {
          replies: 0,
          tags: 2,
          unique_tags: 2,
          reposts: 0,
        },
        author: {
          details: {
            name: 'Bootstrap User',
            bio: 'Bootstrap bio',
            id: testUserId,
            links: null,
            status: null,
            image: null,
            indexed_at: Date.now(),
          },
          counts: {
            tagged: 2,
            tags: 2,
            unique_tags: 2,
            posts: 1,
            replies: 0,
            following: 0,
            followers: 0,
            friends: 0,
            bookmarks: 0,
          },
          tags: [
            {
              label: 'developer',
              taggers: ['tagger-user-1', 'tagger-user-2'],
              taggers_count: 2,
              relationship: false,
            },
            {
              label: 'p2p',
              taggers: ['tagger-user-3'],
              taggers_count: 1,
              relationship: false,
            },
          ],
          relationship: {
            following: false,
            followed_by: false,
          },
        },
        tags: [
          {
            label: 'tech',
            taggers: ['post-tagger-1'],
            taggers_count: 1,
            relationship: false,
          },
          {
            label: 'announcement',
            taggers: ['post-tagger-2', 'post-tagger-3'],
            taggers_count: 2,
            relationship: false,
          },
        ],
        relationships: {
          replied: null,
          reposted: null,
          mentioned: [],
        },
        bookmark: null,
      },
    ],
    list: {
      stream: [testPostId, 'random-post-id'],
      influencers: ['influencer-user-1', 'influencer-user-2'],
      recommended: ['recommended-user-1', 'recommended-user-2', 'recommended-user-3'],
      hot_tags: [],
    },
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
    // Clear query client cache between tests
    const { nexusQueryClient } = await import('../nexus.query-client');
    nexusQueryClient.clear();
  });

  describe('read', () => {
    afterEach(() => vi.useRealTimers());

    it.each(['request', 'body', 'offline', 'hidden'])(
      'bounds a stalled bootstrap %s including the existing retries',
      async (phase) => {
        vi.useFakeTimers();
        if (phase === 'offline') onlineManager.setOnline(false);
        if (phase === 'hidden') focusManager.setFocused(false);
        const signals: AbortSignal[] = [];
        mockFetch.mockImplementation((_url: string, options: RequestInit) => {
          if (options.signal) signals.push(options.signal);
          const stalled = new Promise<never>((_resolve, reject) => {
            options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
          });
          return phase === 'request' ? stalled : Promise.resolve({ ok: true, text: () => stalled });
        });
        let result: unknown;
        void NexusBootstrapService.fetch(`stalled-${phase}`).catch((error: unknown) => {
          result = error;
        });
        const { nexusQueryClient } = await import('../nexus.query-client');
        try {
          await vi.advanceTimersByTimeAsync(75_001);
          expect(result).toMatchObject({ category: ErrorCategory.Timeout, code: 'REQUEST_TIMEOUT' });
          if (phase !== 'offline') expect(signals.length).toBeGreaterThan(0);
          expect(signals.every((signal) => signal.aborted)).toBe(true);
          const attempts = mockFetch.mock.calls.length;
          onlineManager.setOnline(true);
          focusManager.setFocused(true);
          await vi.advanceTimersByTimeAsync(10_000);
          expect(mockFetch).toHaveBeenCalledTimes(attempts);
        } finally {
          nexusQueryClient.clear();
          onlineManager.setOnline(true);
          focusManager.setFocused(true);
        }
      },
    );

    it('should fetch and return bootstrap data successfully', async () => {
      const mockResponse = generateMockResponse(pubky, '');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
        headers: {
          get: vi.fn(),
        },
      });

      const result = await NexusBootstrapService.fetch(pubky);

      expect(mockFetch).toHaveBeenCalledWith(bootstrapApi.get(pubky), {
        method: 'GET',
        signal: expect.any(AbortSignal),
        headers: {
          'Content-Type': 'application/json',
        },
      });
      expect(result).toEqual(mockResponse);
    });

    it('should propagate errors from queryNexus', async () => {
      // Use a different pubky to avoid cache collision
      const errorPubky = 'error-user-456';
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: {
          get: vi.fn(),
        },
        text: vi.fn().mockResolvedValue(''),
      });

      await expect(NexusBootstrapService.fetch(errorPubky)).rejects.toMatchObject({
        category: ErrorCategory.Client,
        code: ClientErrorCode.BAD_REQUEST,
      });
    });

    it('should throw INTERNAL_ERROR when response is empty', async () => {
      // Use a different pubky to avoid cache collision
      const emptyPubky = 'empty-user-789';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        text: () => Promise.resolve(''),
        headers: {
          get: vi.fn(),
        },
      });

      await expect(NexusBootstrapService.fetch(emptyPubky)).rejects.toMatchObject({
        category: ErrorCategory.Server,
        code: ServerErrorCode.INVALID_RESPONSE,
      });
    });
  });

  describe('ingest', () => {
    it('should send a PUT to the ingest endpoint and resolve on an empty 200 body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(''),
        headers: {
          get: vi.fn(),
        },
      });

      await expect(NexusBootstrapService.ingest(pubky)).resolves.toBeUndefined();

      expect(mockFetch).toHaveBeenCalledWith(bootstrapApi.ingest(pubky), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
      });
    });

    it('should resolve even when the response is not ok (best-effort contract)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: {
          get: vi.fn(),
        },
        text: vi.fn().mockResolvedValue(''),
      });

      await expect(NexusBootstrapService.ingest(pubky)).resolves.toBeUndefined();
    });
  });
});
