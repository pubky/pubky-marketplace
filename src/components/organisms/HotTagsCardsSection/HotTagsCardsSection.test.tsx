import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserWithAvatar } from '@/hooks/useBulkUserAvatars/useBulkUserAvatars.types';
import type { UseMutedUsersResult } from '@/hooks/useMutedUsers/useMutedUsers.types';
import type { Pubky } from '@/models/models.types';
import { HotTagsCardsSection } from './HotTagsCardsSection';

const mockUseBulkUserAvatars = vi.hoisted(() =>
  vi.fn(() => ({
    getUsersWithAvatars: vi.fn((_userIds: Pubky[]): UserWithAvatar[] => []),
  })),
);

const mockUseMutedUsers = vi.hoisted(() =>
  vi.fn(
    (): UseMutedUsersResult => ({
      mutedUserIds: [],
      mutedUserIdSet: new Set(),
      isMuted: (_userId: Pubky) => false,
      isLoading: false,
    }),
  ),
);

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

vi.mock('@/stores/hot/hot.store', () => ({
  useHotStore: vi.fn(() => ({
    reach: 'all',
    timeframe: 'this_month',
  })),
}));

const mockUseHotTags = vi.fn();

vi.mock('@/hooks/useHotTags/useHotTags', () => ({
  useHotTags: (params: unknown) => mockUseHotTags(params),
}));

const mockUseIsMobile = vi.hoisted(() => vi.fn((_options?: { breakpoint?: string }) => false));

vi.mock('@/hooks/useIsMobile/useIsMobile', () => ({
  useIsMobile: (options?: { breakpoint?: string }) => mockUseIsMobile(options),
}));

vi.mock('@/hooks/useMutedUsers/useMutedUsers', () => ({
  useMutedUsers: mockUseMutedUsers,
}));

vi.mock('@/hooks/useBulkUserAvatars/useBulkUserAvatars', () => ({
  useBulkUserAvatars: mockUseBulkUserAvatars,
}));

vi.mock('@/config/tags', () => ({
  HOT_TAGS_FEATURED_COUNT: 3,
}));

describe('HotTagsCardsSection', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockUseHotTags.mockClear();
    mockUseIsMobile.mockImplementation(() => false);
    mockUseBulkUserAvatars.mockImplementation(() => ({
      getUsersWithAvatars: vi.fn((_userIds: Pubky[]): UserWithAvatar[] => []),
    }));
    mockUseMutedUsers.mockImplementation(
      (): UseMutedUsersResult => ({
        mutedUserIds: [],
        mutedUserIdSet: new Set(),
        isMuted: (_userId: Pubky) => false,
        isLoading: false,
      }),
    );
  });

  it('renders heading and empty state when tags are empty', () => {
    mockUseHotTags.mockReturnValue({
      rawTags: [],
      isLoading: false,
      error: null,
    });

    render(<HotTagsCardsSection />);

    expect(screen.getByTestId('hot-tags-cards-section')).toBeInTheDocument();
    expect(screen.getByText('Hot tags')).toBeInTheDocument();
    expect(screen.getByText('No tags to show')).toBeInTheDocument();
  });

  it('renders tag cards when tags are available', () => {
    mockUseHotTags.mockReturnValue({
      rawTags: [
        { label: 'bitcoin', tagged_count: 16, taggers_id: [] },
        { label: 'keys', tagged_count: 176, taggers_id: [] },
        { label: 'pubky', tagged_count: 149, taggers_id: [] },
      ],
      isLoading: false,
      error: null,
    });

    render(<HotTagsCardsSection />);

    expect(screen.getByTestId('hot-tags-cards-section')).toBeInTheDocument();
    expect(screen.getByTestId('hot-tag-card-1')).toBeInTheDocument();
    expect(screen.getByTestId('hot-tag-card-2')).toBeInTheDocument();
    expect(screen.getByTestId('hot-tag-card-3')).toBeInTheDocument();
  });

  it('renders error state with heading', () => {
    mockUseHotTags.mockReturnValue({
      rawTags: [],
      isLoading: false,
      error: 'Network error',
    });

    render(<HotTagsCardsSection />);

    expect(screen.getByText('Hot tags')).toBeInTheDocument();
    expect(screen.getByText('Failed to load tags')).toBeInTheDocument();
  });

  it('renders loading state with heading and skeleton', () => {
    mockUseHotTags.mockReturnValue({
      rawTags: [],
      isLoading: true,
      error: null,
    });

    render(<HotTagsCardsSection />);

    expect(screen.getByText('Hot tags')).toBeInTheDocument();
    expect(screen.getByTestId('hot-tags-card-skeleton-0')).toBeInTheDocument();
    expect(screen.getByTestId('hot-tags-card-skeleton-1')).toBeInTheDocument();
    expect(screen.getByTestId('hot-tags-card-skeleton-2')).toBeInTheDocument();
  });

  it.each([
    { viewport: 'mobile (< sm)', below: ['sm', 'xl'], maxAvatars: 2 },
    { viewport: 'tablet (sm to xl)', below: ['xl'], maxAvatars: 4 },
    { viewport: 'wide (≥ xl)', below: [], maxAvatars: 6 },
  ])('limits avatars per card to $maxAvatars on $viewport', ({ below, maxAvatars }) => {
    mockUseIsMobile.mockImplementation((options) => below.includes(options?.breakpoint ?? ''));
    mockUseHotTags.mockReturnValue({ rawTags: [], isLoading: true, error: null });

    render(<HotTagsCardsSection />);

    // Each skeleton card renders one avatar row for mobile and one for wider layouts.
    const avatars = screen.getByTestId('hot-tags-card-skeleton-0').querySelectorAll('.size-7.rounded-full');
    expect(avatars).toHaveLength(maxAvatars * 2);
  });

  it('excludes muted taggers from avatar bulk fetch and HotTagCard taggers', () => {
    mockUseMutedUsers.mockImplementation(
      (): UseMutedUsersResult => ({
        mutedUserIds: ['muted-author'],
        mutedUserIdSet: new Set(['muted-author']),
        isMuted: (id: Pubky) => id === 'muted-author',
        isLoading: false,
      }),
    );

    const getUsersWithAvatars = vi.fn(() => []);
    mockUseBulkUserAvatars.mockImplementation(() => ({ getUsersWithAvatars }));

    mockUseHotTags.mockReturnValue({
      rawTags: [
        { label: 'bitcoin', tagged_count: 16, taggers_id: ['muted-author', 'visible-author'] },
        { label: 'keys', tagged_count: 176, taggers_id: [] },
        { label: 'pubky', tagged_count: 149, taggers_id: [] },
      ],
      isLoading: false,
      error: null,
    });

    render(<HotTagsCardsSection />);

    expect(mockUseBulkUserAvatars).toHaveBeenCalledWith(['visible-author']);
    expect(getUsersWithAvatars).toHaveBeenCalledWith(['visible-author']);
  });
});
