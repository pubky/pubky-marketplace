import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import { toast } from '@/molecules/Toaster/use-toast';
import { MarketplaceGetPaidSettings } from '@/organisms/Marketplace/MarketplaceGetPaidSettings';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useCommerceStore } from '@/stores/commerce/commerce.store';

const runtime = vi.hoisted(() => ({ api: 'upstream' as 'fork' | 'upstream' }));
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

/** The seller's own config with the service's uncached `bitcoin_setup`. */
function ownConfig(
  bitcoinSetup: 'ready' | 'setup_required' | 'unavailable',
  bitcoinSetupAction?: 'setup' | 'reconnect' | null,
) {
  return {
    bitcoinEnabled: false,
    bitcoinSetup,
    ...(bitcoinSetupAction === undefined ? {} : { bitcoinSetupAction }),
    paypalMerchantEmail: null,
    updatedAt: '1970-01-01T00:00:00.000Z',
  };
}

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

function paykitFrame(name: string): HTMLIFrameElement {
  return within(screen.getByRole('dialog', { name })).getByTitle(name) as HTMLIFrameElement;
}

function framePath(iframe: HTMLIFrameElement): string {
  const url = new URL(iframe.src);
  return url.origin + url.pathname;
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
  runtime.api = 'upstream';
  mockedToast.mockReset();
  mocked.getPaykitSetupUrl.mockReset().mockImplementation(paykitUrl('/setup'));
  mocked.getPaykitReconnectUrl.mockReset().mockImplementation(paykitUrl('/setup/reconnect'));
  mocked.fetchUsdtPaymentsAvailable.mockReset().mockResolvedValue(false);
  mocked.getMyPaymentConfig.mockReset().mockResolvedValue(ownConfig('setup_required'));
  mocked.putMyPaymentConfig.mockReset();
  useCommerceStore.setState({
    marketplaceSession: {
      pubky: PUBKY,
      capabilities: '/pub/pubky.app/:rw',
      issuedAt: '2026-10-09T12:00:00.000Z',
      expiresAt: '2026-11-09T12:00:00.000Z',
    },
  });
  useAuthStore.setState({ currentUserPubky: PUBKY });
});

describe('MarketplaceGetPaidSettings Bitkit reconnect (upstream Paykit)', () => {
  it('reconnects, never re-runs initial setup, when Paykit already holds the wallet', async () => {
    mocked.getMyPaymentConfig.mockResolvedValue(ownConfig('ready'));
    await renderSettings();
    expect(await screen.findByText('Wallet connected.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect Bitkit/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Reconnect Bitkit/ }));

    const iframe = paykitFrame('Reconnect Bitkit');
    expect(framePath(iframe)).toBe('https://paykit.example/setup/reconnect');
    expect(new URL(iframe.src).searchParams.get('creator')).toBe(PUBKY);
    // The Bitcoin reconnect is the full one: no USDT-only asset.
    expect(mocked.getPaykitReconnectUrl).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      undefined,
    );
    expect(mocked.getPaykitSetupUrl).not.toHaveBeenCalled();
    expect(screen.getByText(/Paykit already has a Bitkit setup for this pubky/)).toBeInTheDocument();
    expect(
      screen.getByText(/new Bitcoin account, which can cancel a buyer's pending Bitcoin request/),
    ).toBeInTheDocument();

    sendCallback(iframe);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Reconnect Bitkit' })).not.toBeInTheDocument());
    expect(mockedToast).toHaveBeenCalledWith({ title: 'Bitkit reconnected' });
  });

  it('offers reconnect after Paykit refuses the initial setup, and connects through it', async () => {
    await renderSettings();
    await userEvent.click(await screen.findByRole('button', { name: /Connect Bitkit/ }));
    const setupFrame = paykitFrame('Connect Bitkit');
    expect(framePath(setupFrame)).toBe('https://paykit.example/setup');
    expect(screen.getByText('Tap Continue with Bitkit')).toBeInTheDocument();

    sendCallback(setupFrame, { error: 'setup-failed' });
    expect(await screen.findByText(/reconnect it instead/)).toBeInTheDocument();
    const dialog = screen.getByRole('dialog', { name: 'Connect Bitkit' });
    expect(within(dialog).getByRole('button', { name: /Retry/ })).toBeInTheDocument();

    mocked.getMyPaymentConfig.mockResolvedValue(ownConfig('ready'));
    await userEvent.click(within(dialog).getByRole('button', { name: /Reconnect Bitkit/ }));
    const reconnectFrame = paykitFrame('Reconnect Bitkit');
    expect(framePath(reconnectFrame)).toBe('https://paykit.example/setup/reconnect');

    sendCallback(reconnectFrame);
    expect(await screen.findByText('Wallet connected.')).toBeInTheDocument();
    expect(mockedToast).toHaveBeenCalledWith({ title: 'Bitkit reconnected' });
  });

  it('keeps reconnect on the settings card after the failed setup dialog is closed', async () => {
    await renderSettings();
    await userEvent.click(await screen.findByRole('button', { name: /Connect Bitkit/ }));
    sendCallback(paykitFrame('Connect Bitkit'), { error: 'setup-failed' });
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'Connect Bitkit' })).getByRole('button', { name: 'Cancel' }),
    );

    expect(screen.getByTestId('paykit-setup-problem')).toHaveTextContent(/reconnect it instead/);
    await userEvent.click(screen.getByRole('button', { name: /Reconnect Bitkit/ }));
    expect(framePath(paykitFrame('Reconnect Bitkit'))).toBe('https://paykit.example/setup/reconnect');
  });

  it('says reconnecting failed, not setup, when a reconnect fails', async () => {
    mocked.getMyPaymentConfig.mockResolvedValue(ownConfig('ready'));
    await renderSettings();
    await userEvent.click(await screen.findByRole('button', { name: /Reconnect Bitkit/ }));
    sendCallback(paykitFrame('Reconnect Bitkit'), { error: 'setup-failed' });

    const dialog = screen.getByRole('dialog', { name: 'Reconnect Bitkit' });
    expect(await within(dialog).findByText('Reconnecting Bitkit failed. Try again.')).toBeInTheDocument();
    expect(within(dialog).queryByText(/setup failed/i)).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /Retry/ })).toBeInTheDocument();
  });

  it('starts no Bitkit authorization while the wallet state is unavailable, and offers setup once the service answers', async () => {
    mocked.getMyPaymentConfig.mockResolvedValue(ownConfig('unavailable'));
    await renderSettings();

    expect(await screen.findByTestId('bitkit-setup-unknown')).toHaveTextContent("We can't check Bitkit right now.");
    expect(screen.queryByText('Wallet connected.')).not.toBeInTheDocument();
    expect(screen.queryByText('1. Connect Bitkit')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect Bitkit|Reconnect Bitkit|Connect now|Try again/ })).toBeNull();

    mocked.getMyPaymentConfig.mockResolvedValue(ownConfig('unavailable'));
    await userEvent.click(screen.getByRole('button', { name: /Check again/ }));
    await waitFor(() => expect(mocked.getMyPaymentConfig).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('bitkit-setup-unknown')).toBeInTheDocument();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelector('iframe')).toBeNull();
    expect(mocked.getPaykitSetupUrl).not.toHaveBeenCalled();
    expect(mocked.getPaykitReconnectUrl).not.toHaveBeenCalled();

    mocked.getMyPaymentConfig.mockResolvedValue(ownConfig('setup_required'));
    await userEvent.click(screen.getByRole('button', { name: /Check again/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Connect Bitkit/ }));
    expect(framePath(paykitFrame('Connect Bitkit'))).toBe('https://paykit.example/setup');
  });
  describe('the service names the flow (bitcoin_setup_action)', () => {
    it('sends a seller Paykit holds to reconnect, not to the initial setup it refuses', async () => {
      mocked.getMyPaymentConfig.mockResolvedValue(ownConfig('setup_required', 'reconnect'));
      await renderSettings();

      expect(await screen.findByTestId('payment-method-status-bitcoin')).toHaveTextContent('Needs attention');
      expect(screen.queryByRole('button', { name: /Connect Bitkit/ })).not.toBeInTheDocument();
      expect(screen.getByTestId('bitcoin-toggle-blocker')).toHaveTextContent('Reconnect Bitkit first.');
      expect(screen.getByRole('switch', { name: 'Accept bitcoin' })).toBeDisabled();

      await userEvent.click(screen.getByRole('button', { name: /Reconnect Bitkit/ }));
      const iframe = paykitFrame('Reconnect Bitkit');
      expect(framePath(iframe)).toBe('https://paykit.example/setup/reconnect');
      expect(new URL(iframe.src).searchParams.get('creator')).toBe(PUBKY);
      expect(mocked.getPaykitSetupUrl).not.toHaveBeenCalled();

      mocked.getMyPaymentConfig.mockResolvedValue(ownConfig('ready', null));
      sendCallback(iframe);
      expect(await screen.findByText('Wallet connected.')).toBeInTheDocument();
      expect(mockedToast).toHaveBeenCalledWith({ title: 'Bitkit reconnected' });
      expect(screen.getByTestId('payment-method-status-bitcoin')).toHaveTextContent('Connected');
      expect(mocked.getPaykitSetupUrl).not.toHaveBeenCalled();
    });

    it('reconnects from the toggle blocker too, with one Reconnect Bitkit button on the step', async () => {
      mocked.getMyPaymentConfig.mockResolvedValue(ownConfig('setup_required', 'reconnect'));
      await renderSettings();

      expect(await screen.findAllByRole('button', { name: /Reconnect Bitkit/ })).toHaveLength(1);
      await userEvent.click(screen.getByRole('button', { name: 'Reconnect now' }));
      expect(framePath(paykitFrame('Reconnect Bitkit'))).toBe('https://paykit.example/setup/reconnect');
      expect(mocked.getPaykitSetupUrl).not.toHaveBeenCalled();
    });

    it('says reconnecting failed, with one Reconnect Bitkit offer, when that reconnect fails again', async () => {
      mocked.getMyPaymentConfig.mockResolvedValue(ownConfig('setup_required', 'reconnect'));
      await renderSettings();
      await userEvent.click(await screen.findByRole('button', { name: /Reconnect Bitkit/ }));
      sendCallback(paykitFrame('Reconnect Bitkit'), { error: 'setup-failed' });
      await userEvent.click(
        within(screen.getByRole('dialog', { name: 'Reconnect Bitkit' })).getByRole('button', { name: 'Cancel' }),
      );

      expect(screen.getByTestId('paykit-setup-problem')).toHaveTextContent('Reconnecting Bitkit failed. Try again.');
      expect(screen.getAllByRole('button', { name: /Reconnect Bitkit/ })).toHaveLength(1);
      expect(screen.queryByRole('button', { name: /Connect Bitkit|Try again/ })).not.toBeInTheDocument();
    });

    it('keeps the reconnect, with no initial setup, when Paykit reports the reconnect failed', async () => {
      mocked.getMyPaymentConfig.mockResolvedValue(ownConfig('setup_required', 'reconnect'));
      await renderSettings();
      await userEvent.click(await screen.findByRole('button', { name: /Reconnect Bitkit/ }));
      sendCallback(paykitFrame('Reconnect Bitkit'), { error: 'setup-failed' });

      // An error callback comes from a reconnect Paykit started, so it still holds the seller and refuses `/setup`.
      const dialog = screen.getByRole('dialog', { name: 'Reconnect Bitkit' });
      expect(await within(dialog).findByText('Reconnecting Bitkit failed. Try again.')).toBeInTheDocument();
      expect(within(dialog).queryByRole('button', { name: /Connect Bitkit/ })).not.toBeInTheDocument();
      expect(mocked.getPaykitSetupUrl).not.toHaveBeenCalled();
    });

    it('falls back to initial setup when that reconnect expires without a callback', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        mocked.getMyPaymentConfig.mockResolvedValue(ownConfig('setup_required', 'reconnect'));
        await renderSettings();
        await userEvent.click(await screen.findByRole('button', { name: /Reconnect Bitkit/ }));
        act(() => {
          vi.advanceTimersByTime(6 * 60 * 1_000);
        });

        const dialog = screen.getByRole('dialog', { name: 'Reconnect Bitkit' });
        expect(
          await within(dialog).findByText('If Bitkit never showed a request, Connect Bitkit starts the setup again.'),
        ).toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole('button', { name: /Connect Bitkit/ }));
        expect(framePath(paykitFrame('Connect Bitkit'))).toBe('https://paykit.example/setup');
      } finally {
        vi.useRealTimers();
      }
    });

    it('falls back to initial setup when the USDT card reconnect expires too', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        mocked.fetchUsdtPaymentsAvailable.mockResolvedValue(true);
        mocked.getMyPaymentConfig.mockResolvedValue({
          ...ownConfig('setup_required', 'reconnect'),
          usdtEnabled: false,
          usdtSetup: 'setup_required',
          usdtSetupAction: 'reconnect',
        });
        await renderSettings();
        const panel = await screen.findByTestId('usdt-readiness-reconnect');
        await userEvent.click(within(panel).getByRole('button', { name: /Add USDT in Bitkit/ }));
        act(() => {
          vi.advanceTimersByTime(6 * 60 * 1_000);
        });

        const dialog = screen.getByRole('dialog', { name: 'Add USDT in Bitkit' });
        await userEvent.click(await within(dialog).findByRole('button', { name: /Connect Bitkit/ }));
        expect(framePath(paykitFrame('Connect Bitkit'))).toBe('https://paykit.example/setup');
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps the initial setup for a seller Paykit does not hold', async () => {
      mocked.getMyPaymentConfig.mockResolvedValue(ownConfig('setup_required', 'setup'));
      await renderSettings();

      expect(await screen.findByTestId('payment-method-status-bitcoin')).toHaveTextContent('Not set up');
      expect(screen.getByTestId('bitcoin-toggle-blocker')).toHaveTextContent('Connect Bitkit first.');
      await userEvent.click(screen.getByRole('button', { name: /Connect Bitkit/ }));
      expect(framePath(paykitFrame('Connect Bitkit'))).toBe('https://paykit.example/setup');
      expect(mocked.getPaykitReconnectUrl).not.toHaveBeenCalled();
    });

    it('ignores the action on the fork, which has no reconnect route', async () => {
      runtime.api = 'fork';
      mocked.getMyPaymentConfig.mockResolvedValue(ownConfig('setup_required', 'reconnect'));
      await renderSettings();

      expect(await screen.findByTestId('payment-method-status-bitcoin')).toHaveTextContent('Not set up');
      await userEvent.click(screen.getByRole('button', { name: /Connect Bitkit/ }));
      expect(framePath(paykitFrame('Connect Bitkit'))).toBe('https://paykit.example/setup');
      expect(mocked.getPaykitReconnectUrl).not.toHaveBeenCalled();
    });

    it('offers no flow while the answer is unavailable, whatever the action says', async () => {
      mocked.getMyPaymentConfig.mockResolvedValue(ownConfig('unavailable', 'reconnect'));
      await renderSettings();

      expect(await screen.findByTestId('bitkit-setup-unknown')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /Connect Bitkit|Reconnect Bitkit|Connect now|Reconnect now/ }),
      ).toBeNull();
    });
  });

  it('keeps the fork Paykit on its initial setup route', async () => {
    runtime.api = 'fork';
    mocked.getMyPaymentConfig.mockResolvedValue(ownConfig('ready'));
    await renderSettings();
    await userEvent.click(await screen.findByRole('button', { name: /Connect Bitkit/ }));

    expect(framePath(paykitFrame('Connect Bitkit'))).toBe('https://paykit.example/setup');
    sendCallback(paykitFrame('Connect Bitkit'), { error: 'setup-failed' });
    expect(await screen.findByText('Bitkit setup failed. Try again.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reconnect Bitkit/ })).not.toBeInTheDocument();
    expect(mocked.getPaykitReconnectUrl).not.toHaveBeenCalled();
  });
});
