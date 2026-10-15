// Intentional import order — browser-mode mock factories rely on stable aliases.
/* eslint-disable simple-import-sort/imports */
import { describe, expect, it, vi } from 'vitest';
import { connectionFixture } from '@/test-utils/connector-fixtures';
import { expectVrtSurface, renderForVRT } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';
import { MarketplaceStoreConnections } from '@/templates/Marketplace/MarketplaceStoreConnections';
import { connectionHealth } from '@/libs/commerce/connectors';

const view = vi.hoisted(() => ({ rows: [] as unknown[] }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/marketplace/settings/store-connections',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/hooks/useStoreConnections/useStoreConnections', () => ({
  useStoreConnections: () => ({
    enabled: true,
    rows: view.rows,
    connections: (view.rows as Array<{ connection: unknown }>).map((row) => row.connection),
    isLoading: false,
    error: null,
    needsSession: false,
    unavailable: false,
    workingId: null,
    refresh: async () => {},
    disconnect: async () => true,
  }),
}));

vi.mock('@/organisms/ContentLayout/ContentLayout', () => ({
  ContentLayout: ({ children }: { children: React.ReactNode }) => <main className="w-full py-6">{children}</main>,
}));

vi.mock('@/organisms/Marketplace/MarketplaceSectionNav', () => ({ MarketplaceSectionNav: () => null }));

function row(overrides: Record<string, unknown>, options: { disconnectedLocally?: boolean } = {}) {
  const connection = connectionFixture({
    status: 'connected',
    scopes: ['read_write'],
    connectedAt: '2026-10-15T10:00:00.000Z',
    ...overrides,
  });
  return { connection, health: connectionHealth(connection, options) };
}

const MIXED = [
  row({
    id: 'c1',
    provider: 'woocommerce',
    domain: 'dezentralshop.ch',
    mappingCount: 7,
    pushes: { pending: 0, sending: 0, created: 12, quarantined: 0 },
  }),
  row({
    id: 'c2',
    provider: 'shopify',
    domain: 'john-staging.myshopify.com',
    scopes: ['read_products', 'read_inventory', 'read_locations'],
    mappingCount: 3,
    pushes: { pending: 0, sending: 0, created: 4, quarantined: 2 },
  }),
  row(
    { id: 'c3', provider: 'woocommerce', domain: 'old-shop.example.com', mappingCount: 0 },
    { disconnectedLocally: true },
  ),
];

describe('Settings store connections — visual regression', () => {
  it('renders connected, needs attention and disconnected stores at desktop viewport', async () => {
    view.rows = MIXED;
    await renderForVRT(<MarketplaceStoreConnections />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });
    await expect(await expectVrtSurface('store-connections')).toMatchScreenshot('store-connections-list-desktop');
  });

  it('renders connected, needs attention and disconnected stores at mobile viewport', async () => {
    view.rows = MIXED;
    await renderForVRT(<MarketplaceStoreConnections />, { viewport: VRT_VIEWPORT_MOBILE, disableHover: true });
    await expect(await expectVrtSurface('store-connections')).toMatchScreenshot('store-connections-list-mobile');
  });

  it('renders the first-time page with the WooCommerce connect flow at desktop viewport', async () => {
    view.rows = [];
    await renderForVRT(<MarketplaceStoreConnections />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });
    await expect(await expectVrtSurface('store-connect-woocommerce')).toMatchScreenshot(
      'store-connections-empty-woocommerce-desktop',
    );
  });
});
