import type { Session } from '@synonymdev/pubky';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { CommerceController } from '@/controllers/commerce/commerce';
import { type SellerPaymentConfigOwnView, sellerPaymentConfigOwnViewSchema } from '@/libs/commerce/payment-methods';
import { toCamelCaseWire } from '@/libs/commerce/wire-casing';
import { toast } from '@/molecules/Toaster/use-toast';
import { MarketplaceGetPaidSettings } from '@/organisms/Marketplace/MarketplaceGetPaidSettings';
import { useAuthStore } from '@/stores/auth/auth.store';
import type { GrantSigner } from '@/stores/auth/auth.types';
import { useCommerceStore } from '@/stores/commerce/commerce.store';
import {
  USDT_SELLER_CONFIG_FLAG_OFF_WIRE,
  USDT_SELLER_CONFIG_READY_WIRE,
  USDT_SELLER_CONFIG_RECONNECT_WIRE,
  USDT_SELLER_CONFIG_SETUP_WIRE,
  USDT_SELLER_CONFIG_STRANDED_WIRE,
  USDT_SELLER_CONFIG_UNAVAILABLE_WIRE,
} from '@/test/fixtures/commerce/seller-payment-config-usdt.wire';
import { asOpaque } from '@/test-utils/type-assertions';

const runtime = vi.hoisted(() => ({ api: 'fork' as 'fork' | 'upstream' }));
vi.mock('@/config/commerce', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/commerce')>();
  return { ...actual, getPaykitServerApi: () => runtime.api };
});

const PUBKY = 'gy1wnkhfwezwdnawnur1bc3kw1x3jf5ggjj3cm37e31i5ntq3pco';

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    getPaykitSetupUrl: vi.fn(),
    getPaykitReconnectUrl: vi.fn(),
    fetchUsdtPaymentsAvailable: vi.fn(),
    getMyPaymentConfig: vi.fn(),
    putMyPaymentConfig: vi.fn(),
    beginMarketplaceSessionConnect: vi.fn(),
    hasFullHomeserverGrant: vi.fn(() => false),
  },
}));
vi.mock('@/molecules/Toaster/use-toast', () => ({
  toast: vi.fn(),
  useToast: () => ({ toast: vi.fn() }),
}));

const mocked = vi.mocked(CommerceController);
const mockedToast = vi.mocked(toast);

const ownViewEnvelope = z.object({ paymentConfig: sellerPaymentConfigOwnViewSchema });
const fromWire = (wire: unknown): SellerPaymentConfigOwnView =>
  ownViewEnvelope.parse(toCamelCaseWire(wire)).paymentConfig;

function paykitUrl(path: string) {
  return (returnTo: unknown, state: unknown, creator: unknown) => {
    const url = new URL(`https://paykit.example${path}`);
    url.searchParams.set('return_to', String(returnTo));
    url.searchParams.set('state', String(state));
    url.searchParams.set('creator', String(creator));
    return url.toString();
  };
}

async function renderSettings() {
  render(<MarketplaceGetPaidSettings />);
  await screen.findByLabelText('PayPal merchant email');
}

function sendCallback(iframe: HTMLIFrameElement, data: Record<string, unknown> = {}) {
  const source = {} as WindowProxy;
  Object.defineProperty(iframe, 'contentWindow', { configurable: true, value: source });
  const state = new URL(iframe.src).searchParams.get('state');
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://paykit.example',
        source,
        data: { type: 'paykit-setup-callback', state, ...data },
      }),
    );
  });
}

beforeEach(() => {
  runtime.api = 'fork';
  mockedToast.mockReset();
  mocked.getPaykitSetupUrl.mockReset().mockImplementation(paykitUrl('/setup'));
  mocked.getPaykitReconnectUrl.mockReset().mockImplementation(paykitUrl('/setup/reconnect'));
  mocked.fetchUsdtPaymentsAvailable.mockReset().mockResolvedValue(true);
  mocked.getMyPaymentConfig.mockReset().mockResolvedValue(fromWire(USDT_SELLER_CONFIG_READY_WIRE));
  mocked.putMyPaymentConfig.mockReset().mockImplementation(async (input) => ({
    bitcoinEnabled: input.bitcoinEnabled,
    paypalMerchantEmail: input.paypalMerchantEmail,
    updatedAt: '2026-10-09T12:30:00.000Z',
    ...(input.usdtEnabled === undefined
      ? {}
      : { usdtEnabled: input.usdtEnabled, usdtSetup: 'ready' as const, usdtSetupAction: null }),
  }));
  useCommerceStore.setState({
    marketplaceSession: {
      pubky: PUBKY,
      capabilities: '/pub/pubky.app/:rw',
      issuedAt: '2026-10-09T12:00:00.000Z',
      expiresAt: '2026-11-09T12:00:00.000Z',
    },
  });
  useAuthStore.setState({ currentUserPubky: PUBKY, session: null, grantSigner: null });
});

function signInWith(grantSigner: GrantSigner) {
  useAuthStore.setState({ session: asOpaque<Session>({ grant: {} }), grantSigner });
}

function methodTitles() {
  return within(screen.getByRole('region', { name: 'Payment methods' }))
    .getAllByRole('heading', { level: 2 })
    .map((heading) => heading.textContent);
}

describe('MarketplaceGetPaidSettings USDT', () => {
  it.each(['fork', 'upstream'] as const)(
    'offers new wallet downloads only with a compatible backend (%s)',
    async (api) => {
      runtime.api = api;
      await renderSettings();
      const download = screen.queryByRole('link', { name: 'Download Bitkit on the App Store' });
      if (api === 'upstream') expect(download).toBeVisible();
      else expect(download).not.toBeInTheDocument();
    },
  );

  describe('gate', () => {
    it('renders nothing USDT-shaped and sends no USDT field while the gate is off', async () => {
      mocked.fetchUsdtPaymentsAvailable.mockResolvedValue(false);
      mocked.getMyPaymentConfig.mockResolvedValue(fromWire(USDT_SELLER_CONFIG_FLAG_OFF_WIRE));
      await renderSettings();

      expect(methodTitles()).toEqual(['PayPal', 'Bitcoin']);
      expect(screen.queryByText(/USDT/)).not.toBeInTheDocument();
      expect(screen.queryByTestId('usdt-seller-setup')).not.toBeInTheDocument();

      await userEvent.click(screen.getAllByRole('button', { name: 'Save changes' })[0]);
      await waitFor(() => expect(mocked.putMyPaymentConfig).toHaveBeenCalledTimes(1));
      expect(mocked.putMyPaymentConfig.mock.calls[0]?.[0]).toStrictEqual({
        bitcoinEnabled: true,
        paypalMerchantEmail: 'seller@example.com',
      });
    });

    it('stays hidden when the Shop flag is on but the service reports no USDT', async () => {
      mocked.fetchUsdtPaymentsAvailable.mockResolvedValue(false);
      mocked.getMyPaymentConfig.mockResolvedValue(fromWire(USDT_SELLER_CONFIG_FLAG_OFF_WIRE));
      await renderSettings();
      expect(methodTitles()).toEqual(['PayPal', 'Bitcoin']);
      expect(screen.queryByText(/USDT/)).not.toBeInTheDocument();
    });

    it('says USDT cannot be checked right now, instead of hiding it, when the capability read fails', async () => {
      mocked.fetchUsdtPaymentsAvailable.mockRejectedValue(new Error('health unreachable'));
      mocked.getMyPaymentConfig.mockResolvedValue(fromWire(USDT_SELLER_CONFIG_FLAG_OFF_WIRE));
      await renderSettings();

      const panel = await screen.findByTestId('usdt-readiness-unavailable');
      expect(methodTitles()).toEqual(['PayPal', 'Bitcoin', 'USDT']);
      expect(panel).toHaveTextContent("USDT can't be checked right now");
      expect(screen.getByRole('switch', { name: 'Accept USDT' })).toBeDisabled();
      expect(screen.queryByRole('button', { name: /Add USDT in Bitkit/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Set up Bitkit payments/ })).not.toBeInTheDocument();
      expect(screen.getByTestId('payment-method-status-usdt')).toHaveTextContent('Needs attention');
    });

    it('re-reads the capability and the configuration on Check again, and recovers when /health answers', async () => {
      mocked.fetchUsdtPaymentsAvailable.mockRejectedValueOnce(new Error('health unreachable')).mockResolvedValue(true);
      mocked.getMyPaymentConfig
        .mockResolvedValueOnce(fromWire(USDT_SELLER_CONFIG_FLAG_OFF_WIRE))
        .mockResolvedValue(fromWire(USDT_SELLER_CONFIG_READY_WIRE));
      await renderSettings();
      await userEvent.click(await screen.findByRole('button', { name: /Check again/ }));

      expect(await screen.findByTestId('usdt-readiness-ready')).toBeInTheDocument();
      expect(mocked.fetchUsdtPaymentsAvailable).toHaveBeenCalledTimes(2);
      expect(mocked.getMyPaymentConfig).toHaveBeenCalledTimes(2);
    });

    it('shows what the service reports when /health is unreadable but the own configuration answered', async () => {
      mocked.fetchUsdtPaymentsAvailable.mockRejectedValue(new Error('health unreachable'));
      await renderSettings();
      expect(await screen.findByTestId('usdt-readiness-ready')).toHaveTextContent('USDT ready');
    });

    it('adds a USDT card after Bitcoin when the gate is on', async () => {
      await renderSettings();
      await screen.findByTestId('usdt-seller-setup');
      expect(methodTitles()).toEqual(['PayPal', 'Bitcoin', 'USDT']);
    });

    it('keeps the stored consent when the Shop flag is off but the service still reports it', async () => {
      mocked.fetchUsdtPaymentsAvailable.mockResolvedValue(false);
      await renderSettings();
      expect(screen.queryByTestId('usdt-seller-setup')).not.toBeInTheDocument();

      await userEvent.click(screen.getAllByRole('button', { name: 'Save changes' })[0]);
      await waitFor(() => expect(mocked.putMyPaymentConfig).toHaveBeenCalledTimes(1));
      expect(mocked.putMyPaymentConfig.mock.calls[0]?.[0]).toMatchObject({ usdtEnabled: true });
    });
  });

  describe('readiness states', () => {
    it('shows no USDT pill while the first read is in flight, then the read answer', async () => {
      let release: (config: SellerPaymentConfigOwnView) => void = () => {};
      mocked.getMyPaymentConfig.mockImplementation(
        () =>
          new Promise<SellerPaymentConfigOwnView>((resolve) => {
            release = resolve;
          }),
      );
      render(<MarketplaceGetPaidSettings />);

      await waitFor(() => expect(methodTitles()).toEqual(['PayPal', 'Bitcoin', 'USDT']));
      expect(screen.queryByTestId('payment-method-status-usdt')).not.toBeInTheDocument();

      await act(async () => release(fromWire(USDT_SELLER_CONFIG_READY_WIRE)));
      expect(await screen.findByTestId('payment-method-status-usdt')).toHaveTextContent('Connected');
    });

    it('shows USDT ready and lets the seller switch Accept USDT off and on', async () => {
      await renderSettings();
      expect(await screen.findByTestId('usdt-readiness-ready')).toHaveTextContent('USDT ready');
      expect(screen.getByTestId('payment-method-status-usdt')).toHaveTextContent('Connected');
      expect(screen.queryByText(/USDT needs Bitkit/)).not.toBeInTheDocument();

      const toggle = screen.getByRole('switch', { name: 'Accept USDT' });
      expect(toggle).toBeChecked();
      await userEvent.click(toggle);
      expect(toggle).not.toBeChecked();
      expect(toggle).toBeEnabled();
      await userEvent.click(toggle);
      expect(toggle).toBeChecked();
    });

    it('offers Add USDT in Bitkit for a Bitkit account that never shared a USDT address', async () => {
      signInWith('bitkit');
      mocked.getMyPaymentConfig.mockResolvedValue(fromWire(USDT_SELLER_CONFIG_RECONNECT_WIRE));
      await renderSettings();

      const panel = await screen.findByTestId('usdt-readiness-reconnect');
      expect(panel).toHaveTextContent('USDT needs a USDT address in Bitkit.');
      expect(panel).not.toHaveTextContent(/Ring/);
      expect(within(panel).getByRole('button', { name: /Add USDT in Bitkit/ })).toBeEnabled();
      expect(screen.queryByRole('button', { name: /Set up Bitkit payments/ })).not.toBeInTheDocument();
      expect(screen.getByTestId('payment-method-status-usdt')).toHaveTextContent('Not set up');
      expect(panel).toHaveTextContent(/can cancel a buyer's pending Bitcoin request that has not been accepted yet/);
      expect(panel).not.toHaveTextContent(/stays the same/);
    });

    it('names Pubky Ring as unable to share a USDT address only for a seller who signed in with Ring', async () => {
      signInWith('ring');
      mocked.getMyPaymentConfig.mockResolvedValue(fromWire(USDT_SELLER_CONFIG_RECONNECT_WIRE));
      await renderSettings();

      const panel = await screen.findByTestId('usdt-readiness-reconnect');
      expect(panel).toHaveTextContent("USDT needs Bitkit. Pubky Ring can't share a USDT address.");
      expect(panel).toHaveTextContent(/can cancel a buyer's pending Bitcoin request that has not been accepted yet/);
    });

    it('uses neutral wording when the sign-in does not identify a signer', async () => {
      mocked.getMyPaymentConfig.mockResolvedValue(fromWire(USDT_SELLER_CONFIG_RECONNECT_WIRE));
      await renderSettings();

      const panel = await screen.findByTestId('usdt-readiness-reconnect');
      expect(panel).toHaveTextContent('USDT needs Bitkit to share a USDT address.');
      expect(panel).not.toHaveTextContent(/Ring|Passport/);
      expect(panel).toHaveTextContent(/can cancel a buyer's pending Bitcoin request that has not been accepted yet/);
    });

    it('offers Set up Bitkit payments for a seller with no Paykit account', async () => {
      signInWith('bitkit');
      mocked.getMyPaymentConfig.mockResolvedValue(fromWire(USDT_SELLER_CONFIG_SETUP_WIRE));
      await renderSettings();

      const panel = await screen.findByTestId('usdt-readiness-setup');
      expect(panel).toHaveTextContent('USDT needs a USDT address in Bitkit.');
      expect(within(panel).getByRole('button', { name: /Set up Bitkit payments/ })).toBeEnabled();
      expect(screen.queryByRole('button', { name: /Add USDT in Bitkit/ })).not.toBeInTheDocument();
    });

    it('says USDT cannot be checked and offers no authorization flow when Paykit is unavailable', async () => {
      mocked.getMyPaymentConfig.mockResolvedValue(fromWire(USDT_SELLER_CONFIG_UNAVAILABLE_WIRE));
      await renderSettings();

      const panel = await screen.findByTestId('usdt-readiness-unavailable');
      expect(panel).toHaveTextContent("USDT can't be checked right now");
      expect(screen.queryByRole('button', { name: /Add USDT in Bitkit/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Set up Bitkit payments/ })).not.toBeInTheDocument();
      expect(screen.getByTestId('payment-method-status-usdt')).toHaveTextContent('Needs attention');
    });

    it('re-reads the stored configuration when the seller checks again', async () => {
      mocked.getMyPaymentConfig
        .mockResolvedValueOnce(fromWire(USDT_SELLER_CONFIG_UNAVAILABLE_WIRE))
        .mockResolvedValue(fromWire(USDT_SELLER_CONFIG_READY_WIRE));
      await renderSettings();
      const panel = await screen.findByTestId('usdt-readiness-unavailable');
      await userEvent.click(within(panel).getByRole('button', { name: /Check again/ }));

      expect(await screen.findByTestId('usdt-readiness-ready')).toBeInTheDocument();
      expect(mocked.getMyPaymentConfig).toHaveBeenCalledTimes(2);
    });

    it('never enables USDT while it is not ready, whatever the sign-in', async () => {
      mocked.getMyPaymentConfig.mockResolvedValue(fromWire(USDT_SELLER_CONFIG_RECONNECT_WIRE));
      await renderSettings();
      const toggle = await screen.findByRole('switch', { name: 'Accept USDT' });
      expect(toggle).toBeDisabled();
      expect(toggle).not.toBeChecked();
      fireEvent.click(toggle);
      expect(toggle).not.toBeChecked();
    });

    it('fails closed to "can\'t be checked" for a seller who has never saved a configuration', async () => {
      mocked.getMyPaymentConfig.mockResolvedValue(null);
      await renderSettings();
      expect(await screen.findByTestId('usdt-readiness-unavailable')).toBeInTheDocument();
      expect(screen.getByRole('switch', { name: 'Accept USDT' })).toBeDisabled();
    });

    it('fails closed when the service sends a status the Shop does not know', async () => {
      mocked.getMyPaymentConfig.mockResolvedValue(
        fromWire({
          payment_config: { ...USDT_SELLER_CONFIG_READY_WIRE.payment_config, usdt_setup: 'maybe' },
        }),
      );
      await renderSettings();
      expect(await screen.findByTestId('usdt-readiness-unavailable')).toBeInTheDocument();
    });

    it('never renders an address', async () => {
      mocked.getMyPaymentConfig.mockResolvedValue(
        fromWire({
          payment_config: {
            ...USDT_SELLER_CONFIG_READY_WIRE.payment_config,
            usdt_address: '0x0000000000000000000000000000000000000001',
          },
        }),
      );
      await renderSettings();
      const panel = await screen.findByTestId('usdt-seller-setup');
      expect(panel.textContent).not.toMatch(/0x[0-9a-fA-F]{4}/);
      expect(document.body.textContent).not.toContain('0x0000');
    });
  });

  describe('saving', () => {
    it('sends the seller consent with the rest of the configuration', async () => {
      mocked.getMyPaymentConfig.mockResolvedValue({
        ...fromWire(USDT_SELLER_CONFIG_READY_WIRE),
        usdtEnabled: false,
      });
      await renderSettings();
      await userEvent.click(await screen.findByRole('switch', { name: 'Accept USDT' }));
      await userEvent.click(screen.getAllByRole('button', { name: 'Save changes' }).at(-1)!);

      await waitFor(() => expect(mocked.putMyPaymentConfig).toHaveBeenCalledTimes(1));
      expect(mocked.putMyPaymentConfig.mock.calls[0]?.[0]).toStrictEqual({
        bitcoinEnabled: true,
        paypalMerchantEmail: 'seller@example.com',
        usdtEnabled: true,
      });
    });

    describe('the service has not reported the USDT keys', () => {
      const bitcoinAndPaypalOnly = {
        bitcoinEnabled: true,
        paypalMerchantEmail: 'seller@example.com',
      };

      async function savePaypal() {
        await renderSettings();
        await screen.findByTestId('usdt-seller-setup');
        await userEvent.click(screen.getAllByRole('button', { name: 'Save changes' })[0]);
        await waitFor(() => expect(mocked.putMyPaymentConfig).toHaveBeenCalledTimes(1));
      }

      it('sends no usdtEnabled to a service with /health but without the own-config keys (S1 only)', async () => {
        mocked.fetchUsdtPaymentsAvailable.mockResolvedValue(true);
        mocked.getMyPaymentConfig.mockResolvedValue(fromWire(USDT_SELLER_CONFIG_FLAG_OFF_WIRE));
        await savePaypal();

        expect(screen.getByTestId('usdt-readiness-unavailable')).toBeInTheDocument();
        expect(mocked.putMyPaymentConfig.mock.calls[0]?.[0]).toStrictEqual(bitcoinAndPaypalOnly);
      });

      it('sends no usdtEnabled while /health is unreadable and the own configuration has no USDT keys', async () => {
        mocked.fetchUsdtPaymentsAvailable.mockRejectedValue(new Error('health unreachable'));
        mocked.getMyPaymentConfig.mockResolvedValue(fromWire(USDT_SELLER_CONFIG_FLAG_OFF_WIRE));
        await savePaypal();

        expect(mocked.putMyPaymentConfig.mock.calls[0]?.[0]).toStrictEqual(bitcoinAndPaypalOnly);
      });

      it('sends no usdtEnabled when the Shop flag is on and the service has USDT off', async () => {
        mocked.fetchUsdtPaymentsAvailable.mockResolvedValue(false);
        mocked.getMyPaymentConfig.mockResolvedValue(fromWire(USDT_SELLER_CONFIG_FLAG_OFF_WIRE));
        await renderSettings();
        await userEvent.click(screen.getAllByRole('button', { name: 'Save changes' })[0]);
        await waitFor(() => expect(mocked.putMyPaymentConfig).toHaveBeenCalledTimes(1));

        expect(mocked.putMyPaymentConfig.mock.calls[0]?.[0]).toStrictEqual(bitcoinAndPaypalOnly);
      });
    });

    it('sends the stored consent when the service reported the USDT keys, even if /health is unreadable', async () => {
      mocked.fetchUsdtPaymentsAvailable.mockRejectedValue(new Error('health unreachable'));
      await renderSettings();
      await screen.findByTestId('usdt-seller-setup');
      await userEvent.click(screen.getAllByRole('button', { name: 'Save changes' })[0]);

      await waitFor(() => expect(mocked.putMyPaymentConfig).toHaveBeenCalledTimes(1));
      expect(mocked.putMyPaymentConfig.mock.calls[0]?.[0]).toStrictEqual({
        bitcoinEnabled: true,
        paypalMerchantEmail: 'seller@example.com',
        usdtEnabled: true,
      });
    });

    it('keeps the stored consent when only PayPal is saved', async () => {
      await renderSettings();
      await screen.findByTestId('usdt-seller-setup');
      await userEvent.click(screen.getAllByRole('button', { name: 'Save changes' })[0]);

      await waitFor(() => expect(mocked.putMyPaymentConfig).toHaveBeenCalledTimes(1));
      expect(mocked.putMyPaymentConfig.mock.calls[0]?.[0]).toMatchObject({ usdtEnabled: true });
    });
  });

  describe('Bitkit reconnect', () => {
    beforeEach(() => {
      mocked.getMyPaymentConfig.mockResolvedValue(fromWire(USDT_SELLER_CONFIG_RECONNECT_WIRE));
    });

    async function openReconnect() {
      await renderSettings();
      await userEvent.click(await screen.findByRole('button', { name: /Add USDT in Bitkit/ }));
      return screen.getByTitle('Add USDT in Bitkit') as HTMLIFrameElement;
    }

    it('opens the reconnect URL in the same embedded Paykit iframe, not the setup URL', async () => {
      runtime.api = 'upstream';
      const iframe = await openReconnect();

      expect(mocked.getPaykitReconnectUrl).toHaveBeenCalledTimes(1);
      expect(mocked.getPaykitSetupUrl).not.toHaveBeenCalled();
      expect(iframe).not.toHaveAttribute('scrolling', 'no');
      expect(iframe).toHaveClass('h-48', 'w-full');
      expect(iframe).not.toHaveClass('h-[40rem]');
      const url = new URL(iframe.getAttribute('src')!);
      expect(url.origin + url.pathname).toBe('https://paykit.example/setup/reconnect');
      expect(url.searchParams.get('creator')).toBe(PUBKY);
      expect(url.searchParams.get('state')).toHaveLength(22);
      expect(url.hash).toBe('#embed');
      expect(screen.getByRole('heading', { name: 'Add USDT in Bitkit' })).toBeInTheDocument();
      const dialog = within(screen.getByRole('dialog', { name: 'Add USDT in Bitkit' }));
      expect(dialog.getByText(/Bitkit also gives Paykit a new Bitcoin account/)).toBeInTheDocument();
      expect(
        dialog.getByText(/can cancel a buyer's pending Bitcoin request that has not been accepted yet/),
      ).toBeInTheDocument();
      expect(screen.queryByText(/stay the same/)).not.toBeInTheDocument();
      expect(screen.getByText(/tap Continue with Bitkit, to share a USDT address/)).toBeInTheDocument();
    });

    it('re-reads the configuration on completion and shows USDT ready', async () => {
      const iframe = await openReconnect();
      mocked.getMyPaymentConfig.mockResolvedValue(fromWire(USDT_SELLER_CONFIG_READY_WIRE));
      sendCallback(iframe);

      await waitFor(() => expect(screen.queryByTitle('Add USDT in Bitkit')).not.toBeInTheDocument());
      expect(mockedToast).toHaveBeenCalledWith({ title: 'USDT is ready' });
      expect(await screen.findByTestId('usdt-readiness-ready')).toBeInTheDocument();
      expect(mocked.getMyPaymentConfig).toHaveBeenCalledTimes(2);
    });

    it('keeps the dialog open when the service still reports no USDT address, and retries in reconnect mode', async () => {
      const iframe = await openReconnect();
      const firstState = new URL(iframe.src).searchParams.get('state');
      sendCallback(iframe);

      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('did not confirm a USDT address'));
      expect(mockedToast).not.toHaveBeenCalled();
      expect(screen.getByTestId('usdt-readiness-reconnect')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
      const retried = screen.getByTitle('Add USDT in Bitkit') as HTMLIFrameElement;
      expect(mocked.getPaykitReconnectUrl).toHaveBeenCalledTimes(2);
      expect(mocked.getPaykitSetupUrl).not.toHaveBeenCalled();
      expect(new URL(retried.src).searchParams.get('state')).not.toBe(firstState);
    });

    it('reports a failed completion only after the service still shows no USDT address', async () => {
      const iframe = await openReconnect();
      sendCallback(iframe, { error: 'setup-failed' });
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Bitkit setup failed. Try again.'));
      expect(mocked.getMyPaymentConfig).toHaveBeenCalledTimes(2);
      expect(mockedToast).not.toHaveBeenCalled();
    });

    it('shows USDT ready when an expired callback arrives after the service completed the reconnect', async () => {
      const iframe = await openReconnect();
      mocked.getMyPaymentConfig.mockResolvedValue(fromWire(USDT_SELLER_CONFIG_READY_WIRE));
      sendCallback(iframe, { error: 'expired' });

      await waitFor(() => expect(screen.queryByTitle('Add USDT in Bitkit')).not.toBeInTheDocument());
      expect(mockedToast).toHaveBeenCalledWith({ title: 'USDT is ready' });
      expect(screen.queryByText(/setup failed/i)).not.toBeInTheDocument();
      expect(await screen.findByTestId('usdt-readiness-ready')).toBeInTheDocument();
    });

    it('reports a different Bitkit identity', async () => {
      const iframe = await openReconnect();
      sendCallback(iframe, { error: 'identity-mismatch' });
      expect(screen.getByRole('alert')).toHaveTextContent('Bitkit approved a different pubky');
    });

    it('ignores a late callback from a closed reconnect dialog', async () => {
      const iframe = await openReconnect();
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      mocked.getMyPaymentConfig.mockClear();
      sendCallback(iframe);
      expect(mocked.getMyPaymentConfig).not.toHaveBeenCalled();
      expect(mockedToast).not.toHaveBeenCalled();
    });
  });

  describe('an existing Bitcoin seller adds USDT (reconnect)', () => {
    const readyBitcoinNoUsdt = () => ({
      ...fromWire(USDT_SELLER_CONFIG_RECONNECT_WIRE),
      bitcoinSetup: 'ready' as const,
      bitcoinSetupAction: null,
    });

    it('is offered the reconnect again, never the initial setup Paykit refuses, when the reconnect stops after Paykit stored the credentials', async () => {
      runtime.api = 'upstream';
      mocked.getMyPaymentConfig.mockResolvedValue(readyBitcoinNoUsdt());
      await renderSettings();
      expect(await screen.findByTestId('payment-method-status-bitcoin')).toHaveTextContent('Connected');
      await userEvent.click(await screen.findByRole('button', { name: /Add USDT in Bitkit/ }));
      const iframe = screen.getByTitle('Add USDT in Bitkit') as HTMLIFrameElement;
      expect(new URL(iframe.src).pathname).toBe('/setup/reconnect');

      // The approval went through in Bitkit and paykit-server stored the new credentials, but the reconnect did
      // not finish: Paykit now reads the seller as setup_required on every rail.
      mocked.getMyPaymentConfig.mockResolvedValue(fromWire(USDT_SELLER_CONFIG_STRANDED_WIRE));
      sendCallback(iframe);
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('did not confirm a USDT address'));
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.getByTestId('payment-method-status-bitcoin')).toHaveTextContent('Needs attention');
      const usdt = screen.getByTestId('usdt-seller-setup');
      expect(within(usdt).getByRole('button', { name: /Add USDT in Bitkit/ })).toBeEnabled();
      expect(screen.queryByRole('button', { name: /Set up Bitkit payments/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Connect Bitkit/ })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Reconnect Bitkit/ })).toBeEnabled();

      // Either card finishes it through the reconnect route, and both rails are ready again.
      mocked.getMyPaymentConfig.mockResolvedValue(fromWire(USDT_SELLER_CONFIG_READY_WIRE));
      await userEvent.click(screen.getByRole('button', { name: /Reconnect Bitkit/ }));
      const retried = screen.getByTitle('Reconnect Bitkit') as HTMLIFrameElement;
      expect(new URL(retried.src).pathname).toBe('/setup/reconnect');
      sendCallback(retried);
      expect(await screen.findByTestId('usdt-readiness-ready')).toBeInTheDocument();
      expect(await screen.findByText('Wallet connected.')).toBeInTheDocument();
      expect(screen.getByTestId('payment-method-status-bitcoin')).toHaveTextContent('Connected');
      expect(mocked.getPaykitSetupUrl).not.toHaveBeenCalled();
    });

    it('adds USDT in one reconnect and leaves Bitcoin connected', async () => {
      runtime.api = 'upstream';
      mocked.getMyPaymentConfig.mockResolvedValue(readyBitcoinNoUsdt());
      await renderSettings();
      await userEvent.click(await screen.findByRole('button', { name: /Add USDT in Bitkit/ }));
      const iframe = screen.getByTitle('Add USDT in Bitkit') as HTMLIFrameElement;

      mocked.getMyPaymentConfig.mockResolvedValue(fromWire(USDT_SELLER_CONFIG_READY_WIRE));
      sendCallback(iframe);

      expect(await screen.findByTestId('usdt-readiness-ready')).toBeInTheDocument();
      expect(mockedToast).toHaveBeenCalledWith({ title: 'USDT is ready' });
      expect(screen.getByTestId('payment-method-status-bitcoin')).toHaveTextContent('Connected');
      expect(mocked.getPaykitSetupUrl).not.toHaveBeenCalled();
    });

    it('still offers the initial setup, and only that, to a seller Paykit has never held', async () => {
      runtime.api = 'upstream';
      mocked.getMyPaymentConfig.mockResolvedValue({
        ...fromWire(USDT_SELLER_CONFIG_SETUP_WIRE),
        bitcoinSetupAction: 'setup',
      });
      await renderSettings();

      expect(await screen.findByRole('button', { name: /Set up Bitkit payments/ })).toBeEnabled();
      expect(screen.queryByRole('button', { name: /Add USDT in Bitkit/ })).not.toBeInTheDocument();
      expect(screen.getByTestId('payment-method-status-bitcoin')).toHaveTextContent('Not set up');
    });
  });

  describe('Bitkit setup from the USDT card', () => {
    it('opens the setup URL, and the setup callback confirms it from the fresh bitcoin_setup', async () => {
      mocked.getMyPaymentConfig.mockResolvedValue(fromWire(USDT_SELLER_CONFIG_SETUP_WIRE));
      await renderSettings();
      await userEvent.click(await screen.findByRole('button', { name: /Set up Bitkit payments/ }));

      const iframe = screen.getByTitle('Connect Bitkit') as HTMLIFrameElement;
      expect(mocked.getPaykitSetupUrl).toHaveBeenCalledTimes(1);
      expect(mocked.getPaykitReconnectUrl).not.toHaveBeenCalled();
      expect(new URL(iframe.src).pathname).toBe('/setup');

      mocked.getMyPaymentConfig.mockResolvedValue(fromWire(USDT_SELLER_CONFIG_READY_WIRE));
      sendCallback(iframe);

      await waitFor(() => expect(screen.queryByTitle('Connect Bitkit')).not.toBeInTheDocument());
      expect(mockedToast).toHaveBeenCalledWith({ title: 'Bitkit setup connected' });
      expect(await screen.findByTestId('usdt-readiness-ready')).toBeInTheDocument();
    });
  });
});
