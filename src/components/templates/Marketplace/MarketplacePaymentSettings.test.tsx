import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import type { SellerPaymentConfigOwnView } from '@/libs/commerce/payment-methods';
import { toast } from '@/molecules/Toaster/use-toast';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useCommerceStore } from '@/stores/commerce/commerce.store';
import { setSocialHost } from '@/test-utils/social-host';
import { MarketplacePaymentSettings } from './MarketplacePaymentSettings';

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push }),
  usePathname: () => '/marketplace/settings',
  useSearchParams: () => navigation.searchParams,
}));

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    getSellerPaymentConfig: vi.fn(),
    getPaykitSetupUrl: vi.fn((returnTo: string, state: string, creator: string) => {
      const url = new URL('https://paykit.example/setup');
      url.searchParams.set('return_to', returnTo);
      url.searchParams.set('state', state);
      url.searchParams.set('creator', creator);
      return url.toString();
    }),
    getPaykitReconnectUrl: vi.fn((returnTo: string, state: string, creator: string) => {
      const url = new URL('https://paykit.example/setup/reconnect');
      url.searchParams.set('creator', creator);
      url.searchParams.set('return_to', returnTo);
      url.searchParams.set('state', state);
      return url.toString();
    }),
    fetchUsdtPaymentsAvailable: vi.fn(),
    getMyPaymentConfig: vi.fn(),
    putMyPaymentConfig: vi.fn(),
    beginMarketplaceSessionConnect: vi.fn(),
    hasFullHomeserverGrant: vi.fn(() => false),
  },
}));

vi.mock('@/organisms/Marketplace/MarketplaceSectionNav', () => ({
  MarketplaceSectionNav: () => <nav aria-label="Marketplace sections" />,
}));

vi.mock('@/molecules/Toaster/use-toast', () => ({
  toast: vi.fn(),
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/organisms/ContentLayout/ContentLayout', () => ({
  ContentLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

const mockedController = vi.mocked(CommerceController);
const mockedToast = vi.mocked(toast);

const EMPTY_CONFIG: SellerPaymentConfigOwnView = {
  bitcoinEnabled: false,
  bitcoinSetup: 'setup_required',
  paypalMerchantEmail: null,
  updatedAt: '2026-08-22T12:00:00.000Z',
};

beforeEach(() => {
  vi.useRealTimers();
  mockedToast.mockReset();
  sessionStorage.clear();
  navigation.push.mockReset();
  navigation.searchParams = new URLSearchParams();
  mockedController.getSellerPaymentConfig.mockReset().mockResolvedValue({
    bitcoinAvailable: false,
    bitcoinOfferAvailable: true,
    paypalAvailable: false,
  });
  mockedController.fetchUsdtPaymentsAvailable.mockReset().mockResolvedValue(false);
  mockedController.getMyPaymentConfig.mockReset().mockResolvedValue(EMPTY_CONFIG);
  mockedController.putMyPaymentConfig.mockReset().mockImplementation(async (input) => ({
    bitcoinEnabled: input.bitcoinEnabled,
    paypalMerchantEmail: input.paypalMerchantEmail,
    updatedAt: '2026-08-22T12:30:00.000Z',
  }));
  // A marketplace session makes the stored-rail forms render; the page is the
  // seller's own settings, never a guest surface.
  useCommerceStore.setState({
    marketplaceSession: {
      pubky: 'gy1wnkhfwezwdnawnur1bc3kw1x3jf5ggjj3cm37e31i5ntq3pco',
      capabilities: '/pub/pubky.app/:rw',
      issuedAt: '2026-08-21T12:00:00.000Z',
      expiresAt: '2026-09-21T12:00:00.000Z',
    },
  });
  useAuthStore.setState({ currentUserPubky: 'gy1wnkhfwezwdnawnur1bc3kw1x3jf5ggjj3cm37e31i5ntq3pco' });
});

afterEach(() => {
  vi.useRealTimers();
});

async function renderSettings() {
  render(<MarketplacePaymentSettings />);
  await screen.findByLabelText('PayPal merchant email');
}

const MISMATCH_MESSAGE =
  "Bitkit approved a different pubky than the one you're signed in with here (gy1wnkh...tq3pco). In Bitkit, switch to that pubky, then try again.";

function setPaykitIframeSource(iframe: HTMLIFrameElement): WindowProxy {
  const source = {} as WindowProxy;
  Object.defineProperty(iframe, 'contentWindow', { configurable: true, value: source });
  return source;
}

describe('MarketplacePaymentSettings', () => {
  it('leads with how-you-get-paid setup copy, not a funds warning', async () => {
    await renderSettings();

    expect(screen.getByRole('heading', { name: 'Payment settings' })).toBeInTheDocument();
    expect(screen.getByText('Manage your payment methods and preferences.')).toBeInTheDocument();
    expect(screen.queryByText(/pays the seller directly/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/never holds funds/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/pre-production/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/this prototype/i)).not.toBeInTheDocument();
  });

  it('shows an enabled Bitcoin rail honestly and lets the seller turn it off without reconnecting', async () => {
    mockedController.getMyPaymentConfig.mockResolvedValue({ ...EMPTY_CONFIG, bitcoinEnabled: true });
    await renderSettings();
    const bitcoin = screen.getByRole('switch', { name: 'Accept bitcoin' });
    expect(bitcoin).toBeChecked();
    expect(bitcoin).toBeEnabled();
    await userEvent.click(bitcoin);
    await userEvent.click(screen.getAllByRole('button', { name: 'Save changes' })[0]);
    await waitFor(() =>
      expect(mockedController.putMyPaymentConfig).toHaveBeenCalledWith(
        expect.objectContaining({ bitcoinEnabled: false }),
      ),
    );
    expect(bitcoin).not.toBeChecked();
    expect(bitcoin).toBeDisabled();
  });

  it('renders PayPal and Bitcoin and does not show a card rail', async () => {
    await renderSettings();

    const methodsSection = screen.getByRole('region', { name: 'Payment methods' });
    const titles = within(methodsSection)
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent);
    expect(titles).toEqual(['PayPal', 'Bitcoin']);
    expect(screen.queryByText(/Stripe/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Stripe payment link')).not.toBeInTheDocument();
  });

  it('derives each status pill from the loaded configuration state', async () => {
    mockedController.getMyPaymentConfig.mockResolvedValue({
      ...EMPTY_CONFIG,
      bitcoinSetup: 'ready',
      paypalMerchantEmail: 'seller@example.com',
    });

    await renderSettings();

    expect(screen.getByTestId('payment-method-status-paypal')).toHaveTextContent('Email saved');
    expect(screen.queryByTestId('payment-method-status-stripe')).not.toBeInTheDocument();
    expect(screen.getByTestId('payment-method-status-bitcoin')).toHaveTextContent('Connected');
    expect(screen.getByText('Wallet connected.')).toBeInTheDocument();
    expect(screen.queryByTestId('payment-methods-ready-summary')).not.toBeInTheDocument();
  });

  it.each([
    ['setup_required', 'Not set up', '1. Connect Bitkit'],
    ['unavailable', 'Needs attention', '1. Bitkit wallet'],
    ['ready', 'Connected', '1. Connect Bitkit'],
  ] as const)('never shows a Lock Server step (bitcoin_setup %s)', async (bitcoinSetup, pill, step) => {
    mockedController.getMyPaymentConfig.mockResolvedValue({ ...EMPTY_CONFIG, bitcoinSetup });
    await renderSettings();

    expect(screen.getByTestId('payment-method-status-bitcoin')).toHaveTextContent(pill);
    expect(screen.queryByRole('button', { name: /Connect Lock Server/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Lock Server/)).not.toBeInTheDocument();
    expect(screen.getByText(step)).toBeInTheDocument();
    expect(screen.getByText('2. Accept bitcoin')).toBeInTheDocument();
  });

  describe('Bitkit state the service cannot check', () => {
    const unknownReads: [string, () => void][] = [
      [
        'bitcoin_setup unavailable',
        () => mockedController.getMyPaymentConfig.mockResolvedValue({ ...EMPTY_CONFIG, bitcoinSetup: 'unavailable' }),
      ],
      [
        'a service without bitcoin_setup',
        () => {
          const { bitcoinSetup: _omitted, ...withoutSetup } = EMPTY_CONFIG;
          mockedController.getMyPaymentConfig.mockResolvedValue(withoutSetup);
        },
      ],
      ['a failed read', () => mockedController.getMyPaymentConfig.mockRejectedValue(new Error('offline'))],
    ];

    it.each(unknownReads)(
      'says it cannot check Bitkit, never Not set up or Connect Bitkit (%s)',
      async (_, arrange) => {
        arrange();
        render(<MarketplacePaymentSettings />);

        const message = await screen.findByTestId('bitkit-setup-unknown');
        expect(message).toHaveTextContent("We can't check Bitkit right now.");
        expect(screen.getByTestId('payment-method-status-bitcoin')).toHaveTextContent('Needs attention');
        expect(screen.getByTestId('payment-method-status-bitcoin')).not.toHaveTextContent('Not set up');
        expect(screen.queryByText('1. Connect Bitkit')).not.toBeInTheDocument();
        expect(screen.queryByText(/Connect Bitkit first/)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Connect Bitkit|Reconnect Bitkit|Connect now/ })).toBeNull();
        expect(screen.getByRole('button', { name: /Check again/ })).toBeInTheDocument();
        expect(screen.getByRole('switch', { name: 'Accept bitcoin' })).toBeDisabled();
        expect(screen.getByRole('switch', { name: 'Accept bitcoin' })).toHaveAccessibleDescription(
          "We can't check Bitkit right now.",
        );
        expect(mockedController.getPaykitSetupUrl).not.toHaveBeenCalled();
        expect(mockedController.getPaykitReconnectUrl).not.toHaveBeenCalled();
      },
    );

    it('re-reads the payment config on Check again and keeps the message while it is still unavailable', async () => {
      mockedController.getMyPaymentConfig.mockResolvedValue({ ...EMPTY_CONFIG, bitcoinSetup: 'unavailable' });
      render(<MarketplacePaymentSettings />);
      await screen.findByTestId('bitkit-setup-unknown');
      expect(mockedController.getMyPaymentConfig).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole('button', { name: /Check again/ }));

      await waitFor(() => expect(mockedController.getMyPaymentConfig).toHaveBeenCalledTimes(2));
      expect(await screen.findByTestId('bitkit-setup-unknown')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Connect Bitkit/ })).toBeNull();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('shows Connected once Check again reads ready', async () => {
      mockedController.getMyPaymentConfig.mockResolvedValue({ ...EMPTY_CONFIG, bitcoinSetup: 'unavailable' });
      render(<MarketplacePaymentSettings />);
      await screen.findByTestId('bitkit-setup-unknown');
      mockedController.getMyPaymentConfig.mockResolvedValue({ ...EMPTY_CONFIG, bitcoinSetup: 'ready' });

      fireEvent.click(screen.getByRole('button', { name: /Check again/ }));

      await waitFor(() => expect(screen.getByRole('switch', { name: 'Accept bitcoin' })).toBeEnabled());
      expect(screen.getByTestId('payment-method-status-bitcoin')).toHaveTextContent('Connected');
      expect(screen.queryByTestId('bitkit-setup-unknown')).not.toBeInTheDocument();
    });

    it('shows Not set up with Connect Bitkit once Check again reads setup_required', async () => {
      mockedController.getMyPaymentConfig.mockResolvedValue({ ...EMPTY_CONFIG, bitcoinSetup: 'unavailable' });
      render(<MarketplacePaymentSettings />);
      await screen.findByTestId('bitkit-setup-unknown');
      mockedController.getMyPaymentConfig.mockResolvedValue(EMPTY_CONFIG);

      fireEvent.click(screen.getByRole('button', { name: /Check again/ }));

      expect(await screen.findByRole('button', { name: /Connect Bitkit/ })).toBeInTheDocument();
      expect(screen.getByTestId('payment-method-status-bitcoin')).toHaveTextContent('Not set up');
      expect(screen.getByTestId('bitcoin-toggle-blocker')).toHaveTextContent(/^Connect Bitkit first\./);
    });

    it('claims nothing while the first read is in flight', async () => {
      let release: (config: SellerPaymentConfigOwnView) => void = () => {};
      mockedController.getMyPaymentConfig.mockImplementation(
        () =>
          new Promise<SellerPaymentConfigOwnView>((resolve) => {
            release = resolve;
          }),
      );
      render(<MarketplacePaymentSettings />);

      expect(await screen.findByTestId('bitkit-setup-checking')).toBeInTheDocument();
      expect(screen.queryByTestId('payment-method-status-bitcoin')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Connect Bitkit/ })).toBeNull();

      await act(async () => release(EMPTY_CONFIG));
      expect(await screen.findByRole('button', { name: /Connect Bitkit/ })).toBeInTheDocument();
    });
  });

  it('shows Not set up on every pill for a new seller', async () => {
    await renderSettings();

    expect(screen.getByTestId('payment-method-status-paypal')).toHaveTextContent('Not set up');
    expect(screen.queryByTestId('payment-method-status-stripe')).not.toBeInTheDocument();
    expect(screen.getByTestId('payment-method-status-bitcoin')).toHaveTextContent('Not set up');
    expect(screen.queryByTestId('payment-methods-ready-summary')).not.toBeInTheDocument();
  });

  it('keeps the bitcoin protocol details collapsed until asked', async () => {
    const user = userEvent.setup();
    await renderSettings();

    const detailsToggle = screen.getByRole('button', { name: 'Technical details' });
    expect(detailsToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/shares a watch-only account with Paykit/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Lock Server:/)).not.toBeInTheDocument();

    await user.click(detailsToggle);

    expect(detailsToggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/shares a watch-only account with Paykit/)).toBeInTheDocument();
    expect(screen.getByText(/Connect Bitkit to finish wallet setup/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Account xpub')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Claim with signer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Locks Server' })).not.toBeInTheDocument();
  });

  it('keeps enabling Bitcoin disabled until Bitkit is connected', async () => {
    await renderSettings();

    const accept = screen.getByRole('switch', { name: 'Accept bitcoin' });
    expect(accept).toBeDisabled();
    expect(accept).not.toBeChecked();
    expect(screen.getByTestId('payment-method-status-bitcoin')).toHaveTextContent('Not set up');
  });

  describe('Accept bitcoin reason', () => {
    it('names Bitkit for a new seller and opens Bitkit setup', async () => {
      await renderSettings();

      const reason = screen.getByTestId('bitcoin-toggle-blocker');
      expect(reason).toHaveTextContent(/^Connect Bitkit first\./);
      expect(screen.getByRole('switch', { name: 'Accept bitcoin' })).toHaveAccessibleDescription(
        'Connect Bitkit first. Connect now',
      );
      fireEvent.click(within(reason).getByRole('button', { name: 'Connect now' }));
      expect(await screen.findByRole('dialog', { name: 'Connect Bitkit' })).toBeInTheDocument();
    });

    it('names nothing missing under the switch when the service cannot say', async () => {
      mockedController.getMyPaymentConfig.mockResolvedValue({ ...EMPTY_CONFIG, bitcoinSetup: 'unavailable' });
      await renderSettings();

      expect(screen.queryByTestId('bitcoin-toggle-blocker')).not.toBeInTheDocument();
      expect(screen.getByTestId('bitkit-setup-unknown')).toHaveTextContent("We can't check Bitkit right now.");
    });

    it('shows no reason once Bitkit is connected', async () => {
      mockedController.getMyPaymentConfig.mockResolvedValue({ ...EMPTY_CONFIG, bitcoinSetup: 'ready' });
      await renderSettings();

      expect(screen.getByRole('switch', { name: 'Accept bitcoin' })).toBeEnabled();
      expect(screen.queryByTestId('bitcoin-toggle-blocker')).not.toBeInTheDocument();
    });

    it('leaves the reason to the Enable selling prompt without a marketplace session', async () => {
      useCommerceStore.setState({ marketplaceSession: null });
      render(<MarketplacePaymentSettings />);

      expect(await screen.findAllByText('Enable selling to save your payment methods.')).not.toHaveLength(0);
      expect(screen.getByRole('switch', { name: 'Accept bitcoin' })).toBeDisabled();
      expect(screen.queryByTestId('bitcoin-toggle-blocker')).not.toBeInTheDocument();
    });
  });

  describe('PayPal email validation', () => {
    it('refuses an invalid email inline and keeps Save disabled until it is fixed', async () => {
      const user = userEvent.setup();
      await renderSettings();
      const save = screen.getAllByRole('button', { name: 'Save changes' })[0];
      await waitFor(() => expect(save).toBeEnabled());

      const email = screen.getByLabelText('PayPal merchant email');
      await user.type(email, 'test');
      expect(save).toBeDisabled();
      expect(screen.queryByText('Enter a valid email address.')).not.toBeInTheDocument();

      await user.tab();
      expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email address.');
      expect(email).toHaveAttribute('aria-invalid', 'true');
      expect(email).toHaveAccessibleDescription('Enter a valid email address.');
      for (const button of screen.getAllByRole('button', { name: 'Save changes' })) {
        expect(button).toBeDisabled();
      }

      await user.type(email, '@example.com');
      expect(screen.queryByText('Enter a valid email address.')).not.toBeInTheDocument();
      expect(email).not.toHaveAttribute('aria-invalid');
      await user.click(save);

      await waitFor(() => expect(mockedController.putMyPaymentConfig).toHaveBeenCalledTimes(1));
      expect(mockedController.putMyPaymentConfig).toHaveBeenLastCalledWith({
        bitcoinEnabled: false,
        paypalMerchantEmail: 'test@example.com',
      });
    });

    it('lets the seller clear a saved email', async () => {
      const user = userEvent.setup();
      mockedController.getMyPaymentConfig.mockResolvedValue({
        ...EMPTY_CONFIG,
        paypalMerchantEmail: 'old@example.com',
      });
      await renderSettings();
      const save = screen.getAllByRole('button', { name: 'Save changes' })[0];
      await waitFor(() => expect(save).toBeEnabled());

      await user.clear(screen.getByLabelText('PayPal merchant email'));
      await user.click(save);

      await waitFor(() => expect(mockedController.putMyPaymentConfig).toHaveBeenCalledTimes(1));
      expect(mockedController.putMyPaymentConfig).toHaveBeenLastCalledWith({
        bitcoinEnabled: false,
        paypalMerchantEmail: null,
      });
    });
  });

  it('saves PayPal for a seller whose stored payment config is null', async () => {
    const user = userEvent.setup();
    mockedController.getMyPaymentConfig.mockResolvedValue(null);

    await renderSettings();
    const save = screen.getAllByRole('button', { name: 'Save changes' })[0];
    await waitFor(() => expect(save).toBeEnabled());

    await user.type(screen.getByLabelText('PayPal merchant email'), 'new-seller@example.com');
    await user.click(save);

    await waitFor(() => expect(mockedController.putMyPaymentConfig).toHaveBeenCalledTimes(1));
    expect(mockedController.putMyPaymentConfig).toHaveBeenLastCalledWith({
      bitcoinEnabled: false,
      paypalMerchantEmail: 'new-seller@example.com',
    });
  });

  it('keeps stored bitcoin when an existing config PayPal email changes', async () => {
    const user = userEvent.setup();
    mockedController.getMyPaymentConfig.mockResolvedValue({
      ...EMPTY_CONFIG,
      bitcoinEnabled: true,
      paypalMerchantEmail: 'old@example.com',
    });

    await renderSettings();
    const save = screen.getAllByRole('button', { name: 'Save changes' })[0];
    await waitFor(() => expect(save).toBeEnabled());

    const email = screen.getByLabelText('PayPal merchant email');
    await user.clear(email);
    await user.type(email, 'updated@example.com');
    await user.click(save);

    await waitFor(() => expect(mockedController.putMyPaymentConfig).toHaveBeenCalledTimes(1));
    expect(mockedController.putMyPaymentConfig).toHaveBeenLastCalledWith({
      bitcoinEnabled: true,
      paypalMerchantEmail: 'updated@example.com',
    });
  });

  it('saves PayPal without any card fields', async () => {
    const user = userEvent.setup();
    await renderSettings();

    await user.type(screen.getByLabelText('PayPal merchant email'), 'seller@example.com');
    expect(screen.getByRole('switch', { name: 'Accept bitcoin' })).toBeDisabled();

    await user.click(screen.getAllByRole('button', { name: 'Save changes' })[0]);

    await waitFor(() => expect(mockedController.putMyPaymentConfig).toHaveBeenCalledTimes(1));
    expect(mockedController.putMyPaymentConfig).toHaveBeenLastCalledWith({
      bitcoinEnabled: false,
      paypalMerchantEmail: 'seller@example.com',
    });
  });

  it('saves Accept bitcoin once Bitkit is connected', async () => {
    const user = userEvent.setup();
    mockedController.getMyPaymentConfig.mockResolvedValue({ ...EMPTY_CONFIG, bitcoinSetup: 'ready' });

    await renderSettings();

    const accept = screen.getByRole('switch', { name: 'Accept bitcoin' });
    expect(accept).toBeEnabled();
    await user.click(accept);
    await user.click(screen.getAllByRole('button', { name: 'Save changes' })[1]);

    await waitFor(() => expect(mockedController.putMyPaymentConfig).toHaveBeenCalled());
    expect(mockedController.putMyPaymentConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({ bitcoinEnabled: true }),
    );
  });

  // The pages inside the payout setup iframes hand off to pubkyring:// and pubkyauth:// links;
  // without these sandbox tokens a tap on Android Chrome does nothing.
  const HANDOFF_SANDBOX_TOKENS = ['allow-popups', 'allow-top-navigation-to-custom-protocols'];

  it('lets the Bitkit setup iframe open Bitkit', async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole('button', { name: /Connect Bitkit/ }));

    const sandbox = screen.getByTitle('Connect Bitkit').getAttribute('sandbox')?.split(' ') ?? [];
    expect(sandbox).toEqual(expect.arrayContaining(HANDOFF_SANDBOX_TOKENS));
  });

  it('does not offer a card rail to a seller whose service still stores one', async () => {
    const legacyConfig = {
      ...EMPTY_CONFIG,
      stripePaymentLink: 'https://buy.stripe.com/test_kept',
      stripeRestrictedKeySet: true,
    };
    mockedController.getMyPaymentConfig.mockResolvedValue(legacyConfig);

    await renderSettings();

    expect(screen.queryByText('Card via Stripe')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Stripe payment link')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Stripe restricted key')).not.toBeInTheDocument();
    expect(screen.queryByText(/Stripe/)).not.toBeInTheDocument();
  });

  it('explains the Bitkit connection and preserves the mobile handoff', async () => {
    await renderSettings();

    const helper = 'Approve payment setup in Bitkit to receive bitcoin.';
    expect(screen.getByText(helper)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Connect Bitkit/ }));
    expect(screen.getAllByText(helper)).toHaveLength(1);
    expect(screen.getByText('Scan the code with Bitkit')).toBeInTheDocument();
    expect(screen.getByText('Tap Open in Bitkit')).toBeInTheDocument();
    expect(screen.queryByText(/Bitkit 2\.5 or newer is required/)).not.toBeInTheDocument();
    const iframe = screen.getByTitle('Connect Bitkit');
    const dialog = iframe.closest('[data-testid="dialog-content"]');
    expect(dialog?.className).toMatch(/overflow-y-auto/);
    expect(dialog?.className).not.toMatch(/overflow-hidden/);
    expect(iframe.className).not.toMatch(/overflow-y-auto|overflow-auto|h-\[min\(22rem/);
    expect(iframe).not.toHaveAttribute('scrolling', 'no');
    expect(iframe).toHaveClass('h-[40rem]', 'w-full');
  });

  it('keeps Accept bitcoin as step 2 and shows one Enable selling prompt above the methods until enabled', async () => {
    const session = useCommerceStore.getState().marketplaceSession;
    useCommerceStore.setState({ marketplaceSession: null });
    render(<MarketplacePaymentSettings />);
    expect(screen.getByText('2. Accept bitcoin')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Accept bitcoin' })).toBeDisabled();
    expect(screen.queryByText('3. Enable selling')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Enable selling' })).toHaveLength(1);
    expect(screen.getByTestId('enable-selling-card')).toBeInTheDocument();

    act(() => useCommerceStore.setState({ marketplaceSession: session }));
    await screen.findByRole('switch', { name: 'Accept bitcoin' });
    expect(screen.getByText('2. Accept bitcoin')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enable selling' })).not.toBeInTheDocument();
  });

  it('validates the Bitkit setup callback', async () => {
    render(<MarketplacePaymentSettings />);
    expect(screen.getByRole('heading', { name: 'PayPal' })).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /Connect Bitkit/ }));

    expect(mockedController.getPaykitSetupUrl).toHaveBeenCalledTimes(1);
    const iframe = screen.getByTitle('Connect Bitkit') as HTMLIFrameElement;
    const setupUrl = new URL(iframe.getAttribute('src')!);
    const productionSetupUrl = String(mockedController.getPaykitSetupUrl.mock.results[0]?.value);
    expect(setupUrl.origin).toBe('https://paykit.example');
    expect(iframe.getAttribute('src')).toBe(`${productionSetupUrl}#embed`);
    expect(setupUrl.search).toBe(new URL(productionSetupUrl).search);
    expect(setupUrl.hash).toBe('#embed');
    expect(setupUrl.searchParams.has('embed')).toBe(false);
    const state = String(setupUrl.searchParams.get('state'));
    expect(setupUrl.searchParams.get('creator')).toBe('gy1wnkhfwezwdnawnur1bc3kw1x3jf5ggjj3cm37e31i5ntq3pco');
    expect(state).toHaveLength(22);
    const source = setPaykitIframeSource(iframe);
    mockedController.getMyPaymentConfig.mockResolvedValueOnce({ ...EMPTY_CONFIG, bitcoinSetup: 'ready' });

    const message = new MessageEvent('message', {
      origin: 'https://paykit.example',
      source,
      data: { type: 'paykit-setup-callback', state },
    });
    act(() => window.dispatchEvent(message));

    await waitFor(() => expect(screen.queryByTitle('Connect Bitkit')).not.toBeInTheDocument());
    expect(mockedToast).toHaveBeenCalledWith({ title: 'Bitkit setup connected' });
    await waitFor(() => expect(mockedController.getMyPaymentConfig).toHaveBeenCalledTimes(2));
  });

  it('unlocks Accept bitcoin as soon as the Bitkit step reports Connected', async () => {
    let releaseStaleRead: (config: SellerPaymentConfigOwnView) => void = () => {};
    mockedController.getMyPaymentConfig
      .mockReset()
      .mockResolvedValueOnce(EMPTY_CONFIG)
      .mockImplementationOnce(
        () =>
          new Promise<SellerPaymentConfigOwnView>((resolve) => {
            releaseStaleRead = resolve;
          }),
      )
      .mockResolvedValue({ ...EMPTY_CONFIG, bitcoinSetup: 'ready' });

    await renderSettings();
    expect(screen.getByRole('switch', { name: 'Accept bitcoin' })).toBeDisabled();
    expect(screen.getByTestId('payment-method-status-bitcoin')).toHaveTextContent('Not set up');

    await act(async () => {
      useCommerceStore.setState({
        marketplaceSession: {
          pubky: 'gy1wnkhfwezwdnawnur1bc3kw1x3jf5ggjj3cm37e31i5ntq3pco',
          capabilities: '/pub/pubky.app/:rw',
          issuedAt: '2026-08-21T12:00:00.000Z',
          expiresAt: '2026-09-21T12:00:00.000Z',
        },
      });
    });

    fireEvent.click(screen.getByRole('button', { name: /Connect Bitkit/ }));
    const iframe = screen.getByTitle('Connect Bitkit') as HTMLIFrameElement;
    const source = setPaykitIframeSource(iframe);
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

    await waitFor(() => expect(screen.getByRole('switch', { name: 'Accept bitcoin' })).toBeEnabled());
    expect(screen.getByTestId('payment-method-status-bitcoin')).toHaveTextContent('Connected');
    expect(mockedToast).toHaveBeenCalledWith({ title: 'Bitkit setup connected' });

    await act(async () => {
      releaseStaleRead(EMPTY_CONFIG);
    });
    expect(screen.getByRole('switch', { name: 'Accept bitcoin' })).toBeEnabled();
    expect(screen.getByTestId('payment-method-status-bitcoin')).toHaveTextContent('Connected');
  });

  it('shows the timeout state and retries with a fresh setup state', async () => {
    await renderSettings();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: /Connect Bitkit/ }));
    const firstState = new URL((screen.getByTitle('Connect Bitkit') as HTMLIFrameElement).src).searchParams.get(
      'state',
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6 * 60 * 1_000);
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      "No approval received. If you approved in Bitkit, check that Bitkit holds the pubky you're signed in with here (gy1wnkh...tq3pco)",
    );
    expect(screen.queryByTitle('Connect Bitkit')).not.toBeInTheDocument();
    expect(screen.getByTestId('paykit-setup-qr-expired')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    const secondState = new URL((screen.getByTitle('Connect Bitkit') as HTMLIFrameElement).src).searchParams.get(
      'state',
    );
    expect(secondState).not.toBe(firstState);
    vi.useRealTimers();
  });

  it('keeps the dialog open and shows an identity mismatch when verification is not claimed', async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole('button', { name: /Connect Bitkit/ }));
    const iframe = screen.getByTitle('Connect Bitkit') as HTMLIFrameElement;
    const source = setPaykitIframeSource(iframe);
    const state = new URL(iframe.src).searchParams.get('state');
    mockedController.getMyPaymentConfig.mockResolvedValueOnce(EMPTY_CONFIG);

    act(() =>
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://paykit.example',
          source,
          data: { type: 'paykit-setup-callback', state },
        }),
      ),
    );

    await waitFor(() => expect(screen.getByText(MISMATCH_MESSAGE)).toBeInTheDocument());
    expect(mockedToast).not.toHaveBeenCalled();
    expect(screen.getByTitle('Connect Bitkit')).toBeInTheDocument();
  });

  it('keeps the mismatch under the Bitkit step after the dialog closes and retries with a fresh setup state', async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole('button', { name: /Connect Bitkit/ }));
    const iframe = screen.getByTitle('Connect Bitkit') as HTMLIFrameElement;
    const source = setPaykitIframeSource(iframe);
    const firstState = new URL(iframe.src).searchParams.get('state');
    mockedController.getMyPaymentConfig.mockResolvedValueOnce(EMPTY_CONFIG);
    act(() =>
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://paykit.example',
          source,
          data: { type: 'paykit-setup-callback', state: firstState },
        }),
      ),
    );
    await screen.findByText(MISMATCH_MESSAGE);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTitle('Connect Bitkit')).not.toBeInTheDocument();
    expect(screen.getByTestId('paykit-setup-problem')).toHaveTextContent(MISMATCH_MESSAGE);
    expect(screen.getByTestId('paykit-setup-problem')).toHaveAttribute('role', 'alert');

    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    const secondState = new URL((screen.getByTitle('Connect Bitkit') as HTMLIFrameElement).src).searchParams.get(
      'state',
    );
    expect(secondState).not.toBe(firstState);
    expect(screen.queryByTestId('paykit-setup-problem')).not.toBeInTheDocument();
  });

  it('does not blame the key when the service cannot confirm the setup', async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole('button', { name: /Connect Bitkit/ }));
    const iframe = screen.getByTitle('Connect Bitkit') as HTMLIFrameElement;
    const source = setPaykitIframeSource(iframe);
    const state = new URL(iframe.src).searchParams.get('state');
    mockedController.getMyPaymentConfig.mockResolvedValueOnce({ ...EMPTY_CONFIG, bitcoinSetup: 'unavailable' });

    act(() =>
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://paykit.example',
          source,
          data: { type: 'paykit-setup-callback', state },
        }),
      ),
    );

    await screen.findByText("We couldn't confirm Bitkit's approval just now. Try again.");
    expect(screen.queryByText(/approved a different pubky/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('paykit-setup-problem')).toHaveTextContent(
      "We couldn't confirm Bitkit's approval just now.",
    );
  });

  it('maps identity mismatch separately from other setup errors', async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole('button', { name: /Connect Bitkit/ }));
    const iframe = screen.getByTitle('Connect Bitkit') as HTMLIFrameElement;
    const source = setPaykitIframeSource(iframe);
    const state = new URL(iframe.src).searchParams.get('state');

    act(() =>
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://paykit.example',
          source,
          data: { type: 'paykit-setup-callback', state, error: 'identity-mismatch' },
        }),
      ),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Bitkit approved a different pubky');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    const secondIframe = screen.getByTitle('Connect Bitkit') as HTMLIFrameElement;
    const secondSource = setPaykitIframeSource(secondIframe);
    const secondState = new URL(secondIframe.src).searchParams.get('state');
    act(() =>
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://paykit.example',
          source: secondSource,
          data: { type: 'paykit-setup-callback', state: secondState, error: 'setup-failed' },
        }),
      ),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Bitkit setup failed. Try again.');
  });

  it('closes the setup dialog when the viewer identity is cleared', async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole('button', { name: /Connect Bitkit/ }));
    const iframe = screen.getByTitle('Connect Bitkit') as HTMLIFrameElement;
    const source = setPaykitIframeSource(iframe);
    const state = new URL(iframe.src).searchParams.get('state');

    act(() => useAuthStore.setState({ currentUserPubky: null }));
    expect(screen.queryByTitle('Connect Bitkit')).not.toBeInTheDocument();

    act(() =>
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://paykit.example',
          source,
          data: { type: 'paykit-setup-callback', state },
        }),
      ),
    );
    expect(mockedToast).not.toHaveBeenCalled();
  });

  it('ignores callbacks that fail any message guard', async () => {
    const user = userEvent.setup();
    await renderSettings();
    await user.click(screen.getByRole('button', { name: /Connect Bitkit/ }));
    const iframe = screen.getByTitle('Connect Bitkit') as HTMLIFrameElement;
    const source = setPaykitIframeSource(iframe);
    const state = new URL(iframe.src).searchParams.get('state');
    const messages = [
      { origin: 'https://wrong.example', source, data: { type: 'paykit-setup-callback', state } },
      { origin: 'https://paykit.example', source: window, data: { type: 'paykit-setup-callback', state } },
      { origin: 'https://paykit.example', source, data: { type: 'other', state } },
      {
        origin: 'https://paykit.example',
        source,
        data: { type: 'paykit-setup-callback', state: 'wrong' },
      },
    ];
    act(() => {
      messages.forEach((message) => window.dispatchEvent(new MessageEvent('message', message)));
    });

    expect(screen.getByTitle('Connect Bitkit')).toBeInTheDocument();
    expect(mockedController.getMyPaymentConfig).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Bitkit setup connected')).not.toBeInTheDocument();
  });

  it('shows failure and retries with a new setup state', async () => {
    const user = userEvent.setup();
    await renderSettings();
    await user.click(screen.getByRole('button', { name: /Connect Bitkit/ }));
    const firstIframe = screen.getByTitle('Connect Bitkit') as HTMLIFrameElement;
    const firstState = String(new URL(firstIframe.src).searchParams.get('state'));
    const source = setPaykitIframeSource(firstIframe);
    const message = new MessageEvent('message', {
      origin: 'https://paykit.example',
      source,
      data: { type: 'paykit-setup-callback', state: firstState, error: 'setup-failed' },
    });
    act(() => window.dispatchEvent(message));

    expect(screen.getByRole('alert')).toHaveTextContent('Bitkit setup failed. Try again.');
    expect(screen.queryByTitle('Connect Bitkit')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    const secondIframe = screen.getByTitle('Connect Bitkit') as HTMLIFrameElement;
    expect(new URL(secondIframe.src).searchParams.get('state')).not.toBe(firstState);
  });

  it('removes the expired Bitkit QR so nothing is left to scan', async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole('button', { name: /Connect Bitkit/ }));
    const iframe = screen.getByTitle('Connect Bitkit') as HTMLIFrameElement;
    const source = setPaykitIframeSource(iframe);
    const state = new URL(iframe.src).searchParams.get('state');

    act(() =>
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://paykit.example',
          source,
          data: { type: 'paykit-setup-callback', state, error: 'setup-failed' },
        }),
      ),
    );

    const dialog = screen.getByTestId('dialog-content');
    expect(screen.getByRole('alert')).toHaveTextContent('Bitkit setup failed. Try again.');
    expect(within(dialog).queryByTitle('Connect Bitkit')).not.toBeInTheDocument();
    expect(dialog.querySelector('iframe, img, canvas')).toBeNull();
    const placeholder = screen.getByTestId('paykit-setup-qr-expired');
    expect(placeholder).toHaveTextContent('This code expired.');
    expect(placeholder.querySelector('iframe, img, canvas')).toBeNull();
  });

  it('removes the callback listener when the settings surface unmounts', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const user = userEvent.setup();
    const { unmount } = render(<MarketplacePaymentSettings />);
    await screen.findByRole('heading', { name: 'PayPal' });
    await user.click(screen.getByRole('button', { name: /Connect Bitkit/ }));
    unmount();
    expect(addSpy).toHaveBeenCalledWith('message', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('message', expect.any(Function));
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('keeps Save unavailable until the server payment config has loaded', async () => {
    mockedController.getMyPaymentConfig.mockReturnValue(new Promise(() => {}));
    render(<MarketplacePaymentSettings />);

    expect(await screen.findAllByText('Loading payment settings…')).toHaveLength(2);
    expect(document.querySelector('[data-surface="marketplace-get-paid"]')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });

  it('preserves server bitcoin when Accept bitcoin was not toggled', async () => {
    const user = userEvent.setup();
    mockedController.getMyPaymentConfig.mockResolvedValue({
      ...EMPTY_CONFIG,
      bitcoinEnabled: true,
      paypalMerchantEmail: 'kept@example.com',
    });

    await renderSettings();
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Save changes' })[1]).toBeEnabled());

    const accept = screen.getByRole('switch', { name: 'Accept bitcoin' });
    expect(accept).toBeEnabled();
    expect(accept).toBeChecked();

    await user.click(screen.getAllByRole('button', { name: 'Save changes' })[1]);

    await waitFor(() => expect(mockedController.putMyPaymentConfig).toHaveBeenCalledTimes(1));
    expect(mockedController.putMyPaymentConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({
        bitcoinEnabled: true,
        paypalMerchantEmail: 'kept@example.com',
      }),
    );
  });

  it('saves an explicit Accept bitcoin off after the seller toggles it', async () => {
    const user = userEvent.setup();
    mockedController.getMyPaymentConfig.mockResolvedValue({
      ...EMPTY_CONFIG,
      bitcoinEnabled: true,
      bitcoinSetup: 'ready',
    });

    await renderSettings();

    const accept = screen.getByRole('switch', { name: 'Accept bitcoin' });
    await waitFor(() => expect(accept).toBeEnabled());
    expect(accept).toBeChecked();
    await user.click(accept);
    expect(accept).not.toBeChecked();
    await user.click(screen.getAllByRole('button', { name: 'Save changes' })[1]);

    await waitFor(() => expect(mockedController.putMyPaymentConfig).toHaveBeenCalled());
    expect(mockedController.putMyPaymentConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({ bitcoinEnabled: false }),
    );
  });

  it('never sends Stripe fields, even when the service still stores a link', async () => {
    const user = userEvent.setup();
    const legacyConfig = { ...EMPTY_CONFIG, stripePaymentLink: 'https://buy.stripe.com/test_keep' };
    mockedController.getMyPaymentConfig.mockResolvedValue(legacyConfig);

    await renderSettings();
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Save changes' })[0]).toBeEnabled());
    expect(screen.queryByLabelText('Stripe payment link')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('PayPal merchant email'), 'seller@example.com');
    await user.click(screen.getAllByRole('button', { name: 'Save changes' })[0]);

    await waitFor(() => expect(mockedController.putMyPaymentConfig).toHaveBeenCalledTimes(1));
    const sent = mockedController.putMyPaymentConfig.mock.calls[0]?.[0];
    expect(sent).toStrictEqual({ bitcoinEnabled: false, paypalMerchantEmail: 'seller@example.com' });
  });

  it('does not offer Claim with signer', async () => {
    const user = userEvent.setup();
    await renderSettings();

    await user.click(screen.getByRole('button', { name: 'Technical details' }));

    expect(screen.queryByRole('button', { name: 'Claim with signer' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Account xpub')).not.toBeInTheDocument();
    expect(screen.getByText(/Connect Bitkit to finish wallet setup/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Connect Bitkit/ })).toBeInTheDocument();
  });

  it('keeps a back link to the listing composer before setup', async () => {
    navigation.searchParams = new URLSearchParams('returnTo=/marketplace/sell');
    await renderSettings();

    expect(screen.getByRole('link', { name: /Back to listing/ })).toHaveAttribute('href', '/marketplace/sell');
    expect(screen.getByTestId('listing-composer-return')).toHaveTextContent('Back to listing');
  });

  it('returns to the listing composer after a payment method is saved', async () => {
    navigation.searchParams = new URLSearchParams('returnTo=/marketplace/sell');
    const user = userEvent.setup();
    await renderSettings();

    await user.type(screen.getByLabelText('PayPal merchant email'), 'seller@example.com');
    await user.click(screen.getAllByRole('button', { name: 'Save changes' })[0]);

    await waitFor(() => {
      expect(navigation.push).toHaveBeenCalledWith('/marketplace/sell');
    });
    expect(sessionStorage.getItem('pubky.marketplace.listingComposerReturnTo')).toBeNull();
  });

  it('leaves sign-out to account settings while social link-out is off', async () => {
    await renderSettings();

    expect(screen.queryByTestId('marketplace-sign-out-card')).not.toBeInTheDocument();
  });

  it('offers Shop sign-out while social link-out is on', async () => {
    setSocialHost('https://pubky.app');
    try {
      await renderSettings();

      const card = screen.getByTestId('marketplace-sign-out-card');
      expect(within(card).getByRole('button', { name: 'Sign out' })).toBeEnabled();
    } finally {
      setSocialHost(undefined);
    }
  });

  it('lets a buyer sign out without a marketplace purchase session or seller payment setup', () => {
    setSocialHost('https://pubky.app');
    useCommerceStore.setState({ marketplaceSession: null });
    try {
      render(<MarketplacePaymentSettings />);
      expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
    } finally {
      setSocialHost(undefined);
    }
  });
});
