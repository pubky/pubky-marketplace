import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { CommerceController } from '@/controllers/commerce/commerce';
import { type SellerPaymentConfigOwnView, sellerPaymentConfigOwnViewSchema } from '@/libs/commerce/payment-methods';
import { toCamelCaseWire } from '@/libs/commerce/wire-casing';
import { toast } from '@/molecules/Toaster/use-toast';
import { MarketplaceGetPaidSettings } from '@/organisms/Marketplace/MarketplaceGetPaidSettings';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useCommerceStore } from '@/stores/commerce/commerce.store';
import {
  USDT_SELLER_CONFIG_FLAG_OFF_WIRE,
  USDT_SELLER_CONFIG_READY_WIRE,
  USDT_SELLER_CONFIG_RECONNECT_WIRE,
  USDT_SELLER_CONFIG_SETUP_WIRE,
} from '@/test/fixtures/commerce/seller-payment-config-usdt.wire';

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
    isOwnPaykitAccountClaimed: vi.fn(),
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
const withBitcoinOff = (wire: unknown): SellerPaymentConfigOwnView => ({ ...fromWire(wire), bitcoinEnabled: false });

/** No Lock Server session in this browser: the state a fresh seller is in. */
const locksConnect = {
  connectedCreator: null,
  isExchanging: false,
  error: null,
  connectOpen: false,
  connectUrl: null,
  openConnect: vi.fn(),
};

const LOCKS_UNREADABLE = new Error('Connect the Lock Server to read the Paykit setup state.');

async function renderSettings() {
  render(<MarketplaceGetPaidSettings locksConnect={locksConnect} />);
  await screen.findByLabelText('PayPal merchant email');
}

function sendSetupCallback() {
  const iframe = screen.getByTitle('Connect Bitkit') as HTMLIFrameElement;
  const source = {} as WindowProxy;
  Object.defineProperty(iframe, 'contentWindow', { configurable: true, value: source });
  const state = new URL(iframe.src).searchParams.get('state');
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://paykit.example',
        source,
        data: { type: 'paykit-setup-callback', state },
      }),
    );
  });
}

beforeEach(() => {
  runtime.api = 'upstream';
  mockedToast.mockReset();
  mocked.getPaykitSetupUrl.mockReset().mockImplementation((returnTo: unknown, state: unknown) => {
    const url = new URL('https://paykit.example/setup');
    url.searchParams.set('return_to', String(returnTo));
    url.searchParams.set('state', String(state));
    return url.toString();
  });
  mocked.fetchUsdtPaymentsAvailable.mockReset().mockResolvedValue(true);
  mocked.getMyPaymentConfig.mockReset().mockResolvedValue(withBitcoinOff(USDT_SELLER_CONFIG_SETUP_WIRE));
  mocked.isOwnPaykitAccountClaimed.mockReset().mockRejectedValue(LOCKS_UNREADABLE);
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

describe('MarketplaceGetPaidSettings Lock Server step', () => {
  it('asks a new upstream seller only for Bitkit when the service reports no Paykit account', async () => {
    await renderSettings();

    expect(screen.queryByRole('button', { name: /Connect Lock Server/ })).not.toBeInTheDocument();
    expect(screen.getByText('1. Connect Bitkit')).toBeInTheDocument();
    expect(screen.getByText('2. Accept bitcoin')).toBeInTheDocument();
    expect(screen.getByTestId('payment-method-status-bitcoin')).toHaveTextContent('Not set up');
    expect(screen.getByTestId('bitcoin-toggle-blocker')).toHaveTextContent('Connect Bitkit first.');
  });

  it('shows Bitcoin connected without any Lock Server session once the service reports the Paykit account', async () => {
    mocked.getMyPaymentConfig.mockResolvedValue(withBitcoinOff(USDT_SELLER_CONFIG_RECONNECT_WIRE));
    await renderSettings();

    await waitFor(() => expect(screen.getByTestId('payment-method-status-bitcoin')).toHaveTextContent('Connected'));
    expect(screen.queryByRole('button', { name: /Connect Lock Server/ })).not.toBeInTheDocument();
    expect(screen.getByText('Wallet connected.')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Accept bitcoin' })).toBeEnabled();
    expect(screen.queryByTestId('bitcoin-toggle-blocker')).not.toBeInTheDocument();
  });

  it('confirms a Bitkit setup from the fresh own config, with no Lock Server step', async () => {
    const user = userEvent.setup();
    await renderSettings();

    await user.click(screen.getByRole('button', { name: /Connect Bitkit/ }));
    mocked.getMyPaymentConfig.mockResolvedValue(withBitcoinOff(USDT_SELLER_CONFIG_READY_WIRE));
    sendSetupCallback();

    await waitFor(() => expect(mockedToast).toHaveBeenCalledWith({ title: 'Bitkit setup connected' }));
    expect(screen.queryByTitle('Connect Bitkit')).not.toBeInTheDocument();
    expect(screen.getByTestId('payment-method-status-bitcoin')).toHaveTextContent('Connected');
    expect(screen.queryByRole('button', { name: /Connect Lock Server/ })).not.toBeInTheDocument();
  });

  it('keeps the Lock Server step upstream when the service cannot report Paykit setup', async () => {
    mocked.fetchUsdtPaymentsAvailable.mockResolvedValue(false);
    mocked.getMyPaymentConfig.mockResolvedValue(withBitcoinOff(USDT_SELLER_CONFIG_FLAG_OFF_WIRE));
    await renderSettings();

    expect(await screen.findByRole('button', { name: /Connect Lock Server/ })).toBeInTheDocument();
    expect(screen.getByText('1. Connect Lock Server')).toBeInTheDocument();
    expect(screen.getByText('2. Connect Bitkit')).toBeInTheDocument();
    expect(screen.getByText('3. Accept bitcoin')).toBeInTheDocument();
  });

  it('keeps the Lock Server step on fork Paykit', async () => {
    runtime.api = 'fork';
    mocked.isOwnPaykitAccountClaimed.mockResolvedValue(false);
    mocked.getMyPaymentConfig.mockResolvedValue(withBitcoinOff(USDT_SELLER_CONFIG_RECONNECT_WIRE));
    await renderSettings();

    expect(screen.getByRole('button', { name: /Connect Lock Server/ })).toBeInTheDocument();
    expect(screen.getByText('2. Connect Bitkit')).toBeInTheDocument();
  });

  it('shows one Enable selling prompt and no Lock Server step before selling is enabled', async () => {
    useCommerceStore.setState({ marketplaceSession: null });
    render(<MarketplaceGetPaidSettings locksConnect={locksConnect} />);

    expect(await screen.findByTestId('enable-selling-card')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Enable selling' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /Connect Lock Server/ })).not.toBeInTheDocument();
    expect(screen.getByText('1. Connect Bitkit')).toBeInTheDocument();
  });
});
