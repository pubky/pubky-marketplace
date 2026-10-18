import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceSectionNav } from '@/organisms/Marketplace/MarketplaceSectionNav';
import { setSocialHost } from '@/test-utils/social-host';
import { expectVrtSurface, renderForVRT } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';

const state = vi.hoisted(() => ({ activityCount: 2, pathname: '/marketplace/offers' }));

vi.mock('next/navigation', () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/hooks/useMarketplaceCartCount/useMarketplaceCartCount', () => ({
  useMarketplaceCartCount: () => 3,
}));

vi.mock('@/hooks/useMarketplaceActivityUnread/useMarketplaceActivityUnread', () => ({
  useMarketplaceActivityUnread: () => state.activityCount,
}));

vi.mock('@/hooks/useRequireAuth/useRequireAuth', () => ({
  useRequireAuth: () => ({ isAuthenticated: true, requireAuth: vi.fn() }),
}));

describe('Marketplace section navigation — visual regression', () => {
  beforeEach(() => {
    state.activityCount = 2;
    state.pathname = '/marketplace/offers';
    setSocialHost(undefined);
  });

  afterEach(() => setSocialHost(undefined));

  it('renders the active offers section and badges on desktop', async () => {
    await renderForVRT(
      <div className="w-full max-w-5xl p-6">
        <MarketplaceSectionNav />
      </div>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await expect(await expectVrtSurface('marketplace-section-nav')).toMatchScreenshot('section-nav-offers-desktop');
  });

  it('keeps mobile sections in one horizontally scrollable row', async () => {
    await renderForVRT(
      <div className="w-full p-4">
        <MarketplaceSectionNav />
      </div>,
      { viewport: VRT_VIEWPORT_MOBILE },
    );
    await expect(await expectVrtSurface('marketplace-section-nav')).toMatchScreenshot('section-nav-offers-mobile');

    const nav = document.querySelector<HTMLElement>('[data-testid="marketplace-section-nav"]')!;
    const links = Array.from(nav.querySelectorAll('a'));
    expect(nav.scrollWidth).toBeGreaterThan(nav.clientWidth);
    expect(new Set(links.map((link) => link.offsetTop)).size).toBe(1);
    const active = nav.querySelector<HTMLElement>('[aria-current="page"]')!;
    expect(active.getBoundingClientRect().right).toBeLessThanOrEqual(nav.getBoundingClientRect().right + 1);
    expect(active.getBoundingClientRect().left).toBeGreaterThanOrEqual(nav.getBoundingClientRect().left);

    nav.scrollLeft = nav.scrollWidth;
    const last = links.at(-1)!;
    expect(nav.scrollLeft).toBeGreaterThan(0);
    expect(last.getBoundingClientRect().right).toBeLessThanOrEqual(nav.getBoundingClientRect().right + 1);
    expect(last.getBoundingClientRect().left).toBeGreaterThanOrEqual(nav.getBoundingClientRect().left);
  });

  it('keeps My shop reachable with a two-digit activity badge at 1024px', async () => {
    state.activityCount = 12;
    await renderForVRT(
      <div className="w-full p-6">
        <MarketplaceSectionNav />
      </div>,
      { viewport: { width: 1024, height: 768 } },
    );
    await expect(await expectVrtSurface('marketplace-section-nav')).toMatchScreenshot('section-nav-activity-12-1024');
  });

  it('rejects a missing production surface marker', () => {
    expect(() => expectVrtSurface('wrong-marketplace-section-nav')).toThrow(
      'no production [data-surface="wrong-marketplace-section-nav"] root is mounted',
    );
  });

  it.each([
    { name: 'desktop', viewport: VRT_VIEWPORT_DESKTOP },
    { name: 'mobile', viewport: VRT_VIEWPORT_MOBILE },
  ])('keeps Shop settings local and distinct from My shop on $name', async ({ name, viewport }) => {
    setSocialHost('https://pubky.app');
    state.pathname = '/marketplace/settings/addresses';
    const screen = await renderForVRT(
      <div className="w-full max-w-5xl p-4">
        <MarketplaceSectionNav />
      </div>,
      { viewport, disableHover: true },
    );

    await expect
      .element(screen.getByRole('link', { name: 'Shop settings' }))
      .toHaveAttribute('href', '/marketplace/settings');
    await expect.element(screen.getByRole('link', { name: 'Shop settings' })).toHaveAttribute('aria-current', 'page');
    await expect.element(screen.getByRole('link', { name: 'My shop' })).not.toHaveAttribute('aria-current');
    await expect(await expectVrtSurface('marketplace-section-nav')).toMatchScreenshot(
      `section-nav-shop-settings-${name}`,
    );
  });
});
