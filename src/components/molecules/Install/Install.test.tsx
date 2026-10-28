import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ONBOARDING_ROUTES } from '@/app/routes';
import { InstallCard, InstallHeader, InstallNavigation } from './Install';

vi.mock('@/organisms/DialogDownloadPubkyRing/DialogDownloadPubkyRing', () => ({
  DialogDownloadPubkyRing: ({ store }: { store: string }) => <button type="button">{`Download for ${store}`}</button>,
}));

// Mock Next.js Image
vi.mock('next/image', () => ({
  __esModule: true,
  default: ({ src, alt, ...props }: { src: string; alt: string; [key: string]: unknown }) => (
    <img src={src} alt={alt} {...props} />
  ),
}));

// Mock Next.js router
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

// Mock dependencies
const mockReset = vi.fn();
vi.mock('@/stores/onboarding/onboarding.store', () => ({
  useOnboardingStore: () => ({
    reset: mockReset,
  }),
}));

describe('InstallHeader', () => {
  it('renders the Pubky Ring title and subtitle', () => {
    render(<InstallHeader />);

    expect(screen.getByRole('heading', { name: 'Install Pubky Ring.' })).toBeInTheDocument();
    expect(screen.getByText('Pubky Ring.')).toHaveClass('text-brand');
    expect(
      screen.getByText('Pubky Ring is a keychain for your identity keys in the Pubky ecosystem.'),
    ).toBeInTheDocument();
  });
});

describe('InstallCard', () => {
  it('renders the Pubky Ring logo, instructions and both store download buttons', () => {
    render(<InstallCard />);

    expect(screen.getByRole('img', { name: 'Keyring' })).toHaveAttribute('src', '/images/keyring.webp');
    expect(screen.getByRole('img', { name: 'Pubky Ring' })).toHaveAttribute('src', '/images/logo-pubky-ring.svg');
    expect(
      screen.getByText('Download and install the mobile app. Then continue to the next step.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download for apple' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download for android' })).toBeInTheDocument();
  });
});

describe('InstallNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles create button click', () => {
    render(<InstallNavigation />);

    const createButton = screen.getByRole('button', { name: /Create keys in browser/i });
    fireEvent.click(createButton);

    expect(mockPush).toHaveBeenCalledWith(ONBOARDING_ROUTES.PUBKY);
  });

  it('handles continue button click', () => {
    render(<InstallNavigation />);

    const continueButton = screen.getByRole('button', { name: /Continue with Pubky Ring/i });
    fireEvent.click(continueButton);

    expect(mockPush).toHaveBeenCalledWith(ONBOARDING_ROUTES.SCAN);
  });

  it('shows loading state and disables both buttons when create button is clicked', () => {
    render(<InstallNavigation />);

    const createButton = screen.getByRole('button', { name: /Create keys in browser/i });
    const continueButton = screen.getByRole('button', { name: /Continue with Pubky Ring/i });

    expect(createButton).not.toBeDisabled();
    expect(continueButton).not.toBeDisabled();

    fireEvent.click(createButton);

    expect(createButton).toBeDisabled();
    expect(continueButton).toBeDisabled();
  });

  it('shows loading state and disables both buttons when continue button is clicked', () => {
    render(<InstallNavigation />);

    const createButton = screen.getByRole('button', { name: /Create keys in browser/i });
    const continueButton = screen.getByRole('button', { name: /Continue with Pubky Ring/i });

    expect(createButton).not.toBeDisabled();
    expect(continueButton).not.toBeDisabled();

    fireEvent.click(continueButton);

    expect(createButton).toBeDisabled();
    expect(continueButton).toBeDisabled();
  });
});
