import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DialogConfirmBackup } from './DialogConfirmBackup';

// Mock dependencies
const { mockClearSecrets } = vi.hoisted(() => ({ mockClearSecrets: vi.fn() }));
vi.mock('@/stores/onboarding/onboarding.store', () => ({
  useOnboardingStore: vi.fn(() => ({
    clearSecrets: mockClearSecrets,
  })),
}));

// Mock atoms - use actual implementations

// Mock organisms
vi.mock('@/organisms/DialogBackup/DialogBackup', () => {
  return {
    DialogBackup: vi.fn(({ open }: { open: boolean }) =>
      open ? <div data-testid="dialog-backup">DialogBackup</div> : null,
    ),
  };
});

describe('DialogConfirmBackup', () => {
  it('renders the Done trigger button', () => {
    render(<DialogConfirmBackup />);

    expect(screen.getByRole('button', { name: 'Done' })).toHaveAttribute('id', 'backup-done-btn');
  });

  it('opens the confirmation dialog when the trigger is clicked', async () => {
    render(<DialogConfirmBackup />);

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(await screen.findByTestId('dialog-title')).toHaveTextContent('All backed up?');
    expect(screen.getByText(/secret seed will be deleted from your browser/)).toBeInTheDocument();
    expect(screen.getByText('After confirming, your seed will be deleted from the browser (!)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Backup methods/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirm \(delete seed\)/ })).toHaveAttribute(
      'id',
      'backup-done-confirm-btn',
    );
  });

  it('clears the secrets and calls onConfirm when confirmed', async () => {
    const onConfirm = vi.fn();
    render(<DialogConfirmBackup onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(await screen.findByRole('button', { name: /Confirm \(delete seed\)/ }));

    expect(mockClearSecrets).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('opens the backup dialog when Backup methods is clicked', async () => {
    render(<DialogConfirmBackup />);

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(await screen.findByRole('button', { name: /Backup methods/ }));

    expect(await screen.findByTestId('dialog-backup')).toBeInTheDocument();
  });
});
