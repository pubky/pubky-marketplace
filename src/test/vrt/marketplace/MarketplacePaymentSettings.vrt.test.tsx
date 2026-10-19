// Intentional import order — browser-mode mock factories rely on stable aliases.
/* eslint-disable simple-import-sort/imports */
import { createMarketplaceVrtCommerceController } from '@/test/mocks/marketplace-vrt';
import { getPaykitSetupPageUrl, waitForPaykitSetupPage } from '@/test/mocks/paykit-server';
import {
  VRT_PAYKIT_RECONNECT_AUTHORIZATION_URL,
  VRT_PAYKIT_SETUP_AUTHORIZATION_URL,
} from '@/test/fixtures/commerce/paykit-setup';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, userEvent } from 'vitest/browser';
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
  paykitServerApi: 'fork' as 'fork' | 'upstream',
  touch: false,
}));

// A phone's touch screen, for the page and the Paykit frame: `(hover: none) and (pointer: coarse)`.
async function setTouch(enabled: boolean) {
  if (view.touch === enabled) return;
  await commands.emulateVrtTouch(enabled);
  view.touch = enabled;
}

vi.mock('@/config/commerce', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/commerce')>();
  return { ...actual, getPaykitServerApi: () => view.paykitServerApi };
});

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
    getPaykitSetupUrl: () => getPaykitSetupPageUrl(VRT_PAYKIT_SETUP_AUTHORIZATION_URL),
    getPaykitReconnectUrl: () => getPaykitSetupPageUrl(VRT_PAYKIT_RECONNECT_AUTHORIZATION_URL),
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
  afterEach(async () => {
    await setTouch(false);
    setUsdt(null);
    view.ownConfig = {};
    view.accountClaimed = true;
    view.paykitServerApi = 'fork';
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

  // The service could not ask Paykit: no Not set up, no Connect Bitkit, only Check again.
  it.each([
    ['desktop', { width: 1440, height: 1100 }, 'payment-settings-bitkit-unavailable-desktop'],
    ['mobile', { width: 390, height: 1300 }, 'payment-settings-bitkit-unavailable-mobile'],
  ] as const)('renders the Bitkit unavailable state at %s viewport', async (_size, viewport, baseline) => {
    view.ownConfig = { bitcoinEnabled: false, bitcoinSetup: 'unavailable' };

    const screen = await renderForVRT(<MarketplacePaymentSettings />, { viewport });
    await expect
      .element(screen.getByTestId('bitkit-setup-unknown'))
      .toHaveTextContent("We can't check Bitkit right now.");
    await expect.element(screen.getByTestId('payment-method-status-bitcoin')).toHaveTextContent('Needs attention');
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(baseline);
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

  // Upstream Paykit frames only its QR panel, or on a phone its Continue with Bitkit button.
  // A not-yet-connected seller gets the initial setup.
  it.each([
    ['desktop', VRT_VIEWPORT_DESKTOP, 'payment-settings-bitkit-dialog-desktop'],
    ['mobile', VRT_VIEWPORT_MOBILE, 'payment-settings-bitkit-dialog-mobile'],
  ] as const)('renders the Bitkit setup dialog at %s viewport', async (size, viewport, baseline) => {
    view.paykitServerApi = 'upstream';
    view.accountClaimed = false;
    // Bitcoin stays off: a seller who switched it on was connected before and is offered reconnect instead.
    view.ownConfig = { bitcoinEnabled: false };
    await setTouch(size === 'mobile');

    const screen = await renderForVRT(<MarketplacePaymentSettings />, { viewport });
    await screen.getByRole('button', { name: 'Connect Bitkit' }).click();
    const frame = screen.getByTitle('Connect Bitkit');
    await expect(frame).toBeVisible();
    await expect(await waitForPaykitSetupPage('Connect Bitkit')).toBe(view.touch ? 'bitkit-button' : 'qr');
    await expect.element(frame).toHaveStyle({ height: view.touch ? '60px' : '192px' });
    await expect
      .element(screen.getByText(view.touch ? 'Tap Continue with Bitkit' : 'Scan the code with Bitkit'))
      .toBeVisible();
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(baseline);
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

  it.each([
    ['desktop', VRT_VIEWPORT_DESKTOP, 'payment-settings-usdt-reconnect-dialog-desktop'],
    ['mobile', VRT_VIEWPORT_MOBILE, 'payment-settings-usdt-reconnect-dialog-mobile'],
  ] as const)('renders the USDT reconnect dialog at %s viewport', async (size, viewport, baseline) => {
    view.paykitServerApi = 'upstream';
    setUsdt(USDT_SELLER_CONFIG_RECONNECT_WIRE);
    await setTouch(size === 'mobile');

    const screen = await renderForVRT(<MarketplacePaymentSettings />, { viewport });
    await screen.getByRole('button', { name: /Add USDT in Bitkit/ }).click();
    const frame = screen.getByTitle('Add USDT in Bitkit');
    await expect(frame).toBeVisible();
    await expect(await waitForPaykitSetupPage('Add USDT in Bitkit')).toBe(view.touch ? 'bitkit-button' : 'qr');
    await expect.element(frame).toHaveStyle({ height: view.touch ? '60px' : '192px' });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(baseline);
  });
});
