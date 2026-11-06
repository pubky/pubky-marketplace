import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UserListItem } from './UserListItem';
import type { UserListItemData } from './UserListItem.types';

// Mock Hooks
vi.mock('@/hooks/useRequireAuth/useRequireAuth', () => ({
  useRequireAuth: () => ({ requireAuth: (fn: () => void) => fn() }),
}));

vi.mock('@/hooks/useTtlSubscription/useTtlSubscription', () => ({
  useTtlSubscription: () => ({ ref: () => {} }),
}));

// Mock Atoms - lightweight pass-through components
vi.mock('@/atoms/Button/Button', () => {
  return {
    Button: ({
      children,
      variant,
      size,
      overrideDefaults: _overrideDefaults,
      ...rest
    }: React.PropsWithChildren<Record<string, unknown>>) => (
      <button data-size={size} data-variant={variant} {...rest}>
        {children}
      </button>
    ),
  };
});

vi.mock('@/atoms/Container/Container', () => {
  return {
    Container: ({
      children,
      overrideDefaults: _overrideDefaults,
      ...rest
    }: React.PropsWithChildren<Record<string, unknown>>) => <div {...rest}>{children}</div>,
  };
});

vi.mock('@/atoms/Link/Link', () => {
  return {
    Link: ({
      children,
      overrideDefaults: _overrideDefaults,
      ...rest
    }: React.PropsWithChildren<Record<string, unknown>>) => <a {...rest}>{children}</a>,
  };
});

vi.mock('@/atoms/Typography/Typography', () => {
  return {
    Typography: ({
      children,
      as: Tag = 'span',
      overrideDefaults: _overrideDefaults,
      size: _size,
      ...rest
    }: React.PropsWithChildren<{ as?: React.ElementType } & Record<string, unknown>>) => {
      const Component = Tag as React.ElementType;
      return <Component {...rest}>{children}</Component>;
    },
  };
});

// Mock Organisms
vi.mock('@/organisms/AvatarWithFallback/AvatarWithFallback', () => {
  return {
    AvatarWithFallback: () => <div data-testid="avatar" />,
  };
});

vi.mock('@/organisms/ClickableTagsList/ClickableTagsList', () => {
  return {
    ClickableTagsList: () => <div data-testid="tags-list" />,
  };
});

// Mock dependencies
vi.mock('@/application/tag/tag.types', () => ({
  TagKind: { USER: 'user' },
}));

// Mock Config
vi.mock('@/config/tags', () => ({
  USER_LIST_TAG_MAX_LENGTH: 8,
  USER_LIST_TAGS_MAX_TOTAL_CHARS: 20,
}));

const mockUser: UserListItemData = {
  id: 'test-user-pubky-123456',
  name: 'Test User',
  avatarUrl: 'https://example.com/avatar.jpg',
  tags: ['tag1'],
  stats: { tags: 5, posts: 10 },
  isFollowing: false,
};

describe('UserListItem - follow button', () => {
  it('renders an icon button for compact layout', () => {
    render(<UserListItem user={mockUser} variant="compact" onFollowClick={vi.fn()} />);

    // Icon variant: aria-label includes user name, button has size="icon"
    const followButton = screen.getByRole('button', { name: /Follow Test User/i });
    expect(followButton).toHaveAttribute('data-size', 'icon');
    // No visible "Follow" text
    expect(screen.queryByText('Follow')).not.toBeInTheDocument();
  });

  it('renders an icon button for full layout', () => {
    render(<UserListItem user={mockUser} variant="full" onFollowClick={vi.fn()} />);

    // Full variant renders desktop + mobile follow buttons, both should be icon
    const followButtons = screen.getAllByRole('button', { name: /Follow Test User/i });
    expect(followButtons.length).toBeGreaterThan(0);
    followButtons.forEach((btn) => {
      expect(btn).toHaveAttribute('data-size', 'icon');
    });
    expect(screen.queryByText('Follow')).not.toBeInTheDocument();
  });

  it('labels the icon button as Unfollow with a check icon when following', () => {
    render(<UserListItem user={{ ...mockUser, isFollowing: true }} variant="compact" onFollowClick={vi.fn()} />);

    const unfollowButton = screen.getByRole('button', { name: 'Unfollow Test User' });
    expect(unfollowButton.querySelector('.lucide-check')).toBeInTheDocument();
    expect(unfollowButton.querySelector('.lucide-user-minus')).toHaveClass('hidden', 'group-hover:block');
    expect(unfollowButton.querySelector('.lucide-user-round-plus')).not.toBeInTheDocument();
  });

  it.each([{ isLoading: true }, { isStatusLoading: true }])(
    'shows a disabled spinner on the icon button while %o',
    (loadingProps) => {
      render(<UserListItem user={mockUser} variant="compact" onFollowClick={vi.fn()} {...loadingProps} />);

      const followButton = screen.getByRole('button', { name: 'Follow Test User' });
      expect(followButton).toBeDisabled();
      expect(followButton.querySelector('.animate-spin')).toBeInTheDocument();
      expect(followButton.querySelector('.lucide-user-round-plus')).not.toBeInTheDocument();
    },
  );

  it('renders an icon button for MeButton when isCurrentUser', () => {
    render(<UserListItem user={mockUser} variant="compact" isCurrentUser />);

    // MeButton icon variant: aria-label "This is you", size="icon", no "Me" text
    const meButton = screen.getByRole('button', { name: /This is you/i });
    expect(meButton).toHaveAttribute('data-size', 'icon');
    expect(screen.queryByText('Me')).not.toBeInTheDocument();
  });
});
