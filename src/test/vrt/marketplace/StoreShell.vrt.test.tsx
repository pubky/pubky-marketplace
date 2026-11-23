// Intentional import order — browser-mode mock factories rely on stable aliases.
/* eslint-disable simple-import-sort/imports */
import { createMarketplaceVrtAuthStore, createMarketplaceVrtCommerceController } from '@/test/mocks/marketplace-vrt';
import { describe, expect, it, vi } from 'vitest';
import { expectVrtSurface, renderForVRT, VRT_ROOT_TESTID } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';
import { DeliveryKeyCustodyNotice } from '@/molecules/Marketplace/DeliveryKeyCustodyNotice';
import { MarketplaceContentLayout } from '@/organisms/Marketplace/MarketplaceContentLayout';
import { Header } from '@/organisms/Header/Header';
import { MarketplaceSectionNav } from '@/organisms/Marketplace/MarketplaceSectionNav';

// One seller's store (`PUBKY_RUNTIME_STORE_SELLER`) as a signed-in buyer sees it: the real root-layout
// Header and the real MarketplaceContentLayout around the section bar. The header carries the shop's
// own name instead of the Pubky Market wordmark and no search, the bars keep only what a store
// serves, and the page ends with the store footer.

const STORE_SELLER = vi.hoisted(() => 'ybndrfg8ejkmcpqxot1uwisza345h769ybndrfg8ejkmcpqxot1u');
const BUYER = vi.hoisted(() => 'y'.repeat(52));

vi.mock('@/config/store-mode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config/store-mode')>()),
  getStoreSeller: () => STORE_SELLER,
  isStoreMode: () => true,
}));

// A launched store sells through Paykit, so the header and the mobile footer carry Shop.
vi.mock('@/config/commerce', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config/commerce')>()),
  getCommerceAdapterMode: () => 'locks-paykit',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/marketplace/orders',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: createMarketplaceVrtAuthStore({ currentUserPubky: BUYER }),
}));

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    ...createMarketplaceVrtCommerceController(),
    getShop: async () => ({ record: { name: 'Satoshi Vintage' } }),
    refreshShop: async () => undefined,
  },
}));

vi.mock('dexie-react-hooks', async () => {
  const { useEffect, useState } = await import('react');
  return {
    useLiveQuery: (querier: () => unknown, deps: unknown[] = [], defaultValue?: unknown) => {
      const [value, setValue] = useState(defaultValue);
      useEffect(() => {
        let stale = false;
        Promise.resolve(querier()).then((result) => {
          if (!stale) setValue(result);
        });
        return () => {
          stale = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- mirror useLiveQuery's deps contract
      }, deps);
      return value;
    },
  };
});

vi.mock('@/hooks/useMarketplaceMediaUrl/useMarketplaceMediaUrl', async () => {
  const { createMarketplaceMediaHooks } = await import('@/test/mocks/marketplace-media-hooks');
  return createMarketplaceMediaHooks(() => null);
});

vi.mock('@/hooks/useRequireAuth/useRequireAuth', () => ({
  useRequireAuth: () => ({ requireAuth: (action: () => void) => action() }),
}));
vi.mock('@/hooks/useMarketplaceCartCount/useMarketplaceCartCount', () => ({
  useMarketplaceCartCount: () => 1,
}));
vi.mock('@/hooks/useMarketplaceActivityUnread/useMarketplaceActivityUnread', () => ({
  useMarketplaceActivityUnread: () => 0,
}));
vi.mock('@/hooks/useMarketplaceOrdersAttention/useMarketplaceOrdersAttention', () => ({
  useMarketplaceOrdersAttention: () => 0,
}));
vi.mock('@/hooks/useMarketplaceNavAttention/useMarketplaceNavAttention', () => ({
  useMarketplaceNavAttention: () => 0,
}));
vi.mock('@/hooks/useChatUnread/useChatUnread', () => ({
  useChatUnread: () => 0,
}));
vi.mock('@/hooks/useCurrentUserProfile/useCurrentUserProfile', () => ({
  useCurrentUserProfile: () => ({
    userDetails: { name: 'Bob Example', image: null, indexed_at: 0 },
    currentUserPubky: BUYER,
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
vi.mock('@/hooks/useHotTags/useHotTags', () => ({
  useHotTags: () => ({ tags: [], rawTags: [], isLoading: false, error: null, refetch: async () => {} }),
}));

function StoreOrdersPage() {
  return (
    <>
      <Header />
      <MarketplaceContentLayout>
        <MarketplaceSectionNav />
        <h1 className="text-2xl font-semibold">Orders</h1>
        <p className="text-muted-foreground">Your purchases from this shop appear here.</p>
      </MarketplaceContentLayout>
    </>
  );
}

async function waitForStoreChrome(container: HTMLElement) {
  await vi.waitFor(() => {
    if (!container.querySelector('[data-testid="store-logo"]')?.textContent?.includes('Satoshi Vintage')) {
      throw new Error('The store logo has not read the shop record yet.');
    }
  });
  expect(container.querySelector('[data-testid="store-footer"]'), 'the store footer').not.toBeNull();
}

describe('One seller’s store — visual regression', () => {
  it('shows the store header, bars and footer at desktop viewport', async () => {
    const screen = await renderForVRT(<StoreOrdersPage />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });

    await waitForStoreChrome(screen.container);
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('store-shell-desktop');
  });

  it('shows the store header, bars and footer at mobile viewport', async () => {
    const screen = await renderForVRT(<StoreOrdersPage />, { viewport: VRT_VIEWPORT_MOBILE, disableHover: true });

    await waitForStoreChrome(screen.container);
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('store-shell-mobile');
  });

  it('shows the studio notice that the delivery key is stored in this browser at desktop viewport', async () => {
    await renderForVRT(<DeliveryKeyCustodyNotice />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });

    await expect(await expectVrtSurface('delivery-key-custody-notice')).toMatchScreenshot(
      'store-delivery-key-notice-desktop',
    );
  });

  it('shows the studio notice that the delivery key is stored in this browser at mobile viewport', async () => {
    await renderForVRT(<DeliveryKeyCustodyNotice />, { viewport: VRT_VIEWPORT_MOBILE, disableHover: true });

    await expect(await expectVrtSurface('delivery-key-custody-notice')).toMatchScreenshot(
      'store-delivery-key-notice-mobile',
    );
  });
});
