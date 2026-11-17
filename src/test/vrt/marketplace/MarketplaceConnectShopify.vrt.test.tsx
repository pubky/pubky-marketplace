// Intentional import order — browser-mode mock factories rely on stable aliases.
/* eslint-disable simple-import-sort/imports */
import { describe, expect, it, vi } from 'vitest';
import { connectionFixture } from '@/test-utils/connector-fixtures';
import { expectVrtSurface, renderForVRT } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';
import { MarketplaceConnectShopify } from '@/organisms/Marketplace/MarketplaceConnectShopify';
import { useConnectShopify } from '@/hooks/useConnectShopify/useConnectShopify';
import type { StatusCheckPhase } from '@/hooks/useConnectionStatusCheck/useConnectionStatusCheck';
import { connectionHealth, SHOPIFY_REQUIRED_SCOPES } from '@/libs/commerce/connectors';

const ID = '3f2b8a52-6c1e-4d0a-9a53-7d5d2f0b61aa';
vi.mock('@/controllers/connectors/connectors', () => ({
  ConnectorsController: {
    commitCreateShopifyDraft: vi.fn(),
    commitShopifyCredentials: vi.fn(),
    draftUrls: () => ({
      appUrl: `https://marketplace-service.example.test/v1/connectors/shopify/c/3f2b8a52-6c1e-4d0a-9a53-7d5d2f0b61aa/launch`,
      allowedRedirectionUrl: `https://marketplace-service.example.test/v1/connectors/shopify/c/3f2b8a52-6c1e-4d0a-9a53-7d5d2f0b61aa/oauth/callback`,
      webhookUrl: null,
    }),
  },
}));

const draft = connectionFixture({
  id: ID,
  provider: 'shopify',
  domain: 'example-store.myshopify.com',
  status: 'draft',
  credentialsSaved: false,
});

const connected = connectionFixture({
  id: ID,
  provider: 'shopify',
  domain: 'example-store.myshopify.com',
  status: 'connected',
  scopes: [...SHOPIFY_REQUIRED_SCOPES],
});

const store = { shopName: 'Example Store', grantedScopes: [...SHOPIFY_REQUIRED_SCOPES], locationCount: 1 };

function Guide({
  resume,
  phase = 'idle',
  withResult = false,
}: {
  resume: typeof draft | null;
  phase?: StatusCheckPhase;
  withResult?: boolean;
}) {
  const shopify = useConnectShopify({ resume });
  return (
    <main className="w-full py-6">
      <MarketplaceConnectShopify
        shopify={shopify}
        statusCheck={{
          phase,
          result: withResult
            ? {
                connection: connected,
                health: connectionHealth(connected),
                productCount: 18,
                catalogReadable: true,
                store,
              }
            : null,
          run: async () => phase,
          reset: () => {},
        }}
        onCheck={() => {}}
      />
    </main>
  );
}

describe('Connect Shopify guide — visual regression', () => {
  it('renders the first step with the later steps locked at desktop viewport', async () => {
    await renderForVRT(<Guide resume={null} />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });
    await expect(await expectVrtSurface('store-connect-shopify')).toMatchScreenshot('connect-shopify-start-desktop');
  });

  it('renders the links and scopes to copy at desktop viewport', async () => {
    await renderForVRT(<Guide resume={draft} />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });
    await expect(await expectVrtSurface('store-connect-shopify')).toMatchScreenshot('connect-shopify-links-desktop');
  });

  it('renders the links and scopes to copy at mobile viewport', async () => {
    await renderForVRT(<Guide resume={draft} />, { viewport: VRT_VIEWPORT_MOBILE, disableHover: true });
    await expect(await expectVrtSurface('store-connect-shopify')).toMatchScreenshot('connect-shopify-links-mobile');
  });

  it('renders the saved keys and the install step at desktop viewport', async () => {
    const saved = connectionFixture({ ...draft, credentialsSaved: true });
    await renderForVRT(<Guide resume={saved} />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });
    await expect(await expectVrtSurface('store-connect-shopify')).toMatchScreenshot('connect-shopify-install-desktop');
  });

  it('renders the connected status check at desktop viewport', async () => {
    const saved = connectionFixture({ ...draft, credentialsSaved: true });
    await renderForVRT(<Guide resume={saved} phase="connected" withResult />, {
      viewport: VRT_VIEWPORT_DESKTOP,
      disableHover: true,
    });
    await expect(await expectVrtSurface('store-connect-shopify')).toMatchScreenshot('connect-shopify-done-desktop');
  });

  it('renders the connection that needs attention at desktop viewport', async () => {
    const saved = connectionFixture({ ...draft, credentialsSaved: true });
    const partial = connectionFixture({
      ...connected,
      status: 'needs_attention',
      scopes: ['read_products', 'read_inventory'],
      missingScopes: ['read_locations', 'read_fulfillments', 'write_orders'],
    });
    function Attention() {
      const shopify = useConnectShopify({ resume: saved });
      return (
        <main className="w-full py-6">
          <MarketplaceConnectShopify
            shopify={shopify}
            statusCheck={{
              phase: 'attention',
              result: {
                connection: partial,
                health: connectionHealth(partial),
                productCount: null,
                catalogReadable: true,
                store: null,
              },
              run: async () => 'attention',
              reset: () => {},
            }}
            onCheck={() => {}}
          />
        </main>
      );
    }
    await renderForVRT(<Attention />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });
    await expect(await expectVrtSurface('store-connect-shopify')).toMatchScreenshot(
      'connect-shopify-attention-desktop',
    );
  });
});
