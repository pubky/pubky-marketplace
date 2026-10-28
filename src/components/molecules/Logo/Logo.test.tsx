import { usePathname } from 'next/navigation';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOGO_LANDING_ROUTES } from '@/app/routes';
import { FORCE_FEED_SCROLL_TOP_KEY } from '@/config/feed';
import { setSocialHost } from '@/test-utils/social-host';
import { Logo } from './Logo';

// Mock Next.js Image component
vi.mock('next/image', () => ({
  default: ({
    src,
    alt,
    width,
    height,
    className,
  }: {
    src: string;
    alt: string;
    width: number;
    height: number;
    className?: string;
  }) => <img src={src} alt={alt} width={width} height={height} className={className} data-testid="logo-image" />,
}));

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(),
}));

const createSessionStorageMock = () => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  key: vi.fn(),
  length: 0,
});

describe('Logo', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      value: createSessionStorageMock(),
    });
  });

  it('renders with default src', () => {
    vi.mocked(usePathname).mockReturnValue('/home');

    render(<Logo />);

    const container = screen.getByTestId('logo-image').parentElement;
    const image = screen.getByTestId('logo-image');

    expect(container).toBeInTheDocument();
    expect(image).toBeInTheDocument();
    expect(image).toHaveAttribute('src', '/pubky-logo.svg');
  });

  it('uses the fixed default size classes and no inline size at the default dimensions', () => {
    vi.mocked(usePathname).mockReturnValue('/home');

    render(<Logo className="custom-logo-style" />);

    const image = screen.getByTestId('logo-image');
    const link = image.closest('a')!;
    expect(link).toHaveClass('min-h-[36px]', 'min-w-[109px]', 'custom-logo-style');
    expect(link.style.minWidth).toBe('');
    expect(image).toHaveClass('h-[36px]', 'w-[109px]');
    expect(image).toHaveAttribute('width', '109');
    expect(image).toHaveAttribute('height', '36');
  });

  it('sizes a custom-dimension logo inline instead of with the default classes', () => {
    vi.mocked(usePathname).mockReturnValue('/home');

    render(<Logo width={200} height={80} />);

    const image = screen.getByTestId('logo-image');
    const link = image.closest('a')!;
    expect(link).not.toHaveClass('min-h-[36px]', 'min-w-[109px]');
    expect(link).toHaveStyle({ minWidth: '200px', minHeight: '80px' });
    expect(image).not.toHaveClass('h-[36px]', 'w-[109px]');
    expect(image).toHaveAttribute('width', '200');
    expect(image).toHaveAttribute('height', '80');
  });

  it('scrolls to top when clicking logo on /home', () => {
    vi.mocked(usePathname).mockReturnValue('/home');

    Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true });

    render(<Logo />);
    const link = screen.getByTestId('logo-image').closest('a');
    expect(link).toBeTruthy();

    fireEvent.click(link!);
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('does not scroll to top when clicking logo on other pages', () => {
    vi.mocked(usePathname).mockReturnValue('/hot');

    Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true });
    const setItemSpy = vi.spyOn(window.sessionStorage, 'setItem');

    render(<Logo />);
    const link = screen.getByTestId('logo-image').closest('a');
    expect(link).toBeTruthy();

    fireEvent.click(link!);
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(setItemSpy).toHaveBeenCalledWith(FORCE_FEED_SCROLL_TOP_KEY, '1');
  });

  it.each(LOGO_LANDING_ROUTES)('links to the landing page on %s', (pathname) => {
    vi.mocked(usePathname).mockReturnValue(pathname);

    render(<Logo />);

    expect(screen.getByTestId('logo-image').closest('a')).toHaveAttribute('href', '/');
  });

  it.each(LOGO_LANDING_ROUTES)('does not set home scroll intent when clicking logo on %s', (pathname) => {
    vi.mocked(usePathname).mockReturnValue(pathname);

    Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true });
    const setItemSpy = vi.spyOn(window.sessionStorage, 'setItem');

    render(<Logo />);
    fireEvent.click(screen.getByTestId('logo-image').closest('a')!);

    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
  });
});

describe('Logo - social link-out', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      value: createSessionStorageMock(),
    });
  });

  afterEach(() => {
    setSocialHost(undefined);
  });

  it('links to /home while off', () => {
    vi.mocked(usePathname).mockReturnValue('/marketplace/orders');
    render(<Logo />);
    expect(screen.getByTestId('logo-image').closest('a')).toHaveAttribute('href', '/home');
  });

  it('links to the marketplace while on', () => {
    setSocialHost('https://pubky.app');
    vi.mocked(usePathname).mockReturnValue('/marketplace/orders');
    render(<Logo />);
    expect(screen.getByTestId('logo-image').closest('a')).toHaveAttribute('href', '/marketplace');
  });

  it('scrolls to top instead of navigating when already on the marketplace while on', () => {
    setSocialHost('https://pubky.app');
    vi.mocked(usePathname).mockReturnValue('/marketplace');
    Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true });

    render(<Logo />);
    fireEvent.click(screen.getByTestId('logo-image').closest('a')!);

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('keeps landing routes on the landing page while on', () => {
    setSocialHost('https://pubky.app');
    vi.mocked(usePathname).mockReturnValue('/sign-in');
    render(<Logo />);
    expect(screen.getByTestId('logo-image').closest('a')).toHaveAttribute('href', '/');
  });
});
