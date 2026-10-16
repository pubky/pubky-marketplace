// Intentional import order — browser-mode mock factories rely on stable aliases.
/* eslint-disable simple-import-sort/imports */
import { createMarketplaceVrtCommerceController } from '@/test/mocks/marketplace-vrt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderForVRT, VRT_ROOT_TESTID } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';
import { MarketplacePaymentSettings } from '@/templates/Marketplace/MarketplacePaymentSettings';
import { setSocialHost } from '@/test-utils/social-host';
import { toCamelCaseWire } from '@/libs/commerce/wire-casing';
import { sellerPaymentConfigOwnViewSchema } from '@/libs/commerce/payment-methods';
import {
  USDT_SELLER_CONFIG_FLAG_OFF_WIRE,
  USDT_SELLER_CONFIG_READY_WIRE,
  USDT_SELLER_CONFIG_RECONNECT_WIRE,
  USDT_SELLER_CONFIG_SETUP_WIRE,
  USDT_SELLER_CONFIG_UNAVAILABLE_WIRE,
} from '@/test/fixtures/commerce/seller-payment-config-usdt.wire';

const view = vi.hoisted(() => ({
  // USDT stays off (and the seller's own view carries no USDT keys) unless a scene opts in.
  usdt: { available: false, unreadable: false, ownView: null as Record<string, unknown> | null },
  // Stored-rail overrides for scenes that need Accept bitcoin off or Bitkit not yet connected.
  ownConfig: {} as Record<string, unknown>,
  accountClaimed: true,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/marketplace/settings',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    ...createMarketplaceVrtCommerceController(),
    getSellerPaymentConfig: async () => ({
      bitcoinAvailable: true,
      bitcoinOfferAvailable: true,
      paypalAvailable: true,
    }),
    getPaykitSetupUrl: () => 'about:blank',
    getPaykitReconnectUrl: () => 'about:blank#reconnect',
    fetchUsdtPaymentsAvailable: async () => {
      if (view.usdt.unreadable) throw new TypeError('health unreachable');
      return view.usdt.available;
    },
    getMyPaymentConfig: vi.fn(async () => ({
      bitcoinEnabled: true,
      bitcoinSetup: view.accountClaimed ? 'ready' : 'setup_required',
      paypalMerchantEmail: 'seller@example.com',
      updatedAt: '2026-08-22T12:00:00.000Z',
      ...view.usdt.ownView,
      ...view.ownConfig,
    })),
    putMyPaymentConfig: vi.fn(),
    beginMarketplaceSessionConnect: vi.fn(),
  },
}));

// The sign-out card's flow is covered by unit tests; the capture needs only its idle state.
vi.mock('@/hooks/useSignOut/useSignOut', () => ({
  useSignOut: () => ({ handleSignOut: vi.fn(), isLoading: false }),
}));

vi.mock('@/organisms/ContentLayout/ContentLayout', () => ({
  ContentLayout: ({ children }: { children: React.ReactNode }) => <main className="w-full py-6">{children}</main>,
}));

// Tall enough that the USDT card, the last method card, is inside the capture.
const USDT_VIEWPORT_DESKTOP = { width: 1440, height: 2300 };
const USDT_VIEWPORT_MOBILE = { width: 390, height: 3400 };

function setUsdt(wire: { payment_config: object } | null, { unreadable = false } = {}) {
  view.usdt = {
    available: wire !== null,
    unreadable,
    ownView: wire
      ? (({ usdtEnabled, usdtSetup, usdtSetupAction }) => ({ usdtEnabled, usdtSetup, usdtSetupAction }))(
          sellerPaymentConfigOwnViewSchema.parse(toCamelCaseWire(wire.payment_config)),
        )
      : null,
  };
}

describe('Marketplace payment settings — visual regression', () => {
  afterEach(() => {
    setUsdt(null);
    view.ownConfig = {};
    view.accountClaimed = true;
  });

  beforeEach(async () => {
    // The Get paid section requires a marketplace session; a fixture session
    // makes the full form render deterministically in every baseline.
    const { useCommerceStore } = await import('@/stores/commerce/commerce.store');
    const { useAuthStore } = await import('@/stores/auth/auth.store');
    useCommerceStore.setState({
      marketplaceSession: {
        pubky: 'gy1wnkhfwezwdnawnur1bc3kw1x3jf5ggjj3cm37e31i5ntq3pco',
        capabilities: '/pub/pubky.app/:rw',
        expiresAt: '2026-09-21T12:00:00.000Z',
        issuedAt: '2026-08-21T12:00:00.000Z',
      },
    });
    useAuthStore.setState({ currentUserPubky: 'gy1wnkhfwezwdnawnur1bc3kw1x3jf5ggjj3cm37e31i5ntq3pco' });
  });

  it('renders the payments setup at desktop viewport', async () => {
    const screen = await renderForVRT(<MarketplacePaymentSettings />, { viewport: VRT_VIEWPORT_DESKTOP });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('payment-settings-new-seller-desktop');
  });

  it('renders the payments setup at mobile viewport', async () => {
    const screen = await renderForVRT(<MarketplacePaymentSettings />, { viewport: VRT_VIEWPORT_MOBILE });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('payment-settings-new-seller-mobile');
  });

  // A taller viewport so the display-preferences card at the bottom of the
  // page (the approximate-conversion toggle and the measurement-system
  // select) is inside the capture.
  it('renders the display preferences controls at desktop viewport', async () => {
    const { useMarketplaceDisplayStore } = await import('@/stores/marketplace-display/marketplace-display.store');
    useMarketplaceDisplayStore.setState({ showFxEstimate: true, measurementSystem: 'imperial' });

    const screen = await renderForVRT(<MarketplacePaymentSettings />, { viewport: { width: 1440, height: 1600 } });
    await expect.element(screen.getByText('Display preferences')).toBeInTheDocument();
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('payment-settings-display-preferences-desktop');
    useMarketplaceDisplayStore.setState({ showFxEstimate: true, measurementSystem: null });
  });

  // Social link-out moves sign-out off /settings/account (the social host's page) onto Shop settings.
  it('renders the Shop sign-out card under social link-out at desktop viewport', async () => {
    setSocialHost('https://pubky.app');
    try {
      const screen = await renderForVRT(<MarketplacePaymentSettings />, { viewport: { width: 1440, height: 1800 } });
      await expect.element(screen.getByTestId('marketplace-sign-out-card')).toBeVisible();
      await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('payment-settings-social-linkout-desktop');
    } finally {
      setSocialHost(undefined);
    }
  });

  // Bitkit is not connected yet, so Accept bitcoin is off and says why.
  it('renders the Accept bitcoin missing-step reason at desktop viewport', async () => {
    view.ownConfig = { bitcoinEnabled: false };
    view.accountClaimed = false;

    const screen = await renderForVRT(<MarketplacePaymentSettings />, { viewport: { width: 1440, height: 1100 } });
    await expect.element(screen.getByTestId('bitcoin-toggle-blocker')).toHaveTextContent('Connect Bitkit first.');
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'payment-settings-bitcoin-missing-step-desktop',
    );
  });

  it('renders the inline PayPal email error at desktop viewport', async () => {
    view.ownConfig = { paypalMerchantEmail: null };

    const screen = await renderForVRT(<MarketplacePaymentSettings />, { viewport: VRT_VIEWPORT_DESKTOP });
    const email = screen.getByLabelText('PayPal merchant email');
    await userEvent.fill(email, 'test');
    (document.activeElement as HTMLElement | null)?.blur();
    await expect.element(screen.getByText('Enter a valid email address.')).toBeVisible();
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('payment-settings-paypal-invalid-desktop');
  });

  it('renders the Bitkit setup dialog', async () => {
    const screen = await renderForVRT(<MarketplacePaymentSettings />, { viewport: VRT_VIEWPORT_MOBILE });
    await screen.getByRole('button', { name: /Connect Bitkit/ }).click();
    await expect(screen.getByTitle('Connect Bitkit')).toBeVisible();
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('payment-settings-bitkit-dialog-mobile');
  });

  // USDT is flagged: these scenes turn the Shop flag and the service capability on.
  // Readiness comes from the service's signed Paykit lookup, per the pinned wire fixtures.
  it.each([
    ['ready', USDT_SELLER_CONFIG_READY_WIRE, 'payment-settings-usdt-ready-desktop'],
    ['reconnect', USDT_SELLER_CONFIG_RECONNECT_WIRE, 'payment-settings-usdt-reconnect-desktop'],
    ['setup', USDT_SELLER_CONFIG_SETUP_WIRE, 'payment-settings-usdt-setup-desktop'],
    ['unavailable', USDT_SELLER_CONFIG_UNAVAILABLE_WIRE, 'payment-settings-usdt-unavailable-desktop'],
  ] as const)('renders the USDT %s state at desktop viewport', async (_state, wire, baseline) => {
    setUsdt(wire);

    const screen = await renderForVRT(<MarketplacePaymentSettings />, { viewport: USDT_VIEWPORT_DESKTOP });
    await expect.element(screen.getByTestId('usdt-seller-setup')).toBeVisible();
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(baseline);
  });

  it('keeps the USDT card, as "can\'t be checked right now", when the service capability cannot be read', async () => {
    setUsdt(USDT_SELLER_CONFIG_FLAG_OFF_WIRE, { unreadable: true });

    const screen = await renderForVRT(<MarketplacePaymentSettings />, { viewport: USDT_VIEWPORT_DESKTOP });
    await expect.element(screen.getByTestId('usdt-readiness-unavailable')).toBeVisible();
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'payment-settings-usdt-health-unreadable-desktop',
    );
  });

  it('renders the USDT reconnect state at mobile viewport', async () => {
    setUsdt(USDT_SELLER_CONFIG_RECONNECT_WIRE);

    const screen = await renderForVRT(<MarketplacePaymentSettings />, { viewport: USDT_VIEWPORT_MOBILE });
    await expect.element(screen.getByTestId('usdt-seller-setup')).toBeVisible();
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('payment-settings-usdt-reconnect-mobile');
  });

  it('renders the USDT reconnect dialog at mobile viewport', async () => {
    setUsdt(USDT_SELLER_CONFIG_RECONNECT_WIRE);

    const screen = await renderForVRT(<MarketplacePaymentSettings />, { viewport: VRT_VIEWPORT_MOBILE });
    await screen.getByRole('button', { name: /Add USDT in Bitkit/ }).click();
    await expect(screen.getByTitle('Add USDT in Bitkit')).toBeVisible();
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'payment-settings-usdt-reconnect-dialog-mobile',
    );
  });
});
