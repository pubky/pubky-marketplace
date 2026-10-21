import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createZustandLikeHook } from '@/test-utils/stores';
import { BackupNavigation, BackupPageHeader } from './Backup';

const { mockClearSecrets } = vi.hoisted(() => ({ mockClearSecrets: vi.fn() }));

vi.mock('@/stores/onboarding/onboarding.store', () => ({
  useOnboardingStore: createZustandLikeHook({ clearSecrets: mockClearSecrets }),
}));

// Mock Next.js router
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

// Mock atoms (Button and Dialog stay real so the skip dialog behaves as in the app)
vi.mock('@/atoms/Container/Container', () => {
  return {
    Container: ({ children, className }: { children: React.ReactNode; className?: string }) => (
      <div data-testid="container" className={className}>
        {children}
      </div>
    ),
  };
});

vi.mock('@/atoms/PageHeader/PageHeader', () => {
  return {
    PageHeader: ({ children }: { children: React.ReactNode }) => <div data-testid="page-header">{children}</div>,
  };
});

vi.mock('@/atoms/PageSubtitle/PageSubtitle', () => {
  return {
    PageSubtitle: ({ children }: { children: React.ReactNode }) => <div data-testid="page-subtitle">{children}</div>,
  };
});

// Mock molecules
vi.mock('@/molecules/ButtonsNavigation/ButtonsNavigation', () => {
  return {
    ButtonsNavigation: ({
      className,
      onHandleBackButton,
      onHandleContinueButton,
      loadingContinueButton,
      hiddenBackButton,
      backButtonDisabled,
      backText,
      continueText,
    }: {
      className?: string;
      onHandleBackButton?: () => void;
      onHandleContinueButton?: () => void;
      loadingContinueButton?: boolean;
      hiddenBackButton?: boolean;
      backButtonDisabled?: boolean;
      backText?: string;
      continueText?: string;
    }) => (
      <div data-testid="buttons-navigation" className={className}>
        {!hiddenBackButton && (
          <button data-testid="back-button" onClick={onHandleBackButton} disabled={backButtonDisabled}>
            {backText}
          </button>
        )}
        <button
          data-testid="continue-button"
          onClick={onHandleContinueButton}
          disabled={loadingContinueButton}
          data-loading={loadingContinueButton}
        >
          {continueText}
        </button>
      </div>
    ),
  };
});

vi.mock('@/molecules/Page/Page', () => {
  return {
    PageTitle: ({ children, size }: { children: React.ReactNode; size?: string }) => (
      <h1 data-testid="page-title" data-size={size}>
        {children}
      </h1>
    ),
  };
});

// Mock app
vi.mock('@/app/routes', () => ({
  ONBOARDING_ROUTES: {
    HOMESERVER: '/homeserver',
    PUBKY: '/pubky',
    PROFILE: '/profile',
  },
}));

describe('BackupNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('matches snapshot for default BackupNavigation', () => {
    const { container } = render(<BackupNavigation />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders buttons navigation component with back button', () => {
    render(<BackupNavigation />);

    expect(screen.getByTestId('buttons-navigation')).toBeInTheDocument();
    expect(screen.queryByTestId('back-button')).toBeInTheDocument();
    expect(screen.getByTestId('continue-button')).toBeInTheDocument();
  });

  it('shows loading state when continue button is clicked', () => {
    render(<BackupNavigation />);

    const continueButton = screen.getByTestId('continue-button');
    expect(continueButton).toHaveAttribute('data-loading', 'false');

    fireEvent.click(continueButton);

    expect(continueButton).toHaveAttribute('data-loading', 'true');
  });

  it('renders back button and disables it', () => {
    render(<BackupNavigation />);

    expect(screen.queryByTestId('back-button')).toBeInTheDocument();
    expect(screen.queryByTestId('back-button')).toBeDisabled();
  });

  it('continue navigates to profile without clearing the secrets', () => {
    render(<BackupNavigation />);

    fireEvent.click(screen.getByTestId('continue-button'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/profile');
    expect(mockClearSecrets).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the skip backup dialog from the skip button', () => {
    render(<BackupNavigation />);

    fireEvent.click(screen.getByRole('button', { name: 'Skip backup' }));

    expect(screen.getByRole('dialog', { name: 'Skip backup?' })).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('clears the secrets and navigates to profile when skipping is confirmed', () => {
    render(<BackupNavigation />);

    fireEvent.click(screen.getByRole('button', { name: 'Skip backup' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip and delete phrase' }));

    expect(mockClearSecrets).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/profile');
  });

  it('keeps the secrets and stays on the backup step when skipping is cancelled', () => {
    render(<BackupNavigation />);

    fireEvent.click(screen.getByRole('button', { name: 'Skip backup' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockClearSecrets).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('BackupPageHeader - Snapshots', () => {
  it('matches snapshot for default BackupPageHeader', () => {
    const { container } = render(<BackupPageHeader />);
    expect(container.firstChild).toMatchSnapshot();
  });
});
