import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NotificationActorAvatar, NotificationActorHeading } from './NotificationRowChrome';

vi.mock('@/organisms/AvatarWithFallback/AvatarWithFallback', () => ({
  AvatarWithFallback: ({ name, className }: { name: string; className?: string }) => (
    <div data-testid="avatar-with-fallback" data-name={name} className={className} />
  ),
}));

describe('NotificationActorAvatar', () => {
  it('links the avatar to the profile when a link is given', () => {
    render(
      <NotificationActorAvatar
        avatarUrl={undefined}
        userName="Oliver"
        fallbackSeed="oliver"
        userProfileLink="/profile/oliver"
      />,
    );

    expect(screen.getByRole('link')).toHaveAttribute('href', '/profile/oliver');
    expect(screen.getByRole('link')).toHaveAttribute('target', '_top');
    expect(screen.getByTestId('avatar-with-fallback')).toHaveAttribute('data-name', 'Oliver');
  });

  it('renders a plain avatar without a profile link', () => {
    render(
      <NotificationActorAvatar avatarUrl={undefined} userName="Oliver" fallbackSeed="oliver" userProfileLink={null} />,
    );

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByTestId('avatar-with-fallback')).toHaveClass('shrink-0');
  });
});

describe('NotificationActorHeading', () => {
  it('links the username and the action to their targets', () => {
    render(
      <NotificationActorHeading
        userName="Oliver"
        userProfileLink="/profile/oliver"
        actionText="followed you"
        actionLink="/post/oliver/123"
      />,
    );

    expect(screen.getByRole('link', { name: 'Oliver' })).toHaveAttribute('href', '/profile/oliver');
    expect(screen.getByRole('link', { name: 'Oliver' })).toHaveAttribute('target', '_top');
    expect(screen.getByRole('link', { name: 'followed you' })).toHaveAttribute('href', '/post/oliver/123');
  });

  it('falls back to plain text when there are no targets', () => {
    render(<NotificationActorHeading userName="Oliver" userProfileLink={null} actionText="followed you" />);

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Oliver')).toBeInTheDocument();
    expect(screen.getByText('followed you')).toBeInTheDocument();
  });
});
