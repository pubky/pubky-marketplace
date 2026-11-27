// Intentional import order — browser-mode mock factories rely on stable aliases.
/* eslint-disable simple-import-sort/imports */
import { createMarketplaceVrtAuthStore } from '@/test/mocks/marketplace-vrt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setSocialHost } from '@/test-utils/social-host';
import { renderForVRT } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';
import { Dialog, DialogContent } from '@/atoms/Dialog/Dialog';
import { Toast, ToastProvider, ToastTitle, ToastViewport } from '@/atoms/Toast/Toast';
import { Header } from '@/organisms/Header/Header';
import { HeaderContainer } from '@/molecules/Header/Header';
import { HeaderSignIn } from '@/molecules/HeaderSignIn/HeaderSignIn';
import { Marketplace } from '@/templates/Marketplace/Marketplace';

const VRT_USER_PUBKY = vi.hoisted(() => 'y'.repeat(52));

const fixtures = vi.hoisted(async () => {
  const { createCommerceSandboxCatalog } = await import('@/libs/commerce/sandbox-catalog');
  const { buildMarketplaceCatalogItems } = await import('@/hooks/useMarketplaceCatalog/useMarketplaceCatalog.utils');
  const { toCommerceListingModel } = await import('@/test/fixtures/commerce/listing-models');

  const catalog = createCommerceSandboxCatalog();
  return {
    listings: buildMarketplaceCatalogItems(catalog.listings.map(toCommerceListingModel), []),
    shopsBySeller: new Map(catalog.shops.map((shop) => [shop.ownerPubky, shop])),
  };
});

vi.mock('@/hooks/useIndicativeBtcRate/useIndicativeBtcRate', () => ({
  useIndicativeBtcRate: () => null,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/marketplace',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/hooks/useRequireAuth/useRequireAuth', () => ({
  useRequireAuth: () => ({ requireAuth: (action: () => void) => action() }),
}));

vi.mock('@/libs/runtime-config/runtime-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/runtime-config/runtime-config')>();
  return { ...actual, getDeployEnv: () => 'staging' };
});

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: createMarketplaceVrtAuthStore({ currentUserPubky: VRT_USER_PUBKY }),
}));

vi.mock('@/hooks/useMarketplaceCatalog/useMarketplaceCatalog', async () => {
  const catalog = await fixtures;
  return {
    useMarketplaceCatalog: () => ({
      listings: catalog.listings,
      facetPool: catalog.listings,
      shopsBySeller: catalog.shopsBySeller,
      isLoading: false,
      adapterMode: 'sandbox',
      paymentFilter: { method: null, status: 'off', sellers: null },
    }),
  };
});

vi.mock('@/hooks/useCommerceFavorite/useCommerceFavorite', () => ({
  useCommerceFavorite: () => ({ isFavorite: false, isLoading: false, isMutating: false, toggle: vi.fn() }),
}));

vi.mock('@/hooks/useMarketplaceWatchDetection/useMarketplaceWatchDetection', () => ({
  useMarketplaceWatchDetection: () => {},
}));

vi.mock('@/hooks/useMarketplaceCartCount/useMarketplaceCartCount', () => ({
  useMarketplaceCartCount: () => 0,
}));
vi.mock('@/hooks/useMarketplaceActivityUnread/useMarketplaceActivityUnread', () => ({
  useMarketplaceActivityUnread: () => 0,
}));
vi.mock('@/hooks/useMarketplaceNavAttention/useMarketplaceNavAttention', () => ({
  useMarketplaceNavAttention: () => 0,
}));
vi.mock('@/hooks/useChatUnread/useChatUnread', () => ({
  useChatUnread: () => 0,
}));

vi.mock('@/hooks/useMarketplaceSavedSearches/useMarketplaceSavedSearches', () => ({
  useMarketplaceSavedSearches: () => ({
    searches: [],
    isSignedIn: true,
    saveCurrentSearch: vi.fn(async () => true),
    applySearch: vi.fn(async () => {}),
    deleteSearch: vi.fn(async () => {}),
  }),
}));

vi.mock('@/hooks/useMarketplaceMediaUrl/useMarketplaceMediaUrl', async () => {
  const { createMarketplaceMediaHooks } = await import('@/test/mocks/marketplace-media-hooks');
  return createMarketplaceMediaHooks(() => null);
});

vi.mock('@/hooks/useCurrentUserProfile/useCurrentUserProfile', () => ({
  useCurrentUserProfile: () => ({
    userDetails: { name: 'Satoshi', image: null, indexed_at: 0 },
    currentUserPubky: VRT_USER_PUBKY,
  }),
}));

vi.mock('@/organisms/Marketplace/MarketplaceContentLayout', () => ({
  MarketplaceContentLayout: ({ children }: { children: React.ReactNode }) => (
    <main className="w-full py-6">{children}</main>
  ),
}));

// `Header` hides itself below `lg` for signed-in users, so the mobile scene
// mounts the same container and signed-in content directly.
function MarketplaceWithHeader({ mobile }: { mobile: boolean }) {
  return (
    <>
      {mobile ? (
        <HeaderContainer>
          <HeaderSignIn />
        </HeaderContainer>
      ) : (
        <Header />
      )}
      <Marketplace />
    </>
  );
}

function requireElement(selector: string, root: ParentNode = document): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Expected ${selector} to be mounted`);
  return element;
}

function centerOf(rect: DOMRect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function topElementAt(rect: DOMRect): Element | null {
  const { x, y } = centerOf(rect);
  return document.elementFromPoint(x, y);
}

function tabsWrapper(): HTMLElement {
  const wrapper = requireElement('[data-testid="marketplace-section-nav"]').closest<HTMLElement>('.sticky');
  if (!wrapper) throw new Error('Section tabs have no sticky wrapper');
  return wrapper;
}

function zIndexOf(element: Element): number {
  return Number(getComputedStyle(element).zIndex);
}

describe.each([
  { name: 'desktop', mobile: false },
  { name: 'mobile', mobile: true },
])('Marketplace header at $name viewport', ({ mobile }) => {
  beforeEach(() => setSocialHost('https://staging.pubky.app'));
  afterEach(() => setSocialHost(undefined));

  it('opens search in the App and keeps the section tabs above listings and below the header', async () => {
    await renderForVRT(<MarketplaceWithHeader mobile={mobile} />, {
      viewport: mobile ? VRT_VIEWPORT_MOBILE : VRT_VIEWPORT_DESKTOP,
    });
    const search = requireElement('a[data-cy="header-search"]');
    expect(search.getAttribute('href')).toBe('https://staging.pubky.app/search');
    expect(search.getAttribute('target')).toBe('_top');
    const header = requireElement('header');
    const tabs = tabsWrapper();
    expect(zIndexOf(tabs)).toBeLessThan(zIndexOf(header));
    expect(zIndexOf(tabs)).toBeGreaterThan(10);
  });
});

describe('Marketplace section tabs under the site overlays', () => {
  it('sits below an open dialog', async () => {
    await renderForVRT(
      <>
        <Marketplace />
        <Dialog open>
          <DialogContent hiddenTitle="Overlay probe" centered>
            <p>Dialog body</p>
          </DialogContent>
        </Dialog>
      </>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await vi.waitFor(() => requireElement('[data-slot="dialog-overlay"]'));
    const tabLink = requireElement('a', requireElement('[data-testid="marketplace-section-nav"]'));
    const hit = topElementAt(tabLink.getBoundingClientRect());
    expect(hit?.getAttribute('data-slot')).toBe('dialog-overlay');
  });

  it('sits below the toast viewport', async () => {
    await renderForVRT(
      <>
        <Marketplace />
        <ToastProvider>
          <Toast open>
            <ToastTitle>Overlay probe</ToastTitle>
          </Toast>
          <ToastViewport data-testid="toast-viewport-probe" />
        </ToastProvider>
      </>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await vi.waitFor(() => requireElement('[data-testid="toast-viewport-probe"]'));
    expect(zIndexOf(requireElement('[data-testid="toast-viewport-probe"]'))).toBeGreaterThan(zIndexOf(tabsWrapper()));
  });
});
