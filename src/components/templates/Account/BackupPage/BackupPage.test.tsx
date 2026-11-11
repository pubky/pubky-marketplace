import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useOnboardingStore } from '@/stores/onboarding/onboarding.store';
import { BackupPage } from './BackupPage';

describe('BackupPage', () => {
  beforeEach(() => {
    useAuthStore.setState({ session: null, currentUserPubky: null, hasHydrated: false, isRestoringSession: true });
    useOnboardingStore.setState({ secretKey: 'ab'.repeat(32), mnemonic: null, hasHydrated: false });
  });

  it('waits only for legacy storage hydration before exposing export', () => {
    render(<BackupPage />);
    expect(screen.getByLabelText('Loading saved keys')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Encrypted file' })).not.toBeInTheDocument();
    act(() => useOnboardingStore.getState().setHydrated(true));
    expect(screen.getByRole('button', { name: 'Encrypted file' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
  });
});
