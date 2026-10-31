import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGrantSignInAvailable } from '@/hooks/useGrantSignInAvailable/useGrantSignInAvailable';
import { useMobileAuth } from '@/hooks/useMobileAuth/useMobileAuth';
import { asOpaque } from '@/test-utils/type-assertions';
import { SignInContent, SignInFooter } from './SignIn';

// Mock Next.js router
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  usePathname: () => '/sign-in',
}));

// Mock Next.js Image
vi.mock('next/image', () => ({
  __esModule: true,
  default: ({ src, alt, width, height }: { src: string; alt: string; width: number; height: number }) => (
    <img data-testid="next-image" src={src} alt={alt} width={width} height={height} />
  ),
}));

// Mock QRCodeSVG
vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ size }: { size: number }) => (
    <img
      data-testid="next-image"
      src="/images/pubky-ring-qr-example.webp"
      alt="Pubky Ring"
      width={size}
      height={size}
    />
  ),
}));

// Mock signIn store state - mutable for per-test customization
let mockSignInState = {
  authUrlResolved: false,
  profileChecked: false,
  bootstrapFetched: false,
  dataPersisted: false,
  homeserverSynced: false,
  error: null,
};

const resetMockSignInState = () => {
  mockSignInState = {
    authUrlResolved: false,
    profileChecked: false,
    bootstrapFetched: false,
    dataPersisted: false,
    homeserverSynced: false,
    error: null,
  };
};

// Mock dependencies
vi.mock('@/stores/onboarding/onboarding.store', () => ({
  useOnboardingStore: {
    getState: vi.fn().mockReturnValue({
      reset: vi.fn(),
    }),
  },
}));
vi.mock('@/stores/signIn/signIn.store', () => ({
  useSignInStore: vi.fn((selector) => {
    if (typeof selector === 'function') {
      return selector(mockSignInState);
    }
    return mockSignInState;
  }),
}));

// Mock useMobileAuth hook - use vi.hoisted so values are available in vi.mock
const { mockFetchUrl, mockCopyAuthUrl, mockOnAuthorizeClick, mockAuthorizeWith } = vi.hoisted(() => ({
  mockFetchUrl: vi.fn(),
  mockCopyAuthUrl: vi.fn().mockResolvedValue(undefined),
  mockOnAuthorizeClick: vi.fn(),
  mockAuthorizeWith: vi.fn(),
}));
vi.mock('@/hooks/useMobileAuth/useMobileAuth', () => ({
  useMobileAuth: vi.fn(() => ({
    url: 'mock-auth-url',
    isLoading: false,
    isExpired: false,
    fetchUrl: mockFetchUrl,
    copyAuthUrl: mockCopyAuthUrl,
    isOpeningRing: false,
    openingSigner: null,
    onAuthorizeClick: mockOnAuthorizeClick,
    authorizeWith: mockAuthorizeWith,
  })),
}));

vi.mock('@/hooks/useGrantSignInAvailable/useGrantSignInAvailable', () => ({
  useGrantSignInAvailable: vi.fn(() => false),
}));

const privKeys = vi.hoisted(() => ({ requested: false }));
vi.mock('@/config/app', async () => {
  const actual = await vi.importActual<typeof import('@/config/app')>('@/config/app');
  return { ...actual, isPrivKeysRequested: () => privKeys.requested };
});

const passport = vi.hoisted(() => ({ isAvailable: false, isPending: false, start: vi.fn() }));
vi.mock('@/hooks/usePassportSignIn/usePassportSignIn', () => ({
  usePassportSignIn: () => passport,
}));

const resetMobileAuthMock = () => {
  vi.mocked(useMobileAuth).mockReturnValue({
    url: 'mock-auth-url',
    isLoading: false,
    isExpired: false,
    fetchUrl: mockFetchUrl,
    copyAuthUrl: mockCopyAuthUrl,
    isOpeningRing: false,
    openingSigner: null,
    onAuthorizeClick: mockOnAuthorizeClick,
    authorizeWith: mockAuthorizeWith,
  });
};

// Mock molecules used by SignInContent
vi.mock('@/molecules/Content/Content', () => {
  return {
    ContentCard: ({ children, layout }: { children: React.ReactNode; layout?: string }) => (
      <div data-testid="content-card" data-layout={layout}>
        {children}
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

vi.mock('@/molecules/Toaster/use-toast', () => {
  return {
    toast: vi.fn(),
  };
});

// Mock copyToClipboard function - use vi.hoisted to ensure it's available before vi.mock runs
const { mockCopyToClipboard } = vi.hoisted(() => ({
  mockCopyToClipboard: vi.fn().mockResolvedValue(undefined),
}));

// Mock atoms
vi.mock('@/atoms/Button/Button', () => {
  return {
    Button: ({
      asChild,
      children,
      className,
      size,
      ...props
    }: {
      asChild?: boolean;
      children: React.ReactNode;
      className?: string;
      size?: string;
    } & React.ButtonHTMLAttributes<HTMLButtonElement>) => {
      if (asChild && React.isValidElement(children)) {
        return React.cloneElement(children, {
          ...props,
          'data-testid': 'button',
          className: [className, (children.props as { className?: string }).className].filter(Boolean).join(' '),
        } as Record<string, unknown>);
      }
      return (
        <button data-testid="button" className={className} data-size={size} {...props}>
          {children}
        </button>
      );
    },
  };
});

vi.mock('@/atoms/Container/Container', () => {
  return {
    Container: ({ children, className }: { children: React.ReactNode; className?: string }) => (
      <div data-testid="container" className={className}>
        {children}
      </div>
    ),
  };
});

vi.mock('@/atoms/FooterLinks/FooterLinks', () => {
  return {
    FooterLinks: ({ children }: { children: React.ReactNode }) => <div data-testid="footer-links">{children}</div>,
  };
});

vi.mock('@/atoms/Link/Link', () => {
  return {
    Link: ({
      children,
      href,
      target,
      rel,
    }: {
      children: React.ReactNode;
      href: string;
      target?: string;
      rel?: string;
    }) => (
      <a data-testid="link" href={href} target={target} rel={rel}>
        {children}
      </a>
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

vi.mock('@/atoms/Typography/Typography', () => {
  return {
    Typography: ({
      children,
      as,
      size,
      className,
      overrideDefaults: _overrideDefaults,
      ...props
    }: {
      children: React.ReactNode;
      as?: React.ElementType;
      size?: string;
      className?: string;
      overrideDefaults?: boolean;
    }) => {
      const Tag = as || 'span';
      return React.createElement(
        Tag,
        { 'data-testid': 'typography', className, 'data-size': size, ...props },
        children,
      );
    },
  };
});

describe('SignInContent', () => {
  const originalLocation = window.location;
  const clipboardMock = { writeText: vi.fn().mockResolvedValue(undefined) };

  beforeAll(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: asOpaque<Location>({ ...asOpaque<object>(originalLocation), href: '' }),
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: clipboardMock,
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    window.location.href = '';
    clipboardMock.writeText.mockClear();
    mockCopyToClipboard.mockClear();
    mockCopyAuthUrl.mockClear();
    resetMockSignInState();
    resetMobileAuthMock();
  });

  afterAll(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
  });

  it('renders desktop and mobile content containers', async () => {
    await act(async () => {
      render(<SignInContent />);
    });

    const containers = screen.getAllByTestId('container');
    expect(containers.length).toBeGreaterThan(0);

    // Check for desktop container (hidden md:flex)
    const desktopContainer = containers.find((container) => container.className.includes('hidden md:flex'));
    expect(desktopContainer).toBeInTheDocument();

    // Check for mobile container (md:hidden)
    const mobileContainer = containers.find((container) => container.className.includes('md:hidden'));
    expect(mobileContainer).toBeInTheDocument();
  });

  it('renders QR code image in desktop version', async () => {
    await act(async () => {
      render(<SignInContent />);
    });

    // Wait for the component to finish loading and show QR code
    await waitFor(() => {
      const images = screen.getAllByTestId('next-image');
      const qrImage = images.find((img) => img.getAttribute('src') === '/images/pubky-ring-qr-example.webp');
      expect(qrImage).toBeInTheDocument();
    });

    const images = screen.getAllByTestId('next-image');
    const qrImage = images.find((img) => img.getAttribute('src') === '/images/pubky-ring-qr-example.webp');

    expect(qrImage).toHaveAttribute('alt', 'Pubky Ring');
    expect(qrImage).toHaveAttribute('width', '176');
    expect(qrImage).toHaveAttribute('height', '176');
  });

  it('renders scan illustration beside the QR on desktop', async () => {
    await act(async () => {
      render(<SignInContent />);
    });

    expect(screen.getByTestId('sign-in-qr-card')).toBeInTheDocument();
    expect(screen.getByAltText('Pubky Ring phone scanning a QR code')).toHaveAttribute('src', '/images/scan.webp');
  });

  it('renders logo and button in mobile version', async () => {
    await act(async () => {
      render(<SignInContent />);
    });

    // Wait for the component to finish loading
    await waitFor(() => {
      expect(screen.getByText('Authorize')).toBeInTheDocument();
    });

    const images = screen.getAllByTestId('next-image');
    const logoImage = images.find((img) => img.getAttribute('src') === '/images/logo-pubky-ring.svg');

    expect(logoImage).toBeInTheDocument();
    expect(logoImage).toHaveAttribute('alt', 'Pubky Ring');
    expect(logoImage).toHaveAttribute('width', '137');
    expect(logoImage).toHaveAttribute('height', '30');

    expect(screen.getByRole('button', { name: /Authorize/i })).toBeInTheDocument();
  });

  it('calls mobile authorize handler when button is tapped', async () => {
    await act(async () => {
      render(<SignInContent />);
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Authorize/i })).not.toBeDisabled();
    });

    const authorizeButton = screen.getByRole('button', { name: /Authorize/i });
    await act(async () => {
      fireEvent.click(authorizeButton);
    });

    expect(mockOnAuthorizeClick).toHaveBeenCalledTimes(1);
  });

  // Note: Retry logic and error handling for auth URL generation are now tested
  // in useAuthUrl.test.tsx since that logic was extracted to the hook

  // Note: Unmount cleanup and request deduplication are tested in useAuthUrl.test.tsx

  it('button disabled when loading', async () => {
    vi.mocked(useMobileAuth).mockReturnValue({
      url: '',
      isLoading: true,
      isExpired: false,
      fetchUrl: mockFetchUrl,
      copyAuthUrl: mockCopyAuthUrl,
      isOpeningRing: false,
      openingSigner: null,
      onAuthorizeClick: mockOnAuthorizeClick,
      authorizeWith: mockAuthorizeWith,
    });

    await act(async () => {
      render(<SignInContent />);
    });

    const button = screen.getByRole('button', { name: /Generating/i });
    expect(button).toBeDisabled();
  });

  it('does not print requested capability paths beside the QR', async () => {
    const { CAPABILITIES } = await import('@/config/app');
    await act(async () => {
      render(<SignInContent />);
    });
    expect(screen.queryByText(CAPABILITIES)).not.toBeInTheDocument();
    expect(screen.queryByText(/compare it before approving/i)).not.toBeInTheDocument();
  });

  it('renders content cards with column layout', async () => {
    await act(async () => {
      render(<SignInContent />);
    });

    const contentCards = screen.getAllByTestId('content-card');
    contentCards.forEach((card) => {
      expect(card).toHaveAttribute('data-layout', 'column');
    });
  });

  // Note: Loading state tests removed due to complexity with async mocking

  it('copies auth URL to clipboard when QR code is clicked', async () => {
    vi.mocked(useMobileAuth).mockReturnValue({
      url: 'pubkyring://authorize?token=test123',
      isLoading: false,
      isExpired: false,
      fetchUrl: mockFetchUrl,
      copyAuthUrl: mockCopyAuthUrl,
      isOpeningRing: false,
      openingSigner: null,
      onAuthorizeClick: mockOnAuthorizeClick,
      authorizeWith: mockAuthorizeWith,
    });

    const { toast } = await import('@/molecules/Toaster/use-toast');

    await act(async () => {
      render(<SignInContent />);
    });

    // Find the QR button by aria-label
    const qrButton = screen.getByLabelText('Copy authentication link');
    await act(async () => {
      fireEvent.click(qrButton);
    });

    expect(mockCopyAuthUrl).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({
      variant: 'info',
      title: 'Authentication link copied',
    });
  });

  it('shows error toast when copying auth URL fails', async () => {
    mockCopyAuthUrl.mockRejectedValueOnce(new Error('Clipboard denied'));
    vi.mocked(useMobileAuth).mockReturnValue({
      url: 'pubkyring://authorize?token=test123',
      isLoading: false,
      isExpired: false,
      fetchUrl: mockFetchUrl,
      copyAuthUrl: mockCopyAuthUrl,
      isOpeningRing: false,
      openingSigner: null,
      onAuthorizeClick: mockOnAuthorizeClick,
      authorizeWith: mockAuthorizeWith,
    });

    const { toast } = await import('@/molecules/Toaster/use-toast');

    await act(async () => {
      render(<SignInContent />);
    });

    const qrButton = screen.getByLabelText('Copy authentication link');
    await act(async () => {
      fireEvent.click(qrButton);
    });

    expect(mockCopyAuthUrl).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({
      variant: 'error',
      description: 'Could not copy to clipboard',
    });
  });

  it('shows the reload affordance when auth flow is expired', async () => {
    vi.mocked(useMobileAuth).mockReturnValue({
      url: '',
      isLoading: false,
      isExpired: true,
      fetchUrl: mockFetchUrl,
      copyAuthUrl: mockCopyAuthUrl,
      isOpeningRing: false,
      openingSigner: null,
      onAuthorizeClick: mockOnAuthorizeClick,
      authorizeWith: mockAuthorizeWith,
    });

    await act(async () => {
      render(<SignInContent />);
    });

    const reloadQr = screen.getByLabelText('Reload sign-in QR code');
    expect(reloadQr).toBeEnabled();
    expect(screen.getAllByText('Click to reload').length).toBeGreaterThan(0);
  });

  it('calls fetchUrl when the blurred QR reload is clicked', async () => {
    vi.mocked(useMobileAuth).mockReturnValue({
      url: '',
      isLoading: false,
      isExpired: true,
      fetchUrl: mockFetchUrl,
      copyAuthUrl: mockCopyAuthUrl,
      isOpeningRing: false,
      openingSigner: null,
      onAuthorizeClick: mockOnAuthorizeClick,
      authorizeWith: mockAuthorizeWith,
    });

    await act(async () => {
      render(<SignInContent />);
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Reload sign-in QR code'));
    });

    expect(mockFetchUrl).toHaveBeenCalledTimes(1);
  });
});

describe('SignInContent - one QR for Pubky Ring and Bitkit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMockSignInState();
    resetMobileAuthMock();
    vi.mocked(useGrantSignInAvailable).mockReturnValue(false);
  });

  afterEach(() => {
    vi.mocked(useGrantSignInAvailable).mockReturnValue(false);
  });

  it('shows no signer QR without delegation', async () => {
    await act(async () => {
      render(<SignInContent />);
    });

    expect(screen.queryByTestId('sign-in-qr')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sign-in-grant-button')).not.toBeInTheDocument();
  });

  it('shows one QR with one scan line and both logos, and no signer toggle', async () => {
    vi.mocked(useGrantSignInAvailable).mockReturnValue(true);
    const { container } = render(<SignInContent />);

    expect(screen.getAllByTestId('sign-in-qr')).toHaveLength(1);
    expect(screen.getAllByTestId('qr-auth-url')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Copy authentication link' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Copy Bitkit authentication link' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getAllByText('Scan with Pubky Ring or Bitkit.')).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/preferred keychain|Scan with Bitkit\.|Scan with Pubky Ring\./);
    expect(container.querySelector('[aria-label="Pubky Ring"]')).toBeInTheDocument();
    expect(container.querySelector('[aria-label="Bitkit"]')).toBeInTheDocument();
  });

  it('starts one sign-in flow for both signers', async () => {
    vi.mocked(useGrantSignInAvailable).mockReturnValue(true);
    await act(async () => {
      render(<SignInContent />);
    });

    expect(vi.mocked(useMobileAuth).mock.calls.length).toBeGreaterThan(0);
    for (const [options] of vi.mocked(useMobileAuth).mock.calls) {
      expect(options).toEqual({});
    }
  });

  it('shows no identity hint', async () => {
    vi.mocked(useGrantSignInAvailable).mockReturnValue(true);
    await act(async () => {
      render(<SignInContent />);
    });

    expect(
      screen.queryByText("New Bitkit users must create a Pubky identity in Bitkit's profile before scanning."),
    ).not.toBeInTheDocument();
  });

  it('offers a separate Authorize button per signer on mobile, each opening its own app', async () => {
    vi.mocked(useGrantSignInAvailable).mockReturnValue(true);
    render(<SignInContent />);

    fireEvent.click(screen.getByRole('button', { name: 'Authorize with Pubky Ring' }));
    expect(mockAuthorizeWith).toHaveBeenCalledTimes(1);
    expect(mockAuthorizeWith).toHaveBeenLastCalledWith('ring');
    fireEvent.click(screen.getByRole('button', { name: 'Authorize with Bitkit' }));
    expect(mockAuthorizeWith).toHaveBeenCalledTimes(2);
    expect(mockAuthorizeWith).toHaveBeenLastCalledWith('bitkit');
    expect(mockOnAuthorizeClick).not.toHaveBeenCalled();
  });

  it('shows the launch state on the button that was tapped only', async () => {
    vi.mocked(useGrantSignInAvailable).mockReturnValue(true);
    vi.mocked(useMobileAuth).mockReturnValue({
      url: 'auth-url',
      isLoading: false,
      isExpired: false,
      fetchUrl: mockFetchUrl,
      copyAuthUrl: mockCopyAuthUrl,
      isOpeningRing: true,
      openingSigner: 'bitkit',
      onAuthorizeClick: mockOnAuthorizeClick,
      authorizeWith: mockAuthorizeWith,
    });
    render(<SignInContent />);

    expect(screen.getByTestId('sign-in-grant-button')).toHaveTextContent('Opening Bitkit...');
    expect(screen.getByTestId('button')).toHaveTextContent('Authorize with Pubky Ring');
  });

  it('copies the one flow URL when the QR is clicked', async () => {
    vi.mocked(useGrantSignInAvailable).mockReturnValue(true);
    await act(async () => {
      render(<SignInContent />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy authentication link' }));
    });

    expect(mockCopyAuthUrl).toHaveBeenCalledTimes(1);
  });
});

describe('SignInContent - sign-in without scoped keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMockSignInState();
    resetMobileAuthMock();
    vi.mocked(useGrantSignInAvailable).mockReturnValue(true);
    privKeys.requested = true;
  });

  afterEach(() => {
    privKeys.requested = false;
    vi.mocked(useGrantSignInAvailable).mockReturnValue(false);
  });

  const withoutKeys = () => screen.queryByTestId('sign-in-without-keys-button');

  it('offers the sign-in without keys beside the QR when keys are requested', async () => {
    await act(async () => {
      render(<SignInContent />);
    });

    expect(withoutKeys()).toBeInTheDocument();
  });

  it('does not offer it when the deploy does not request keys', async () => {
    privKeys.requested = false;
    await act(async () => {
      render(<SignInContent />);
    });

    expect(withoutKeys()).not.toBeInTheDocument();
    expect(useMobileAuth).not.toHaveBeenCalledWith({ withPrivKeys: false });
  });

  it('asks for the grant with keys until the user chooses to sign in without them', async () => {
    await act(async () => {
      render(<SignInContent />);
    });
    expect(useMobileAuth).toHaveBeenCalledWith({});
    expect(useMobileAuth).not.toHaveBeenCalledWith({ withPrivKeys: false });

    await act(async () => {
      fireEvent.click(withoutKeys() as HTMLElement);
    });

    expect(useMobileAuth).toHaveBeenLastCalledWith({ withPrivKeys: false });
    expect(withoutKeys()).not.toBeInTheDocument();
  });
});

describe('SignInContent - Progress View', () => {
  const clipboardMock = { writeText: vi.fn().mockResolvedValue(undefined) };

  beforeAll(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: clipboardMock,
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockSignInState();
    resetMobileAuthMock();
  });

  it('renders progress view when authUrlResolved is true', async () => {
    mockSignInState.authUrlResolved = true;

    await act(async () => {
      render(<SignInContent />);
    });

    expect(screen.getByText('Signing in.')).toBeInTheDocument();
    expect(screen.getByText('Please wait while your Pubky experience loads.')).toBeInTheDocument();

    // Should show all 4 step labels
    expect(screen.getByText('Setting up')).toBeInTheDocument();
    expect(screen.getByText('Loading your data')).toBeInTheDocument();
    expect(screen.getByText('Building your feed')).toBeInTheDocument();
    expect(screen.getByText('Syncing settings')).toBeInTheDocument();
  });

  it('shows first step as running and remaining as pending when none completed', async () => {
    mockSignInState.authUrlResolved = true;

    await act(async () => {
      render(<SignInContent />);
    });

    const verifyingLabel = screen.getByText('Setting up');
    const loadingLabel = screen.getByText('Loading your data');
    const buildingLabel = screen.getByText('Building your feed');
    const syncingLabel = screen.getByText('Syncing settings');

    // First step: running (spinner icon + text-foreground)
    expect(verifyingLabel.className).toContain('text-foreground');
    expect(verifyingLabel.closest('div')?.querySelector('.lucide-loader-circle')).toBeInTheDocument();

    // Remaining steps: pending (circle icon + text-muted-foreground)
    expect(loadingLabel.className).toContain('text-muted-foreground');
    expect(loadingLabel.closest('div')?.querySelector('.lucide-circle')).toBeInTheDocument();

    expect(buildingLabel.className).toContain('text-muted-foreground');
    expect(syncingLabel.className).toContain('text-muted-foreground');
  });

  it('shows completed steps with check icon and currently running step with spinner', async () => {
    mockSignInState.authUrlResolved = true;
    mockSignInState.profileChecked = true;
    mockSignInState.bootstrapFetched = true;

    await act(async () => {
      render(<SignInContent />);
    });

    const verifyingLabel = screen.getByText('Setting up');
    const loadingLabel = screen.getByText('Loading your data');
    const buildingLabel = screen.getByText('Building your feed');
    const syncingLabel = screen.getByText('Syncing settings');

    // First two steps: completed (check icon + font-bold)
    expect(verifyingLabel.className).toContain('font-bold');
    expect(verifyingLabel.closest('div')?.querySelector('.lucide-circle-check-big')).toBeInTheDocument();

    expect(loadingLabel.className).toContain('font-bold');
    expect(loadingLabel.closest('div')?.querySelector('.lucide-circle-check-big')).toBeInTheDocument();

    // Third step: running (spinner)
    expect(buildingLabel.className).toContain('text-foreground');
    expect(buildingLabel.className).not.toContain('font-bold');
    expect(buildingLabel.closest('div')?.querySelector('.lucide-loader-circle')).toBeInTheDocument();

    // Fourth step: pending
    expect(syncingLabel.className).toContain('text-muted-foreground');
    expect(syncingLabel.closest('div')?.querySelector('.lucide-circle')).toBeInTheDocument();
  });

  it('does not render QR code or mobile button when showing progress', async () => {
    mockSignInState.authUrlResolved = true;

    await act(async () => {
      render(<SignInContent />);
    });

    // Should not have the authorize button
    expect(screen.queryByText('Authorize')).not.toBeInTheDocument();

    // Should not have the desktop/mobile specific containers
    const containers = screen.getAllByTestId('container');
    const desktopContainer = containers.find((c) => c.className.includes('hidden md:flex'));
    const mobileContainer = containers.find((c) => c.className.includes('md:hidden'));
    expect(desktopContainer).toBeUndefined();
    expect(mobileContainer).toBeUndefined();
  });
});

describe('SignInFooter', () => {
  beforeEach(() => {
    resetMockSignInState();
  });

  it('renders footer with recovery message', () => {
    render(<SignInFooter />);

    expect(
      screen.getByText(
        'Not able to sign in with a keychain? Use the recovery phrase or encrypted file to restore your account.',
      ),
    ).toBeInTheDocument();
  });

  it('does not render in progress view', () => {
    mockSignInState.authUrlResolved = true;

    render(<SignInFooter />);

    expect(screen.queryByTestId('footer-links')).not.toBeInTheDocument();
  });
});

describe('SignInContent - Continue with Google (Pubky Passport)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignInState.authUrlResolved = false;
    resetMobileAuthMock();
    passport.isAvailable = true;
    passport.isPending = false;
    vi.mocked(useGrantSignInAvailable).mockReturnValue(true);
  });

  afterEach(() => {
    passport.isAvailable = false;
  });

  it('offers Continue with Google beside the Ring and Bitkit QR on desktop and mobile', async () => {
    await act(async () => {
      render(<SignInContent />);
    });

    const buttons = screen.getAllByRole('button', { name: 'Continue with Google' });
    expect(buttons).toHaveLength(1);
    expect(screen.getByTestId('sign-in-passport-option')).toHaveTextContent(/^Continue with Google$/);
    expect(document.body.textContent).not.toMatch(/Messages are not available|creates your Pubky identity/i);
    expect(screen.queryByRole('button', { name: /Continue with Apple/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('sign-in-qr')).toBeInTheDocument();
  });

  it('starts the Passport attempt from the click itself', async () => {
    await act(async () => {
      render(<SignInContent />);
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Continue with Google' })[0]);

    expect(passport.start).toHaveBeenCalledTimes(1);
  });

  it('disables the button while Passport is open', async () => {
    passport.isPending = true;
    await act(async () => {
      render(<SignInContent />);
    });

    for (const button of screen.getAllByTestId('sign-in-passport-button')) {
      expect(button).toBeDisabled();
      expect(button).toHaveTextContent('Waiting for Pubky Passport...');
    }
  });

  it('is not offered where the grant key cannot be held', async () => {
    vi.mocked(useGrantSignInAvailable).mockReturnValue(false);
    await act(async () => {
      render(<SignInContent />);
    });

    expect(screen.queryByRole('button', { name: 'Continue with Google' })).not.toBeInTheDocument();
  });

  it('is not offered when the deploy turned Passport off', async () => {
    passport.isAvailable = false;
    await act(async () => {
      render(<SignInContent />);
    });

    expect(screen.queryByTestId('sign-in-passport-option')).not.toBeInTheDocument();
    expect(screen.getByTestId('sign-in-qr')).toBeInTheDocument();
  });
});
