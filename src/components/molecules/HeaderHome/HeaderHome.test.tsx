import { usePathname } from 'next/navigation';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_ROUTES, AUTH_ROUTES, ONBOARDING_ROUTES } from '@/app/routes';
import { setSocialHost } from '@/test-utils/social-host';
import { HeaderHome } from './HeaderHome';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: vi.fn(),
}));

vi.mock('@/molecules/Header/Header', () => ({
  HeaderSocialLinks: () => <div data-testid="header-social-links">Social Links</div>,
}));

describe('HeaderHome', () => {
  beforeEach(() => {
    vi.mocked(usePathname).mockReturnValue('/offline');
  });

  afterEach(() => setSocialHost(undefined));

  it('renders social links and sign in on other signed-out pages', () => {
    render(<HeaderHome />);

    expect(screen.getByTestId('header-social-links')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('keeps Explore and Sign in on logout without the retired Learn action', () => {
    vi.mocked(usePathname).mockReturnValue(AUTH_ROUTES.LOGOUT);

    render(<HeaderHome />);

    expect(screen.queryByTestId('header-social-links')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Explore' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Learn' })).not.toBeInTheDocument();
  });

  it.each([
    [undefined, APP_ROUTES.HOME],
    ['https://pubky.app', APP_ROUTES.MARKETPLACE],
  ])('preserves logout Explore destination with social host %s', (socialHost, destination) => {
    setSocialHost(socialHost);
    vi.mocked(usePathname).mockReturnValue(AUTH_ROUTES.LOGOUT);

    render(<HeaderHome />);
    fireEvent.click(screen.getByRole('button', { name: 'Explore' }));

    expect(mockPush).toHaveBeenCalledWith(destination);
  });

  it('opens sign in from the logout header', () => {
    vi.mocked(usePathname).mockReturnValue(AUTH_ROUTES.LOGOUT);

    render(<HeaderHome />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(mockPush).toHaveBeenCalledWith(AUTH_ROUTES.SIGN_IN);
  });

  it('keeps the onboarding action on the sign-in page', () => {
    vi.mocked(usePathname).mockReturnValue(AUTH_ROUTES.SIGN_IN);

    render(<HeaderHome />);
    fireEvent.click(screen.getByRole('button', { name: 'New here?' }));

    expect(mockPush).toHaveBeenCalledWith(ONBOARDING_ROUTES.HUMAN);
  });

  it('applies correct container classes', () => {
    const { container } = render(<HeaderHome />);

    expect(container.firstChild).toHaveClass('flex-1', 'flex-row', 'items-center', 'justify-end');
  });

  it('passes through additional props', () => {
    render(<HeaderHome data-testid="custom-header-home" className="custom-class" />);

    expect(screen.getByTestId('custom-header-home')).toHaveClass('custom-class');
  });
});
