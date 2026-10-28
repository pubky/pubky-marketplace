import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ONBOARDING_ROUTES } from '@/app/routes';
import { HomeserverFooter, HomeserverHeader, HomeserverNavigation } from './Homeserver';

// Mock Next.js router
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

// Mock molecules
vi.mock('@/molecules/ButtonsNavigation/ButtonsNavigation', () => {
  return {
    ButtonsNavigation: ({
      className,
      onHandleBackButton,
      onHandleContinueButton,
      continueButtonDisabled,
      continueText,
    }: {
      className?: string;
      onHandleBackButton: () => void;
      onHandleContinueButton: () => void;
      continueButtonDisabled: boolean;
      continueText: string;
    }) => (
      <div data-testid="buttons-navigation" className={className}>
        <button data-testid="back-button" onClick={onHandleBackButton}>
          Back
        </button>
        <button data-testid="continue-button" onClick={onHandleContinueButton} disabled={continueButtonDisabled}>
          {continueText}
        </button>
      </div>
    ),
  };
});

vi.mock('@/molecules/Page/Page', () => {
  return {
    PageTitle: ({ children, size }: { children: React.ReactNode; size?: string }) => (
      <div data-testid="page-title" data-size={size}>
        {children}
      </div>
    ),
  };
});

// Mock organisms
vi.mock('@/organisms/DialogAge/DialogAge', () => {
  return {
    DialogAge: () => <span data-testid="dialog-age">over 18 years old.</span>,
  };
});

vi.mock('@/organisms/DialogPrivacy/DialogPrivacy', () => {
  return {
    DialogPrivacy: () => <span data-testid="dialog-privacy">Privacy Policy</span>,
  };
});

vi.mock('@/organisms/DialogTerms/DialogTerms', () => {
  return {
    DialogTerms: () => <span data-testid="dialog-terms">Terms of Service</span>,
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

describe('HomeserverHeader', () => {
  it('renders the large page title and subtitle inside the page header', () => {
    render(<HomeserverHeader />);

    const header = screen.getByTestId('page-header');
    const title = screen.getByTestId('page-title');
    expect(header).toContainElement(title);
    expect(title).toHaveAttribute('data-size', 'large');
    expect(title).toHaveTextContent('Choose homeserver.');
    expect(screen.getByTestId('page-subtitle')).toHaveTextContent(
      'Enter your invite code to access the Pubky homeserver.',
    );
  });
});

describe('HomeserverFooter', () => {
  it('renders the terms, privacy and age dialogs', () => {
    render(<HomeserverFooter />);

    expect(screen.getByTestId('dialog-terms')).toBeInTheDocument();
    expect(screen.getByTestId('dialog-privacy')).toBeInTheDocument();
    expect(screen.getByTestId('dialog-age')).toBeInTheDocument();
  });
});

describe('HomeserverNavigation', () => {
  const defaultProps = {
    continueButtonDisabled: false,
    onHandleContinueButton: vi.fn(),
    continueText: 'Continue',
  };

  it('renders the navigation buttons', () => {
    render(<HomeserverNavigation {...defaultProps} />);

    expect(screen.getByTestId('back-button')).toBeInTheDocument();
    expect(screen.getByTestId('continue-button')).toBeEnabled();
  });

  it('disables the continue button when continueButtonDisabled', () => {
    render(<HomeserverNavigation {...defaultProps} continueButtonDisabled={true} />);

    expect(screen.getByTestId('continue-button')).toBeDisabled();
  });

  it('renders custom continue text', () => {
    render(<HomeserverNavigation {...defaultProps} continueText="Join Server" />);

    expect(screen.getByTestId('continue-button')).toHaveTextContent('Join Server');
  });

  it('calls onHandleContinueButton when the continue button is clicked', () => {
    const onHandleContinueButton = vi.fn();
    render(<HomeserverNavigation {...defaultProps} onHandleContinueButton={onHandleContinueButton} />);

    fireEvent.click(screen.getByTestId('continue-button'));

    expect(onHandleContinueButton).toHaveBeenCalledTimes(1);
  });

  it('navigates back to the backup route when the back button is clicked', () => {
    render(<HomeserverNavigation {...defaultProps} />);

    fireEvent.click(screen.getByTestId('back-button'));

    expect(mockPush).toHaveBeenCalledWith(ONBOARDING_ROUTES.BACKUP);
  });
});
