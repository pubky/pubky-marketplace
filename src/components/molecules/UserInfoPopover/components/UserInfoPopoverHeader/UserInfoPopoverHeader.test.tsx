import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserInfoPopoverHeader } from './UserInfoPopoverHeader';

vi.mock('@/organisms/AvatarWithFallback/AvatarWithFallback', () => {
  return {
    AvatarWithFallback: ({ name }: { name: string }) => <div data-testid="avatar">{name}</div>,
  };
});

describe('UserInfoPopoverHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders user name and public key', () => {
    render(<UserInfoPopoverHeader userId="user123" userName="Test User" formattedPublicKey="test123" avatarUrl="x" />);
    expect(screen.getAllByText('Test User').length).toBeGreaterThan(0);
    expect(screen.getByText('test123')).toBeInTheDocument();
    expect(screen.getByTestId('avatar')).toBeInTheDocument();
  });

  it('renders profile links for avatar and username', () => {
    render(<UserInfoPopoverHeader userId="user123" userName="Test User" formattedPublicKey="test123" avatarUrl="x" />);
    const profileLinks = screen.getAllByRole('link');
    expect(profileLinks.length).toBe(2); // One for avatar, one for username
    profileLinks.forEach((link) => {
      expect(link).toHaveAttribute('href', 'https://pubky.app/profile/user123');
      expect(link).toHaveAttribute('target', '_top');
    });
  });

  it('lets the native link handle navigation without activating the parent', () => {
    render(<UserInfoPopoverHeader userId="user123" userName="Test User" formattedPublicKey="test123" avatarUrl="x" />);
    const profileLinks = screen.getAllByRole('link');
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    const stopPropagationSpy = vi.spyOn(clickEvent, 'stopPropagation');
    const preventDefaultSpy = vi.spyOn(clickEvent, 'preventDefault');

    fireEvent(profileLinks[1], clickEvent);

    expect(stopPropagationSpy).toHaveBeenCalled();
    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });

  it('does not underline the username on hover', () => {
    render(<UserInfoPopoverHeader userId="user123" userName="Test User" formattedPublicKey="test123" avatarUrl="x" />);

    const usernameLink = screen.getAllByRole('link')[1];
    const usernameTypography = within(usernameLink).getByTestId('typography');

    expect(usernameTypography).not.toHaveClass('hover:underline');
  });

  it('constrains long user names in the popover preview header', () => {
    const longName = 'BobiWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW';

    render(<UserInfoPopoverHeader userId="user123" userName={longName} formattedPublicKey="test123" avatarUrl="x" />);

    const profileLinks = screen.getAllByRole('link');
    const usernameLink = profileLinks[1];
    const usernameTypography = within(usernameLink).getByTestId('typography');

    expect(usernameLink.closest('.w-0.flex-1')).toBeInTheDocument();
    expect(usernameLink).toHaveClass('block', 'w-full', 'min-w-0');
    expect(usernameTypography).toHaveClass('block', 'w-full', 'max-w-full', 'truncate');
  });
});
