// Intentional import order — browser-mode mock factories rely on stable aliases.
/* eslint-disable simple-import-sort/imports */
import { createMarketplaceVrtAuthStore } from '@/test/mocks/marketplace-vrt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderForVRT } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE, type VrtViewport } from '@/test-utils/vrt.viewports';
import { setEmbedded } from '@/test-utils/embedded';
import { EmbeddedDocumentFlag } from '@/molecules/EmbeddedDocumentFlag/EmbeddedDocumentFlag';
import { ContentLayout } from '@/organisms/ContentLayout/ContentLayout';
import { Header } from '@/organisms/Header/Header';
import { MarketplaceSectionNav } from '@/organisms/Marketplace/MarketplaceSectionNav';

// The section bar pins under the chrome while the page scrolls beneath it. Each scene mounts the
// real shell (Header, ContentLayout with its mobile header and footer) around the real section
// bar, scrolls a page-sized container, and measures where the bar settles against the real chrome:
// directly below the mobile header or the site header, and flush with the top of the frame when
// the Shop is embedded and the host owns the chrome.

const USER = vi.hoisted(() => 'y'.repeat(52));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/marketplace/orders',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: createMarketplaceVrtAuthStore({ currentUserPubky: USER }),
}));

vi.mock('@/hooks/useRequireAuth/useRequireAuth', () => ({
  useRequireAuth: () => ({ requireAuth: (action: () => void) => action() }),
}));

vi.mock('@/hooks/useMarketplaceCartCount/useMarketplaceCartCount', () => ({
  useMarketplaceCartCount: () => 2,
}));
vi.mock('@/hooks/useMarketplaceActivityUnread/useMarketplaceActivityUnread', () => ({
  useMarketplaceActivityUnread: () => 0,
}));
vi.mock('@/hooks/useMarketplaceOrdersAttention/useMarketplaceOrdersAttention', () => ({
  useMarketplaceOrdersAttention: () => 1,
}));
vi.mock('@/hooks/useMarketplaceNavAttention/useMarketplaceNavAttention', () => ({
  useMarketplaceNavAttention: () => 0,
}));
vi.mock('@/hooks/useChatUnread/useChatUnread', () => ({
  useChatUnread: () => 0,
}));
vi.mock('@/hooks/useCurrentUserProfile/useCurrentUserProfile', () => ({
  useCurrentUserProfile: () => ({
    userDetails: { name: 'Satoshi', image: null, indexed_at: 0 },
    currentUserPubky: USER,
  }),
}));
vi.mock('@/hooks/useCollectionsNavDiscovery/useCollectionsNavDiscovery', () => ({
  useCollectionsNavDiscovery: () => ({ showCollectionsNew: false, markCollectionsNavSeen: vi.fn() }),
}));
vi.mock('@/hooks/useAuthStatus/useAuthStatus', () => ({
  useAuthStatus: () => ({
    isFullyAuthenticated: true,
    isLoading: false,
    status: 'AUTHENTICATED',
    hasKeypair: true,
    hasProfile: true,
  }),
}));

const SCROLL_TESTID = 'sticky-scroll-page';

function ScrollingShopPage({ viewport }: { viewport: VrtViewport }) {
  return (
    <div data-testid={SCROLL_TESTID} style={{ width: viewport.width, height: viewport.height, overflowY: 'auto' }}>
      <EmbeddedDocumentFlag />
      <Header />
      <ContentLayout
        showLeftSidebar={false}
        showRightSidebar={false}
        showLeftMobileButton={false}
        showRightMobileButton={false}
        disableMainContentOverflow
      >
        <div className="flex w-full flex-col gap-6">
          <MarketplaceSectionNav />
          <div style={{ height: 3000 }} data-testid="sticky-page-body">
            A long page
          </div>
        </div>
      </ContentLayout>
    </div>
  );
}

async function scrollPageAndMeasure(viewport: VrtViewport) {
  const screen = await renderForVRT(<ScrollingShopPage viewport={viewport} />, { viewport });
  const scroller = screen.getByTestId(SCROLL_TESTID).element() as HTMLElement;
  const nav = scroller.querySelector<HTMLElement>('[data-surface="marketplace-section-nav"]')!;
  const restingTop = nav.getBoundingClientRect().top;

  scroller.scrollTop = 1200;
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

  const scrollerTop = scroller.getBoundingClientRect().top;
  const navRect = nav.getBoundingClientRect();
  return { scroller, scrollerTop, nav, restingTop, stuckTop: navRect.top - scrollerTop };
}

describe('Market section navigation — sticky', () => {
  beforeEach(() => {
    // The harness keeps the bar in flow for every other scene; these measure the real pinning.
    document.documentElement.setAttribute('data-vrt-sticky-nav', '');
  });

  afterEach(() => {
    setEmbedded(false);
    document.documentElement.removeAttribute('data-shop-embedded');
    document.documentElement.removeAttribute('data-vrt-sticky-nav');
  });

  it('pins below the site header on desktop', async () => {
    const { scroller, scrollerTop, nav, restingTop, stuckTop } = await scrollPageAndMeasure(VRT_VIEWPORT_DESKTOP);

    expect(scroller.scrollTop).toBeGreaterThan(0);
    expect(restingTop - scrollerTop).toBeGreaterThanOrEqual(144);
    expect(stuckTop).toBeCloseTo(144, 0);
    const header = scroller.querySelector('header')!;
    expect(nav.getBoundingClientRect().top).toBeGreaterThanOrEqual(header.getBoundingClientRect().bottom - 1);
    expect(nav).toBeVisible();
  });

  it('pins directly below the mobile header on mobile', async () => {
    const { scroller, scrollerTop, nav, stuckTop } = await scrollPageAndMeasure(VRT_VIEWPORT_MOBILE);

    expect(scroller.scrollTop).toBeGreaterThan(0);
    const mobileHeader = Array.from(scroller.querySelectorAll<HTMLElement>('div')).find((element) =>
      element.className.includes('z-(--z-mobile-menu)'),
    )!;
    expect(mobileHeader).toBeDefined();
    const mobileHeaderBottom = mobileHeader.getBoundingClientRect().bottom - scrollerTop;
    expect(mobileHeaderBottom).toBeCloseTo(96, 0);
    expect(stuckTop).toBeCloseTo(mobileHeaderBottom, 0);
    expect(nav).toBeVisible();
  });

  it.each([
    { name: 'desktop', viewport: VRT_VIEWPORT_DESKTOP },
    { name: 'mobile', viewport: VRT_VIEWPORT_MOBILE },
  ])('pins to the top of the frame when embedded on $name', async ({ viewport }) => {
    setEmbedded(true);
    const { scroller, nav, stuckTop } = await scrollPageAndMeasure(viewport);

    expect(document.documentElement).toHaveAttribute('data-shop-embedded');
    expect(scroller.querySelector('header')).toBeNull();
    expect(scroller.scrollTop).toBeGreaterThan(0);
    expect(stuckTop).toBeCloseTo(0, 0);
    expect(nav).toBeVisible();
  });
});
