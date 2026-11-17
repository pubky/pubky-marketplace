import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNT_ROUTES, AUTH_ROUTES, HOME_ROUTES, ROOT_ROUTES } from '@/app/routes';
import { setEmbedded } from '@/test-utils/embedded';
import { Header } from './Header';

// Mock Next.js navigation
const mockUsePathname = vi.fn();
const mockUseRouter = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
  useRouter: () => mockUseRouter(),
}));

// Mock auth store - use selector pattern (component calls useAuthStore with selector function)
let mockCurrentUserPubky: string | null = null;
let mockHasSession = true;
// Mock dexie-react-hooks
vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: vi.fn(() => ({ name: 'Test User', image: 'test-image.jpg' })),
}));

// Mock atoms, libs, config, and app
vi.mock('@/atoms/Avatar/Avatar', () => {
  return {
    Avatar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    AvatarImage: ({ src }: { src?: string }) => <img src={src} alt="avatar" />,
    AvatarFallback: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  };
});

vi.mock('@/atoms/Badge/Badge', () => {
  return {
    Badge: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

vi.mock('@/atoms/Button/Button', () => {
  return {
    Button: ({ children, onClick, variant }: { children: React.ReactNode; onClick?: () => void; variant?: string }) => (
      <button onClick={onClick} data-variant={variant}>
        {children}
      </button>
    ),
  };
});

vi.mock('@/atoms/Container/Container', () => {
  return {
    Container: ({ children, className }: { children: React.ReactNode; className?: string }) => (
      <div className={className}>{children}</div>
    ),
  };
});

vi.mock('@/atoms/Link/Link', () => {
  return {
    Link: ({ children, href }: { children: React.ReactNode; href?: string }) => <a href={href}>{children}</a>,
  };
});

vi.mock('@/atoms/Typography/Typography', () => {
  return {
    Typography: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  };
});

// Keep real libs for icons and utilities; only stub helpers we rely on for deterministic tests

vi.mock('@/config/externalLinks', () => ({
  GITHUB_URL: 'https://github.com',
  TWITTER_GETPUBKY_URL: 'https://twitter.com',
  TELEGRAM_URL: 'https://telegram.com',
}));

vi.mock('@/app/routes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/routes')>();
  return {
    ...actual,
    AUTH_ROUTES: { SIGN_IN: '/sign-in', LOGOUT: '/logout' },
    HOME_ROUTES: { HOME: '/home' },
    ROOT_ROUTES: '/',
  };
});

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: { currentUserPubky: string | null; session: object | null }) => unknown) =>
    selector({ currentUserPubky: mockCurrentUserPubky, session: mockHasSession && mockCurrentUserPubky ? {} : null }),
}));
vi.mock('@/stores/notification/notification.store', () => ({
  useNotificationStore: () => ({ selectUnread: () => 0 }),
}));
vi.mock('@/controllers/profile/profile', () => ({
  ProfileController: {
    read: vi.fn(() => Promise.resolve({ name: 'Test User', image: 'test-image.jpg' })),
  },
}));
vi.mock('@/controllers/file/file', () => ({
  FileController: {
    getAvatarUrl: vi.fn((pubky: string) => `https://cdn.example.com/avatar/${pubky}`),
  },
}));
vi.mock('@/database/franky/franky', () => ({
  db: {
    user_details: {
      get: vi.fn(() => Promise.resolve({ name: 'Test User', image: 'test-image.jpg' })),
    },
  },
}));

// Mock molecules
vi.mock('@/molecules/Header/Header', () => {
  return {
    HeaderContainer: ({
      children,
      className,
      classNameNav,
    }: {
      children: React.ReactNode;
      className?: string;
      classNameNav?: string;
    }) => (
      <div data-testid="header-container" data-class-name={className} data-class-name-nav={classNameNav}>
        {children}
      </div>
    ),
    HeaderTitle: ({ currentTitle }: { currentTitle: string }) => <div data-testid="header-title">{currentTitle}</div>,
    HeaderSocialLinks: () => <div data-testid="header-social-links">Social Links</div>,
    HeaderNavigationButtons: ({ avatarImage, avatarInitial }: { avatarImage?: string; avatarInitial?: string }) => (
      <div data-testid="header-navigation-buttons" data-avatar-image={avatarImage} data-avatar-initial={avatarInitial}>
        Navigation Buttons
      </div>
    ),
    HeaderExploreNavigationButtons: () => <div data-testid="header-explore-navigation-buttons">Explore Navigation</div>,
  };
});

vi.mock('@/molecules/HeaderHome/HeaderHome', () => {
  return {
    HeaderHome: () => (
      <div data-testid="header-home">
        <div data-testid="header-social-links">Social Links</div>
        <button>Sign in</button>
      </div>
    ),
  };
});

vi.mock('@/molecules/HeaderSignIn/HeaderSignIn', () => {
  return {
    HeaderSignIn: () => (
      <div data-testid="header-sign-in">
        <div data-testid="search-input">Search Input</div>
        <div data-testid="header-navigation-buttons">Navigation Buttons</div>
      </div>
    ),
  };
});

vi.mock('@/molecules/Logo/Logo', () => {
  return {
    Logo: ({ noLink }: { noLink?: boolean }) => (
      <div data-testid="logo" data-no-link={noLink}>
        Logo
      </div>
    ),
  };
});

vi.mock('@/organisms/SearchInput/SearchInput', () => {
  return {
    SearchInput: () => <div data-testid="search-input">Search Input</div>,
  };
});

// Mock hooks
const mockIsPublicRoute = vi.fn();
const mockIsCoreExploreRoute = vi.fn();
vi.mock('@/hooks/useCurrentUserProfile/useCurrentUserProfile', () => ({
  useCurrentUserProfile: vi.fn(() => ({
    userDetails: { name: 'Test User', image: 'test-image.jpg' },
    currentUserPubky: 'test-pubky-123',
  })),
}));

vi.mock('@/hooks/usePublicRoute/usePublicRoute', () => ({
  usePublicRoute: () => ({
    isPublicRoute: mockIsPublicRoute(),
    isDynamicPublicRoute: mockIsPublicRoute(),
    isCoreExploreRoute: mockIsCoreExploreRoute(),
    isPublicExploreRoute: mockIsPublicRoute() || mockIsCoreExploreRoute(),
  }),
}));

describe('Header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock return values
    mockCurrentUserPubky = null; // Not authenticated by default
    mockUsePathname.mockReturnValue(ROOT_ROUTES);
    mockUseRouter.mockReturnValue({ push: vi.fn() });
    mockIsPublicRoute.mockReturnValue(false);
    mockIsCoreExploreRoute.mockReturnValue(false);
  });

  describe('embedded in another app', () => {
    afterEach(() => setEmbedded(false));

    it('renders no header chrome so the host app owns the page navigation', () => {
      setEmbedded(true);
      mockCurrentUserPubky = 'test-pubky-123';
      mockUsePathname.mockReturnValue(HOME_ROUTES.HOME);

      const { container } = render(<Header />);

      expect(container).toBeEmptyDOMElement();
    });

    it('renders no header chrome on the signed-out root route either', () => {
      setEmbedded(true);
      mockUsePathname.mockReturnValue(ROOT_ROUTES);

      const { container } = render(<Header />);

      expect(container).toBeEmptyDOMElement();
    });
  });

  it('renders header container with logo and home header', () => {
    mockUsePathname.mockReturnValue(ROOT_ROUTES);

    render(<Header />);

    expect(screen.getByTestId('header-container')).toBeInTheDocument();
    expect(screen.getByTestId('logo')).toBeInTheDocument();
    // HeaderHome renders social links and sign in button
    expect(screen.getByTestId('header-social-links')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('hides header container on mobile when signed in outside onboarding', () => {
    mockCurrentUserPubky = 'test-pubky-123';
    mockUsePathname.mockReturnValue(HOME_ROUTES.HOME);

    render(<Header />);

    const headerContainer = screen.getByTestId('header-container');
    expect(headerContainer).toHaveAttribute('data-class-name', 'hidden lg:block');
  });

  it('handles unknown paths with default values', () => {
    mockUsePathname.mockReturnValue('/unknown-path');

    render(<Header />);

    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByTestId('logo')).toBeInTheDocument();
  });

  describe('Authentication Logic', () => {
    it('does not render HeaderTitle when user is authenticated', () => {
      mockCurrentUserPubky = 'test-pubky-123';
      mockUsePathname.mockReturnValue(ROOT_ROUTES);

      render(<Header />);

      expect(screen.queryByTestId('header-title')).not.toBeInTheDocument();
    });

    it('renders HomeHeader when user is not authenticated', () => {
      mockCurrentUserPubky = null;
      mockUsePathname.mockReturnValue(ROOT_ROUTES);

      render(<Header />);

      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
      expect(screen.queryByTestId('search-input')).not.toBeInTheDocument();
    });
  });

  describe('HeaderTitle Display Logic', () => {
    it('does not render HeaderTitle for unauthenticated users on public routes', () => {
      mockCurrentUserPubky = null;
      mockUsePathname.mockReturnValue(ROOT_ROUTES);

      render(<Header />);

      // No title should be shown on public routes (like /, /profile/[pubky], /post/[x]/[y])
      // This matches Pubky-app behavior where header shows just Logo + Join button
      expect(screen.queryByTestId('header-title')).not.toBeInTheDocument();
    });

    it('renders HeaderTitle for unauthenticated users on logout route', () => {
      mockCurrentUserPubky = null;
      mockUsePathname.mockReturnValue(AUTH_ROUTES.LOGOUT);

      render(<Header />);

      expect(screen.getByTestId('header-title')).toBeInTheDocument();
      expect(screen.getByTestId('header-title')).toHaveTextContent('Signed out');
    });

    it('does not render HeaderTitle when signed in and not on step 5', () => {
      mockCurrentUserPubky = 'test-pubky-123';
      mockUsePathname.mockReturnValue(ROOT_ROUTES);

      render(<Header />);

      expect(screen.queryByTestId('header-title')).not.toBeInTheDocument();
    });
  });

  describe('Public Route Behavior', () => {
    it('renders explore navigation when unauthenticated on another user profile', () => {
      mockCurrentUserPubky = null;
      mockIsPublicRoute.mockReturnValue(true);
      mockIsCoreExploreRoute.mockReturnValue(false);
      mockUsePathname.mockReturnValue('/profile/o1gg96ewuojmopcjbz8895478wdtxtzzber7aezq6ror5a91j7dy');

      render(<Header />);

      expect(screen.getByTestId('header-explore-navigation-buttons')).toBeInTheDocument();
      expect(screen.queryByTestId('header-home')).not.toBeInTheDocument();
      expect(screen.queryByTestId('header-sign-in')).not.toBeInTheDocument();
    });

    it('renders explore navigation when unauthenticated on a post page', () => {
      mockCurrentUserPubky = null;
      mockIsPublicRoute.mockReturnValue(true);
      mockIsCoreExploreRoute.mockReturnValue(false);
      mockUsePathname.mockReturnValue('/post/o1gg96ewuojmopcjbz8895478wdtxtzzber7aezq6ror5a91j7dy/0034BBBDFK83G');

      render(<Header />);

      expect(screen.getByTestId('header-explore-navigation-buttons')).toBeInTheDocument();
    });

    it('renders explore navigation when unauthenticated on the collections overview', () => {
      mockCurrentUserPubky = null;
      mockIsPublicRoute.mockReturnValue(false);
      mockIsCoreExploreRoute.mockReturnValue(true);
      mockUsePathname.mockReturnValue('/collections');

      render(<Header />);

      expect(screen.getByTestId('header-explore-navigation-buttons')).toBeInTheDocument();
    });

    it('renders explore navigation when unauthenticated on a single collection page', () => {
      mockCurrentUserPubky = null;
      mockIsPublicRoute.mockReturnValue(true);
      mockIsCoreExploreRoute.mockReturnValue(false);
      mockUsePathname.mockReturnValue(
        '/collections/o1gg96ewuojmopcjbz8895478wdtxtzzber7aezq6ror5a91j7dy/0034BBBDFK83G',
      );

      render(<Header />);

      expect(screen.getByTestId('header-explore-navigation-buttons')).toBeInTheDocument();
    });

    it('renders HeaderHome when unauthenticated on non-public route', () => {
      mockCurrentUserPubky = null;
      mockIsPublicRoute.mockReturnValue(false);
      mockIsCoreExploreRoute.mockReturnValue(false);
      mockUsePathname.mockReturnValue(ROOT_ROUTES);

      render(<Header />);

      expect(screen.getByTestId('header-home')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    });

    it('renders the signed-out header on the sign-in route', () => {
      mockCurrentUserPubky = null;
      mockIsPublicRoute.mockReturnValue(false);
      mockIsCoreExploreRoute.mockReturnValue(false);
      mockUsePathname.mockReturnValue(AUTH_ROUTES.SIGN_IN);

      render(<Header />);

      expect(screen.getByTestId('header-home')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    });

    it('renders explore navigation when unauthenticated on a core explore route', () => {
      mockCurrentUserPubky = null;
      mockIsPublicRoute.mockReturnValue(false);
      mockIsCoreExploreRoute.mockReturnValue(true);
      mockUsePathname.mockReturnValue(HOME_ROUTES.HOME);

      render(<Header />);

      expect(screen.getByTestId('header-explore-navigation-buttons')).toBeInTheDocument();
      expect(screen.queryByTestId('header-home')).not.toBeInTheDocument();
      expect(screen.queryByTestId('header-sign-in')).not.toBeInTheDocument();
    });

    it('uses app-shell gutter alignment when unauthenticated on a core explore route', () => {
      mockCurrentUserPubky = null;
      mockIsPublicRoute.mockReturnValue(false);
      mockIsCoreExploreRoute.mockReturnValue(true);
      mockUsePathname.mockReturnValue(HOME_ROUTES.HOME);

      render(<Header />);

      expect(screen.getByTestId('header-container')).toHaveAttribute('data-class-name-nav', 'xl:px-0');
    });

    it('renders HeaderSignIn when authenticated regardless of public route', () => {
      mockCurrentUserPubky = 'test-pubky-123';
      mockIsPublicRoute.mockReturnValue(true);
      mockIsCoreExploreRoute.mockReturnValue(true);

      render(<Header />);

      expect(screen.getByTestId('header-sign-in')).toBeInTheDocument();
      expect(screen.queryByTestId('header-home')).not.toBeInTheDocument();
    });

    it('hides header on mobile when signed in on a post page', () => {
      mockCurrentUserPubky = 'test-pubky-123';
      mockIsPublicRoute.mockReturnValue(true);
      mockIsCoreExploreRoute.mockReturnValue(false);
      mockUsePathname.mockReturnValue('/post/o1gg96ewuojmopcjbz8895478wdtxtzzber7aezq6ror5a91j7dy/0034BBBDFK83G');

      render(<Header />);

      const headerContainer = screen.getByTestId('header-container');
      expect(headerContainer).toHaveAttribute('data-class-name', 'hidden lg:block');
      expect(screen.getByTestId('header-sign-in')).toBeInTheDocument();
      expect(screen.getByTestId('search-input')).toBeInTheDocument();
    });

    it('hides header on mobile when signed in on another user profile page', () => {
      mockCurrentUserPubky = 'test-pubky-123';
      mockIsPublicRoute.mockReturnValue(true);
      mockIsCoreExploreRoute.mockReturnValue(false);
      mockUsePathname.mockReturnValue('/profile/o1gg96ewuojmopcjbz8895478wdtxtzzber7aezq6ror5a91j7dy');

      render(<Header />);

      const headerContainer = screen.getByTestId('header-container');
      expect(headerContainer).toHaveAttribute('data-class-name', 'hidden lg:block');
      expect(screen.getByTestId('header-sign-in')).toBeInTheDocument();
      expect(screen.getByTestId('search-input')).toBeInTheDocument();
    });
  });

  describe('State Updates', () => {
    it('updates authentication state when isAuthenticated changes', () => {
      mockCurrentUserPubky = null;
      mockUsePathname.mockReturnValue(ROOT_ROUTES);

      const { rerender } = render(<Header />);

      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();

      // Change authentication state
      mockCurrentUserPubky = 'test-pubky-123';
      rerender(<Header />);

      expect(screen.getByTestId('search-input')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();
    });

    it('updates HeaderTitle visibility when authentication state changes on configured routes', () => {
      // Use logout route which has a title configured
      mockUsePathname.mockReturnValue(AUTH_ROUTES.LOGOUT);
      mockCurrentUserPubky = null;

      const { rerender } = render(<Header />);

      // Should show HeaderTitle when not authenticated on configured route
      expect(screen.getByTestId('header-title')).toBeInTheDocument();
      expect(screen.getByTestId('header-title')).toHaveTextContent('Signed out');

      // Change to authenticated
      mockCurrentUserPubky = 'test-pubky-123';
      rerender(<Header />);

      // Should hide HeaderTitle when authenticated (not on step 5)
      expect(screen.queryByTestId('header-title')).not.toBeInTheDocument();
    });
  });
});

it('offers sign-in when a legacy identity remains but no session was restored', () => {
  mockUsePathname.mockReturnValue('/marketplace');
  mockCurrentUserPubky = 'legacy-pubky';
  mockIsPublicRoute.mockReturnValue(false);
  mockIsCoreExploreRoute.mockReturnValue(false);
  setEmbedded(false);
  mockHasSession = false;
  try {
    render(<Header />);
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  } finally {
    mockHasSession = true;
  }
});

describe('account maintenance chrome', () => {
  beforeEach(() => {
    mockCurrentUserPubky = 'test-pubky-123';
    mockHasSession = true;
    mockIsPublicRoute.mockReturnValue(false);
    mockIsCoreExploreRoute.mockReturnValue(false);
  });
  it('shows a simple header on profile completion', () => {
    mockUsePathname.mockReturnValue(ACCOUNT_ROUTES.COMPLETE_PROFILE);
    render(<Header />);
    expect(screen.getByTestId('header-title')).toHaveTextContent('Complete profile');
    expect(screen.getByTestId('header-container')).not.toHaveAttribute('data-class-name', 'hidden lg:block');
    expect(screen.getByTestId('header-container')).toHaveAttribute(
      'data-class-name-nav',
      'max-w-screen-xl px-6 lg:px-10',
    );
    expect(screen.queryByTestId('header-sign-in')).not.toBeInTheDocument();
    expect(screen.queryByTestId('onboarding-header')).not.toBeInTheDocument();
  });
});
