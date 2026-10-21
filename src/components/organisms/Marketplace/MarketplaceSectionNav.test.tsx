import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatUnread } from '@/hooks/useChatUnread/useChatUnread';
import { setEmbedded } from '@/test-utils/embedded';
import { setSocialHost } from '@/test-utils/social-host';
import { MarketplaceSectionNav } from './MarketplaceSectionNav';

const state = vi.hoisted(() => ({
  pathname: '/marketplace/offers' as string | null,
  activityCount: 22,
  ordersCount: 0,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => state.pathname,
}));

vi.mock('@/hooks/useMarketplaceCartCount/useMarketplaceCartCount', () => ({
  useMarketplaceCartCount: () => 3,
}));

vi.mock('@/hooks/useMarketplaceActivityUnread/useMarketplaceActivityUnread', () => ({
  useMarketplaceActivityUnread: () => state.activityCount,
}));

vi.mock('@/hooks/useMarketplaceOrdersAttention/useMarketplaceOrdersAttention', () => ({
  useMarketplaceOrdersAttention: () => state.ordersCount,
}));

vi.mock('@/hooks/useChatUnread/useChatUnread', () => ({
  useChatUnread: vi.fn(({ enabled = true } = {}) => (enabled ? 4 : 0)),
}));

describe('MarketplaceSectionNav', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    setSocialHost(undefined);
    state.pathname = '/marketplace/offers';
    state.activityCount = 22;
    state.ordersCount = 0;
  });

  afterEach(() => {
    setSocialHost(undefined);
    vi.restoreAllMocks();
  });

  it('dismisses the overflow hint after scrolling and remembers the gesture across pages', () => {
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
    const { unmount } = render(<MarketplaceSectionNav />);
    expect(screen.getByTestId('marketplace-nav-swipe-hint')).toBeInTheDocument();

    const nav = screen.getByRole('navigation');
    fireEvent.pointerDown(nav);
    nav.scrollLeft = 20;
    fireEvent.scroll(nav);
    expect(screen.queryByTestId('marketplace-nav-swipe-hint')).not.toBeInTheDocument();

    unmount();
    render(<MarketplaceSectionNav />);
    expect(screen.queryByTestId('marketplace-nav-swipe-hint')).not.toBeInTheDocument();
  });

  it('keeps the hint when tabs scroll without a user gesture', () => {
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
    render(<MarketplaceSectionNav />);
    const nav = screen.getByRole('navigation');
    nav.scrollLeft = 80;
    fireEvent.scroll(nav);
    expect(screen.getByTestId('marketplace-nav-swipe-hint')).toBeInTheDocument();
  });

  it('does not show a swipe hint when every section fits', () => {
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(900);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900);
    render(<MarketplaceSectionNav />);
    expect(screen.queryByTestId('marketplace-nav-swipe-hint')).not.toBeInTheDocument();
  });

  it('highlights the active section and wires both badges', () => {
    render(<MarketplaceSectionNav />);

    expect(screen.getByRole('link', { name: 'Offers' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Market' })).not.toHaveAttribute('aria-current');
    expect(screen.getByTestId('marketplace-section-nav-cart-badge')).toHaveTextContent('3');
    expect(screen.getByTestId('marketplace-section-nav-activity-badge')).toHaveTextContent('21+');
  });

  it('keeps unread messages visible in the Shop section navigation', () => {
    setSocialHost('https://pubky.app');
    render(<MarketplaceSectionNav />);
    expect(screen.getByTestId('marketplace-section-nav-messages-badge')).toHaveTextContent('4');
    expect(screen.getByLabelText('4 unread messages')).toBeInTheDocument();
    expect(useChatUnread).toHaveBeenCalledWith({ enabled: true });
  });

  it('keeps unread messages visible in the embedded Shop, where there is no global navigation', () => {
    setEmbedded(true);
    try {
      render(<MarketplaceSectionNav />);
      expect(screen.getByLabelText('4 unread messages')).toBeInTheDocument();
      expect(useChatUnread).toHaveBeenCalledWith({ enabled: true });
    } finally {
      setEmbedded(false);
    }
  });

  it('leaves message counts to the global navigation while link-out is off', () => {
    render(<MarketplaceSectionNav />);

    expect(screen.queryByTestId('marketplace-section-nav-messages-badge')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Shop settings' })).not.toBeInTheDocument();
    expect(useChatUnread).toHaveBeenCalledWith({ enabled: false });
  });

  it('lets a link-out buyer open local Shop settings from the section navigation', () => {
    setSocialHost('https://pubky.app');
    state.pathname = '/marketplace';
    const onNavigate = vi.fn();
    render(<MarketplaceSectionNav onNavigate={onNavigate} />);

    const settings = screen.getByRole('link', { name: 'Shop settings' });
    expect(settings).toHaveAttribute('href', '/marketplace/settings');
    settings.click();
    expect(onNavigate).toHaveBeenCalledWith('/marketplace/settings');
  });

  it.each(['/marketplace/settings', '/marketplace/settings/addresses', '/marketplace/settings/shipping'])(
    'highlights only Shop settings at %s while link-out is on',
    (pathname) => {
      setSocialHost('https://pubky.app');
      state.pathname = pathname;
      render(<MarketplaceSectionNav />);

      expect(screen.getByRole('link', { name: 'Shop settings' })).toHaveAttribute('aria-current', 'page');
      expect(screen.getByRole('link', { name: 'My shop' })).not.toHaveAttribute('aria-current');
      expect(screen.getAllByRole('link').filter((link) => link.hasAttribute('aria-current'))).toHaveLength(1);
    },
  );

  it('keeps settings under My shop while link-out is off', () => {
    state.pathname = '/marketplace/settings';
    render(<MarketplaceSectionNav />);
    expect(screen.getByRole('link', { name: 'My shop' })).toHaveAttribute('aria-current', 'page');
  });

  it('badges orders that still need the signed-in identity', () => {
    state.ordersCount = 2;
    render(<MarketplaceSectionNav />);

    expect(screen.getByTestId('marketplace-section-nav-orders-badge')).toHaveTextContent('2');
    expect(screen.getByLabelText('2 orders needing you')).toBeInTheDocument();
  });

  it('highlights My shop subroutes without highlighting buyer sections', () => {
    state.pathname = '/marketplace/sell';
    render(<MarketplaceSectionNav />);

    expect(screen.getByRole('link', { name: 'My shop' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Offers' })).not.toHaveAttribute('aria-current');
  });

  it('does not highlight a section while the pathname is unavailable', () => {
    state.pathname = null;
    render(<MarketplaceSectionNav />);

    expect(screen.getAllByRole('link')).toHaveLength(8);
    expect(screen.getAllByRole('link').every((link) => !link.hasAttribute('aria-current'))).toBe(true);
  });

  it('keeps every section in a scrollable mobile row with desktop wrapping', () => {
    state.activityCount = 12;
    render(<MarketplaceSectionNav />);

    const nav = screen.getByTestId('marketplace-section-nav');
    expect(nav).toHaveClass('overflow-x-auto', 'sm:overflow-visible');
    expect(nav.firstElementChild).toHaveClass('flex-nowrap', 'min-w-max', 'sm:flex-wrap');
    expect(screen.getByRole('link', { name: /Activity/ })).toBeVisible();
    expect(screen.getByRole('link', { name: 'My shop' })).toBeVisible();
    expect(screen.getByTestId('marketplace-section-nav-activity-badge')).toHaveTextContent('12');
  });

  it('pins itself under the page chrome so the sections stay reachable while scrolling', () => {
    render(<MarketplaceSectionNav />);

    const root = document.querySelector('[data-surface="marketplace-section-nav"]');
    expect(root).toHaveClass('sticky', 'top-(--marketplace-subnav-top)', 'z-(--z-sticky-subnav)', 'bg-background');
  });

  it('lets a page keep its own spacing around the pinned bar', () => {
    render(<MarketplaceSectionNav className="mb-0 after:h-16" />);

    const root = document.querySelector('[data-surface="marketplace-section-nav"]');
    expect(root).toHaveClass('sticky', 'mb-0', 'after:h-16');
    expect(root).not.toHaveClass('mb-6', 'after:h-6');
  });

  it('delegates guarded home navigation without requiring an app router', () => {
    const onNavigate = vi.fn();
    render(<MarketplaceSectionNav onNavigate={onNavigate} />);

    screen.getByRole('link', { name: 'Orders' }).click();

    expect(onNavigate).toHaveBeenCalledWith('/marketplace/orders');
  });
});
