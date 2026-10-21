import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createZustandLikeHook } from '@/test-utils/stores';
import { DialogSkipBackup } from './DialogSkipBackup';

const { mockClearSecrets } = vi.hoisted(() => ({ mockClearSecrets: vi.fn() }));

vi.mock('@/stores/onboarding/onboarding.store', () => ({
  useOnboardingStore: createZustandLikeHook({ clearSecrets: mockClearSecrets }),
}));

const openDialog = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Skip backup' }));
};

describe('DialogSkipBackup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders only the Skip backup trigger while closed', () => {
    render(<DialogSkipBackup onConfirm={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Skip backup' })).toHaveAttribute('id', 'backup-navigation-skip-btn');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the confirmation dialog from the trigger', () => {
    render(<DialogSkipBackup onConfirm={vi.fn()} />);

    openDialog();

    expect(screen.getByRole('dialog', { name: 'Skip backup?' })).toBeInTheDocument();
  });

  it('clears the secrets before running onConfirm, then closes', () => {
    const onConfirm = vi.fn();
    render(<DialogSkipBackup onConfirm={onConfirm} />);

    openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Skip and delete phrase' }));

    expect(mockClearSecrets).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(mockClearSecrets.mock.invocationCallOrder[0]).toBeLessThan(onConfirm.mock.invocationCallOrder[0]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the secrets when cancelled', () => {
    const onConfirm = vi.fn();
    render(<DialogSkipBackup onConfirm={onConfirm} />);

    openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockClearSecrets).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('DialogSkipBackup - Snapshots', () => {
  it('matches snapshot for the closed trigger', () => {
    const { container } = render(<DialogSkipBackup onConfirm={vi.fn()} triggerClassName="md:self-end" />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('matches snapshot for the open dialog', () => {
    render(<DialogSkipBackup onConfirm={vi.fn()} />);
    openDialog();
    expect(screen.getByRole('dialog')).toMatchSnapshot();
  });
});
