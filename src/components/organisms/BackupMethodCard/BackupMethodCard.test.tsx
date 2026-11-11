import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileController } from '@/controllers/profile/profile';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useOnboardingStore } from '@/stores/onboarding/onboarding.store';
import { BackupMethodCard } from './BackupMethodCard';

vi.mock('@/controllers/profile/profile', () => ({ ProfileController: { createRecoveryFile: vi.fn() } }));
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('available legacy recovery methods', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ session: null, currentUserPubky: null, isRestoringSession: true });
    useOnboardingStore.setState({ secretKey: null, mnemonic: null, hasHydrated: true });
  });

  it.each([
    { secretKey: null, mnemonic: null },
    { secretKey: 'malformed', mnemonic: 'malformed' },
  ])('shows an empty state without usable saved material', (state) => {
    useOnboardingStore.setState(state);
    render(<BackupMethodCard />);
    expect(screen.getByRole('heading')).toHaveTextContent('No saved keys in this browser');
    expect(screen.queryByRole('button', { name: 'Recovery phrase' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Encrypted file' })).not.toBeInTheDocument();
  });

  it('exports the saved secret without a session or completed restoration', () => {
    useOnboardingStore.setState({ secretKey: 'ab'.repeat(32) });
    render(<BackupMethodCard />);
    expect(screen.queryByRole('button', { name: 'Recovery phrase' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export to Pubky Ring' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Encrypted file' }));
    fireEvent.change(screen.getByLabelText('PASSWORD'), { target: { value: 'fictional recovery password' } });
    fireEvent.change(screen.getByLabelText('REPEAT PASSWORD'), { target: { value: 'fictional recovery password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Download file' }));
    expect(ProfileController.createRecoveryFile).toHaveBeenCalledWith('fictional recovery password');
    expect(useOnboardingStore.getState().secretKey).toBe('ab'.repeat(32));
  });

  it('offers only phrase and Ring export when only a valid mnemonic remains', () => {
    useOnboardingStore.setState({ mnemonic });
    render(<BackupMethodCard />);
    expect(screen.getByRole('button', { name: 'Recovery phrase' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export to Pubky Ring' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Encrypted file' })).not.toBeInTheDocument();
  });
});
