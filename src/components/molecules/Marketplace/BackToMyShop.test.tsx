import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMarketplaceListingEditRoute, MARKETPLACE_ROUTES } from '@/app/routes';
import { BackToMyShop } from './BackToMyShop';

const navigation = vi.hoisted(() => ({
  pathname: '/marketplace/settings/shipping',
  searchParams: new URLSearchParams(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => navigation.searchParams,
}));

describe('BackToMyShop', () => {
  beforeEach(() => {
    navigation.pathname = '/marketplace/settings/shipping';
    navigation.searchParams = new URLSearchParams();
  });

  it('returns to My shop when the page was not opened from a listing', () => {
    render(<BackToMyShop />);

    expect(screen.getByRole('link', { name: 'My shop' })).toHaveAttribute('href', MARKETPLACE_ROUTES.DASHBOARD);
  });

  it('returns to the listing draft the seller came from', () => {
    navigation.searchParams = new URLSearchParams({ returnTo: MARKETPLACE_ROUTES.SELL });

    render(<BackToMyShop />);

    expect(screen.getByRole('link', { name: 'Back to your listing' })).toHaveAttribute('href', MARKETPLACE_ROUTES.SELL);
    expect(screen.queryByRole('link', { name: 'My shop' })).not.toBeInTheDocument();
  });

  it('returns to the listing editor the seller came from', () => {
    const editPath = getMarketplaceListingEditRoute('y'.repeat(52), 'boots_01');
    navigation.searchParams = new URLSearchParams({ returnTo: editPath });

    render(<BackToMyShop />);

    expect(screen.getByRole('link', { name: 'Back to your listing' })).toHaveAttribute('href', editPath);
  });

  it('prefers a return target the page passes in, such as one remembered across a Paykit redirect', () => {
    render(<BackToMyShop returnTo={MARKETPLACE_ROUTES.SELL} />);

    expect(screen.getByRole('link', { name: 'Back to your listing' })).toHaveAttribute('href', MARKETPLACE_ROUTES.SELL);
  });

  it.each([
    'https://evil.example/marketplace/sell',
    '//evil.example/marketplace/sell',
    '/\\evil.example',
    'javascript:alert(1)',
    '/marketplace/sell?next=https://evil.example',
    '/marketplace/orders',
  ])('falls back to My shop for the unsafe return target %s', (returnTo) => {
    navigation.searchParams = new URLSearchParams({ returnTo });

    const { unmount } = render(<BackToMyShop />);
    expect(screen.getByRole('link', { name: 'My shop' })).toHaveAttribute('href', MARKETPLACE_ROUTES.DASHBOARD);
    unmount();

    render(<BackToMyShop returnTo={returnTo} />);
    expect(screen.getByRole('link', { name: 'My shop' })).toHaveAttribute('href', MARKETPLACE_ROUTES.DASHBOARD);
  });

  it('does not link a page back to itself', () => {
    navigation.pathname = MARKETPLACE_ROUTES.SELL;
    navigation.searchParams = new URLSearchParams({ returnTo: MARKETPLACE_ROUTES.SELL });

    render(<BackToMyShop />);

    expect(screen.getByRole('link', { name: 'My shop' })).toHaveAttribute('href', MARKETPLACE_ROUTES.DASHBOARD);
  });
});
