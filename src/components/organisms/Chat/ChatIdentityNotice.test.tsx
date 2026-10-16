import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatIdentityNotice } from './ChatIdentityNotice';

const signOut = vi.hoisted(() => ({ handleSignOut: vi.fn(), isLoading: false }));

vi.mock('@/hooks/useSignOut/useSignOut', () => ({
  useSignOut: () => signOut,
}));

describe('ChatIdentityNotice', () => {
  beforeEach(() => {
    signOut.handleSignOut.mockReset();
    signOut.isLoading = false;
  });

  it.each(['ready', 'unknown'] as const)('renders nothing when the identity is %s', (identityState) => {
    const { container } = render(<ChatIdentityNotice identityState={identityState} onRetry={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('signs out through the shared sign-out flow when the sign-in lacks the chat scopes', () => {
    const onRetry = vi.fn();
    render(<ChatIdentityNotice identityState="needs_reauth" onRetry={onRetry} />);

    expect(screen.getByTestId('chat-identity-notice')).toHaveTextContent(
      'Messages need a newer sign-in approval. Sign out and sign in again to turn them on.',
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(signOut.handleSignOut).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('disables the sign-out button while signing out', () => {
    signOut.isLoading = true;
    render(<ChatIdentityNotice identityState="needs_reauth" onRetry={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Signing out...' })).toBeDisabled();
  });

  it('offers a retry, not a sign-out, when the key setup failed', () => {
    const onRetry = vi.fn();
    render(<ChatIdentityNotice identityState="error" onRetry={onRetry} />);

    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(signOut.handleSignOut).not.toHaveBeenCalled();
  });
});
