import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostRelationshipsModelSchema } from '@/models/post/relationships/postRelationships.schema';
import { useRepostInfo } from './useRepostInfo';

// Hoist mock data
const { mockRelationships, setMockRelationships } = vi.hoisted(() => {
  const relationshipsData = { current: undefined as PostRelationshipsModelSchema | null | undefined };
  return {
    mockRelationships: relationshipsData,
    setMockRelationships: (value: PostRelationshipsModelSchema | null | undefined) => {
      relationshipsData.current = value;
    },
  };
});

// Mock local-first query hook
vi.mock('@/hooks/useLocalFirstQuery/useLocalFirstQuery', () => ({
  useLocalFirstQuery: vi.fn(() => ({
    data: mockRelationships.current,
    isLoading: mockRelationships.current === undefined,
  })),
}));

// Mock direct dependencies
const { mockBuildCompositeIdFromPubkyUri, mockGetPostRelationships } = vi.hoisted(() => ({
  mockBuildCompositeIdFromPubkyUri: vi.fn(),
  mockGetPostRelationships: vi.fn(),
}));

const mockFetch = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/controllers/post/post', () => ({
  PostController: {
    // Included for safety if the mocked useLiveQuery ever executes the queryFn.
    getPostRelationships: mockGetPostRelationships,
    getRelationships: mockGetPostRelationships,
    fetch: mockFetch,
  },
}));
vi.mock('@/models/models.utils', () => ({
  buildCompositeIdFromPubkyUri: mockBuildCompositeIdFromPubkyUri,
  parseCompositeId: (compositeId: string) => {
    const separatorIndex = compositeId.indexOf(':');
    if (separatorIndex === -1) {
      throw new Error('Invalid composite ID');
    }
    return {
      pubky: compositeId.slice(0, separatorIndex),
      id: compositeId.slice(separatorIndex + 1),
    };
  },
}));

// Mock hooks
const mockCurrentUserPubky = 'current-user-pubky';
vi.mock('@/hooks/useCurrentUserProfile/useCurrentUserProfile', () => ({
  useCurrentUserProfile: vi.fn(() => ({
    currentUserPubky: mockCurrentUserPubky,
  })),
}));

describe('useRepostInfo', () => {
  const mockPostId = 'author:post-123';
  const mockRepostedUri = 'pubky://post/original-post-uri';

  beforeEach(() => {
    vi.clearAllMocks();
    setMockRelationships(undefined);
    mockGetPostRelationships.mockResolvedValue(null);
    mockBuildCompositeIdFromPubkyUri.mockReturnValue('original-author:original-post');
  });

  it('does not identify a repost before relationships are available', () => {
    setMockRelationships(undefined);

    const { result } = renderHook(() => useRepostInfo(mockPostId));

    expect(result.current.isRepost).toBe(false);
  });

  it('returns isRepost false when post is not a repost', () => {
    setMockRelationships({ id: mockPostId, reposted: null, replied: null, mentioned: [] });

    const { result } = renderHook(() => useRepostInfo(mockPostId));

    expect(result.current.isRepost).toBe(false);
    expect(result.current.isCurrentUserRepost).toBe(false);
    expect(result.current.originalPostId).toBe(null);
  });

  it('returns isRepost true when post is a repost', () => {
    setMockRelationships({ id: mockPostId, reposted: mockRepostedUri, replied: null, mentioned: [] });

    const { result } = renderHook(() => useRepostInfo(mockPostId));

    expect(result.current.isRepost).toBe(true);
    expect(result.current.originalPostId).toBe('original-author:original-post');
  });

  it('compares the parsed repost author with the current user', () => {
    const repostPostId = 'repost-author:repost-post';
    setMockRelationships({ id: repostPostId, reposted: mockRepostedUri, replied: null, mentioned: [] });

    const { result } = renderHook(() => useRepostInfo(repostPostId));
    expect(result.current.isCurrentUserRepost).toBe(false);
  });

  it('returns isCurrentUserRepost true when current user reposted', () => {
    const currentUserPostId = `${mockCurrentUserPubky}:post-123`;
    setMockRelationships({ id: currentUserPostId, reposted: mockRepostedUri, replied: null, mentioned: [] });

    const { result } = renderHook(() => useRepostInfo(currentUserPostId));

    expect(result.current.isCurrentUserRepost).toBe(true);
  });

  it('returns isCurrentUserRepost false when different user reposted', () => {
    const otherUserPostId = 'other-user:post-123';
    setMockRelationships({ id: otherUserPostId, reposted: mockRepostedUri, replied: null, mentioned: [] });

    const { result } = renderHook(() => useRepostInfo(otherUserPostId));

    expect(result.current.isCurrentUserRepost).toBe(false);
  });

  it('returns originalPostId null when relationships.reposted is null', () => {
    setMockRelationships({ id: mockPostId, reposted: null, replied: null, mentioned: [] });

    const { result } = renderHook(() => useRepostInfo(mockPostId));

    expect(result.current.originalPostId).toBe(null);
  });

  it('returns originalPostId when relationships.reposted exists', () => {
    const originalPostId = 'original-author:original-post';
    setMockRelationships({ id: mockPostId, reposted: mockRepostedUri, replied: null, mentioned: [] });
    mockBuildCompositeIdFromPubkyUri.mockReturnValueOnce(originalPostId);

    const { result } = renderHook(() => useRepostInfo(mockPostId));

    expect(result.current.originalPostId).toBe(originalPostId);
  });

  it('handles postId with multiple colons correctly', () => {
    const complexPostId = `${mockCurrentUserPubky}:post:with:colons`;
    setMockRelationships({ id: complexPostId, reposted: mockRepostedUri, replied: null, mentioned: [] });

    const { result } = renderHook(() => useRepostInfo(complexPostId));

    // Compare only the author before the first colon.
    expect(result.current.isCurrentUserRepost).toBe(true);
  });

  it('returns no original post for a loaded non-repost', () => {
    setMockRelationships({ id: mockPostId, reposted: null, replied: null, mentioned: [] });

    const { result } = renderHook(() => useRepostInfo(mockPostId));
    expect(result.current.originalPostId).toBeNull();
  });
});
