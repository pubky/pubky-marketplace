// Intentional import order — browser-mode mock factories rely on stable aliases.
/* eslint-disable simple-import-sort/imports */
import { describe, expect, it, vi } from 'vitest';
import { connectionFixture } from '@/test-utils/connector-fixtures';
import { userEvent } from 'vitest/browser';
import { expectVrtSurface, renderForVRT } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';
import { MarketplaceConnectWooCommerce } from '@/organisms/Marketplace/MarketplaceConnectWooCommerce';
import { useConnectWooCommerce } from '@/hooks/useConnectWooCommerce/useConnectWooCommerce';
import type { StatusCheckPhase } from '@/hooks/useConnectionStatusCheck/useConnectionStatusCheck';
import { connectionHealth } from '@/libs/commerce/connectors';

vi.mock('@/controllers/connectors/connectors', () => ({
  ConnectorsController: { commitConnectWooCommerce: vi.fn(), commitConnectWooCommerceWithKeys: vi.fn() },
}));

const connected = connectionFixture({
  id: 'c1',
  provider: 'woocommerce',
  domain: 'dezentralshop.ch',
  status: 'connected',
  scopes: ['read_write'],
});

function Flow({
  phase = 'idle',
  withResult = false,
  declined = false,
}: {
  phase?: StatusCheckPhase;
  withResult?: boolean;
  declined?: boolean;
}) {
  const woo = useConnectWooCommerce();
  return (
    <main className="w-full py-6">
      <MarketplaceConnectWooCommerce
        woo={woo}
        statusCheck={{
          phase,
          result: withResult
            ? {
                connection: connected,
                health: connectionHealth(connected),
                productCount: 279,
                catalogReadable: true,
                store: null,
              }
            : null,
          run: async () => phase,
          reset: () => {},
        }}
        onCheck={() => {}}
        returnNotice={declined ? { approved: false } : null}
      />
    </main>
  );
}

describe('Connect WooCommerce — visual regression', () => {
  it('renders the one-click connect form at desktop viewport', async () => {
    await renderForVRT(<Flow />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });
    await expect(await expectVrtSurface('store-connect-woocommerce')).toMatchScreenshot('connect-woocommerce-desktop');
  });

  it('renders the one-click connect form at mobile viewport', async () => {
    await renderForVRT(<Flow />, { viewport: VRT_VIEWPORT_MOBILE, disableHover: true });
    await expect(await expectVrtSurface('store-connect-woocommerce')).toMatchScreenshot('connect-woocommerce-mobile');
  });

  it('renders the REST key fallback at desktop viewport', async () => {
    const screen = await renderForVRT(<Flow />, { viewport: VRT_VIEWPORT_DESKTOP });
    await screen.getByRole('button', { name: /Paste REST keys instead/ }).click();
    await vi.waitFor(() => {
      if (!document.querySelector('[data-testid="woo-keys-form"]')) throw new Error('The key form has not opened yet.');
    });
    await userEvent.unhover(document.body);
    await expect(await expectVrtSurface('store-connect-woocommerce')).toMatchScreenshot(
      'connect-woocommerce-keys-desktop',
    );
  });

  it('renders the declined return at desktop viewport', async () => {
    await renderForVRT(<Flow declined />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });
    await expect(await expectVrtSurface('store-connect-woocommerce')).toMatchScreenshot(
      'connect-woocommerce-declined-desktop',
    );
  });

  it('renders the waiting status check at desktop viewport', async () => {
    await renderForVRT(<Flow phase="waiting" />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });
    await expect(await expectVrtSurface('store-connect-woocommerce')).toMatchScreenshot(
      'connect-woocommerce-waiting-desktop',
    );
  });

  it('renders the connected status check at desktop viewport', async () => {
    await renderForVRT(<Flow phase="connected" withResult />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });
    await expect(await expectVrtSurface('store-connect-woocommerce')).toMatchScreenshot(
      'connect-woocommerce-connected-desktop',
    );
  });
});
