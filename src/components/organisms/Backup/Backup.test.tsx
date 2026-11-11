import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useOnboardingStore } from '@/stores/onboarding/onboarding.store';
import { mockSession } from '@/test-utils/pubky';
import { BackupNavigation, BackupPageHeader } from './Backup';

describe('legacy backup navigation', () => {
  beforeEach(() => {
    useAuthStore.setState({ session: null, currentUserPubky: null, hasProfile: false });
    useOnboardingStore.setState({ secretKey: 'ab'.repeat(32), mnemonic: null, hasHydrated: true });
  });

  it('lets a guest leave for signin without deleting saved keys', () => {
    render(<BackupNavigation />);
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
    expect(useOnboardingStore.getState().secretKey).toBe('ab'.repeat(32));
  });

  it.each([
    [false, 'Complete profile', '/complete-profile'],
    [true, 'Browse the market', '/marketplace'],
  ])('offers the next existing-account destination with hasProfile=%s', (hasProfile, label, href) => {
    useAuthStore.setState({ session: mockSession(), hasProfile });
    render(<BackupNavigation />);
    expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', href);
  });

  it('deletes local recovery material only after explicit confirmation', () => {
    render(<BackupNavigation />);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(useOnboardingStore.getState().secretKey).toBe('ab'.repeat(32));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm (delete seed)' }));
    expect(useOnboardingStore.getState().secretKey).toBeNull();
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
  });

  it('describes device-local keys without asserting current-account ownership', () => {
    render(<BackupPageHeader />);
    expect(screen.getByRole('heading', { name: 'Back up saved keys.' })).toBeInTheDocument();
    expect(screen.getByText(/may belong to a different account/)).toBeInTheDocument();
  });
});
