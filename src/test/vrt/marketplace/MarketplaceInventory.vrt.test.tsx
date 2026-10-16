// Intentional import order — browser-mode mock factories rely on stable aliases.
/* eslint-disable simple-import-sort/imports */
import { createMarketplaceVrtAuthStore } from '@/test/mocks/marketplace-vrt';
import { describe, expect, it, vi } from 'vitest';
import { renderForVRT, VRT_DENSE_CHROME_SCREENSHOT, VRT_ROOT_TESTID } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';
import { MarketplaceInventory } from '@/templates/Marketplace/MarketplaceInventory';
import type { InventoryBoardLoad, InventoryBoardRow } from '@/application/commerce/inventory';

const { SELLER, row } = vi.hoisted(() => {
  const seller = 'y'.repeat(52);
  const row = (overrides: Partial<InventoryBoardRow> = {}): InventoryBoardRow => ({
    listingId: 'boots',
    sellerPubky: seller,
    aggregateId: `listing:${seller}_boots`,
    title: 'Vintage work boots',
    thumbUrl: null,
    state: 'available',
    listingState: 'active',
    format: 'fixed_price',
    dropId: null,
    available: 4,
    reserved: 2,
    sold: 1,
    total: 7,
    serverRevision: 3,
    sync: 'synced',
    ...overrides,
  });
  return { SELLER: seller, row };
});

const view = vi.hoisted(() => ({
  isLoading: false,
  load: { status: 'empty', rows: [] } as InventoryBoardLoad,
  conflictListingId: null as string | null,
  pendingListingId: null as string | null,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/marketplace/dashboard/inventory',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: createMarketplaceVrtAuthStore({ currentUserPubky: SELLER }),
}));

vi.mock('@/hooks/useMarketplaceInventory/useMarketplaceInventory', () => ({
  useMarketplaceInventory: () => ({
    sellerPubky: SELLER,
    load: view.load,
    isLoading: view.isLoading,
    conflictListingId: view.conflictListingId,
    pendingListingId: view.pendingListingId,
    refresh: async () => undefined,
    setAvailable: async () => ({ status: 'updated', row: row() }),
    retrySync: async () => undefined,
    relist: async () => true,
  }),
}));

vi.mock('@/hooks/useMarketplaceInventoryGrantConnect/useMarketplaceInventoryGrantConnect', () => ({
  useMarketplaceInventoryGrantConnect: () => ({
    status: 'idle',
    authorizationUrl: '',
    errorMessage: null,
    isOpeningSigner: false,
    start: () => {},
    cancel: () => {},
    copyAuthUrl: async () => {},
    openInSigner: () => {},
  }),
}));

vi.mock('@/hooks/useMarketplaceInventoryImport/useMarketplaceInventoryImport', () => ({
  useMarketplaceInventoryImport: () => ({
    scene: 'upload',
    step: 1,
    fileName: undefined,
    message: undefined,
    counts: undefined,
    progress: undefined,
    busy: false,
    reset: () => {},
    planFile: async () => undefined,
    submitStoreUrl: async () => false,
    storeForm: { control: {} },
    publish: async () => undefined,
    resume: async () => undefined,
    confirmConflict: async () => undefined,
    discardConflict: async () => undefined,
    downloadResult: async () => undefined,
    exportListings: async () => undefined,
    exportOrders: async () => undefined,
  }),
}));

vi.mock('@/hooks/useMarketplaceCartCount/useMarketplaceCartCount', () => ({
  useMarketplaceCartCount: () => 0,
}));

vi.mock('@/hooks/useMarketplaceActivityUnread/useMarketplaceActivityUnread', () => ({
  useMarketplaceActivityUnread: () => 0,
}));

vi.mock('@/organisms/ContentLayout/ContentLayout', () => ({
  ContentLayout: ({ children }: { children: React.ReactNode }) => <main className="w-full py-6">{children}</main>,
}));

describe('MarketplaceInventory VRT', () => {
  it('renders the empty board at desktop viewport', async () => {
    view.isLoading = false;
    view.load = { status: 'empty', rows: [] };
    view.conflictListingId = null;
    const screen = await renderForVRT(<MarketplaceInventory />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'inventory-empty-desktop',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it('renders reserved stock as muted at desktop viewport', async () => {
    view.isLoading = false;
    view.load = { status: 'ready', rows: [row()] };
    view.conflictListingId = null;
    const screen = await renderForVRT(<MarketplaceInventory />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'inventory-populated-reserved-desktop',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it('renders reserved stock at mobile viewport', async () => {
    view.isLoading = false;
    view.load = { status: 'ready', rows: [row()] };
    view.conflictListingId = null;
    const screen = await renderForVRT(<MarketplaceInventory />, { viewport: VRT_VIEWPORT_MOBILE, disableHover: true });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'inventory-populated-reserved-mobile',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it('renders a paused listing with Relist at desktop viewport', async () => {
    view.isLoading = false;
    view.load = {
      status: 'ready',
      rows: [
        row(),
        row({
          listingId: 'lamp',
          aggregateId: `listing:${SELLER}_lamp`,
          title: 'Brass desk lamp',
          listingState: 'paused',
          reserved: 0,
          available: 3,
          sold: 0,
          total: 3,
        }),
      ],
    };
    view.conflictListingId = null;
    const screen = await renderForVRT(<MarketplaceInventory />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'inventory-paused-relist-desktop',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it('renders a per-size listing with one row per size at desktop viewport', async () => {
    view.isLoading = false;
    view.load = {
      status: 'ready',
      rows: [
        row({
          available: 3,
          reserved: 2,
          sold: 4,
          total: 9,
          variants: [
            {
              variantId: 'size_s',
              label: 'S',
              enabled: true,
              available: 0,
              reserved: 1,
              sold: 3,
              total: 4,
              soldOut: true,
            },
            {
              variantId: 'size_m',
              label: 'M',
              enabled: true,
              available: 3,
              reserved: 1,
              sold: 1,
              total: 5,
              soldOut: false,
            },
            {
              variantId: 'size_xl',
              label: 'XL',
              enabled: false,
              available: 0,
              reserved: 0,
              sold: 0,
              total: 0,
              soldOut: true,
            },
          ],
        }),
        row({
          listingId: 'lamp',
          aggregateId: `listing:${SELLER}_lamp`,
          title: 'Brass desk lamp',
          reserved: 0,
          available: 3,
          sold: 0,
          total: 3,
        }),
      ],
    };
    view.conflictListingId = null;
    const screen = await renderForVRT(<MarketplaceInventory />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'inventory-per-size-desktop',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it('renders the grant-needed banner at desktop viewport', async () => {
    view.isLoading = false;
    view.load = { status: 'grant-needed' };
    view.conflictListingId = null;
    const screen = await renderForVRT(<MarketplaceInventory />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'inventory-grant-needed-desktop',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it('renders durable-unavailable at desktop viewport', async () => {
    view.isLoading = false;
    view.load = { status: 'durable-unavailable' };
    view.conflictListingId = null;
    const screen = await renderForVRT(<MarketplaceInventory />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'inventory-durable-unavailable-desktop',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it('renders a 409 revision conflict on the row at desktop viewport', async () => {
    view.isLoading = false;
    view.load = { status: 'ready', rows: [row()] };
    view.conflictListingId = 'boots';
    const screen = await renderForVRT(<MarketplaceInventory />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'inventory-revision-conflict-desktop',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it('renders the empty board at mobile viewport', async () => {
    view.isLoading = false;
    view.load = { status: 'empty', rows: [] };
    view.conflictListingId = null;
    const screen = await renderForVRT(<MarketplaceInventory />, { viewport: VRT_VIEWPORT_MOBILE, disableHover: true });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'inventory-empty-mobile',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it('renders the grant-needed banner at mobile viewport', async () => {
    view.isLoading = false;
    view.load = { status: 'grant-needed' };
    view.conflictListingId = null;
    const screen = await renderForVRT(<MarketplaceInventory />, { viewport: VRT_VIEWPORT_MOBILE, disableHover: true });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'inventory-grant-needed-mobile',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it('renders durable-unavailable at mobile viewport', async () => {
    view.isLoading = false;
    view.load = { status: 'durable-unavailable' };
    view.conflictListingId = null;
    const screen = await renderForVRT(<MarketplaceInventory />, { viewport: VRT_VIEWPORT_MOBILE, disableHover: true });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'inventory-durable-unavailable-mobile',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it('renders a 409 revision conflict on the row at mobile viewport', async () => {
    view.isLoading = false;
    view.load = { status: 'ready', rows: [row()] };
    view.conflictListingId = 'boots';
    const screen = await renderForVRT(<MarketplaceInventory />, { viewport: VRT_VIEWPORT_MOBILE, disableHover: true });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'inventory-revision-conflict-mobile',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it('renders mixed per-id sync on the board at desktop viewport', async () => {
    view.isLoading = false;
    view.conflictListingId = null;
    view.load = {
      status: 'ready',
      rows: [
        row(),
        row({
          listingId: 'unsynced',
          aggregateId: `listing:${SELLER}_unsynced`,
          title: 'Unsynced listing',
          reserved: 0,
          available: 2,
          sold: 0,
          total: 2,
          serverRevision: 1,
          sync: 'missing',
          syncMessage: 'Published, not yet registered for checkout',
        }),
      ],
    };
    const screen = await renderForVRT(<MarketplaceInventory />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'inventory-mixed-sync-desktop',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it('renders mixed per-id sync on the board at mobile viewport', async () => {
    view.isLoading = false;
    view.conflictListingId = null;
    view.load = {
      status: 'ready',
      rows: [
        row(),
        row({
          listingId: 'unsynced',
          aggregateId: `listing:${SELLER}_unsynced`,
          title: 'Unsynced listing',
          reserved: 0,
          available: 2,
          sold: 0,
          total: 2,
          serverRevision: 1,
          sync: 'missing',
          syncMessage: 'Published, not yet registered for checkout',
        }),
      ],
    };
    const screen = await renderForVRT(<MarketplaceInventory />, { viewport: VRT_VIEWPORT_MOBILE, disableHover: true });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'inventory-mixed-sync-mobile',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });
});
