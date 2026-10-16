import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import { useConnectionStatusCheck } from '@/hooks/useConnectionStatusCheck/useConnectionStatusCheck';
import { useConnectWooCommerce } from '@/hooks/useConnectWooCommerce/useConnectWooCommerce';
import { asOpaque } from '@/test-utils/type-assertions';
import { MarketplaceConnectWooCommerce } from './MarketplaceConnectWooCommerce';

vi.mock('@/controllers/connectors/connectors', () => ({
  ConnectorsController: {
    commitConnectWooCommerce: vi.fn(),
    commitConnectWooCommerceWithKeys: vi.fn(),
    fetchConnectionCheck: vi.fn(),
    fetchConnections: vi.fn(),
  },
}));

vi.mock('@/molecules/Toaster/use-toast', () => ({ toast: vi.fn() }));

function Flow({
  navigate,
  returnNotice,
}: {
  navigate?: (url: string) => void;
  returnNotice?: { approved: boolean } | null;
}) {
  const woo = useConnectWooCommerce({ ...(navigate ? { navigate } : {}) });
  const statusCheck = useConnectionStatusCheck();
  return (
    <MarketplaceConnectWooCommerce
      woo={woo}
      statusCheck={statusCheck}
      onCheck={() => void statusCheck.run({ provider: 'woocommerce', attempts: 1 })}
      returnNotice={returnNotice ?? null}
    />
  );
}

describe('MarketplaceConnectWooCommerce', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('asks for the store address and explains the approval', () => {
    render(<Flow />);
    const card = screen.getByTestId('connect-woocommerce');
    expect(card).toHaveTextContent('Connect your WooCommerce store');
    expect(card).toHaveTextContent('Pubky never sees your WordPress password');
    expect(card).toHaveTextContent('Pubky needs write to create orders in your store');
    expect(screen.getByRole('button', { name: 'Connect WooCommerce' })).toBeInTheDocument();
  });

  it('opens the store approval screen on one click', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    vi.mocked(ConnectorsController.commitConnectWooCommerce).mockResolvedValue(
      asOpaque({ connection: { id: 'c1' }, authorizeUrl: 'https://dezentralshop.ch/wc-auth/v1/authorize?x=1' }),
    );
    render(<Flow navigate={navigate} />);

    await user.type(
      within(screen.getByTestId('woo-one-click-form')).getByLabelText('Store address'),
      'dezentralshop.ch',
    );
    await user.click(screen.getByRole('button', { name: 'Connect WooCommerce' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('https://dezentralshop.ch/wc-auth/v1/authorize?x=1'));
  });

  it('refuses a plain http address in the form', async () => {
    const user = userEvent.setup();
    render(<Flow navigate={vi.fn()} />);

    await user.type(
      within(screen.getByTestId('woo-one-click-form')).getByLabelText('Store address'),
      'http://shop.example.com',
    );
    await user.click(screen.getByRole('button', { name: 'Connect WooCommerce' }));

    expect(
      await screen.findByText('WooCommerce connections need a secure address that starts with https://.'),
    ).toBeInTheDocument();
    expect(ConnectorsController.commitConnectWooCommerce).not.toHaveBeenCalled();
  });

  it('says nothing was connected when the seller declined on the store', () => {
    render(<Flow returnNotice={{ approved: false }} />);
    expect(screen.getByTestId('woo-declined')).toHaveTextContent('WooCommerce did not approve the connection');
  });

  it('keeps the REST key fallback behind a disclosure, in password fields', async () => {
    const user = userEvent.setup();
    render(<Flow />);
    expect(screen.queryByTestId('woo-keys-form')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Paste REST keys instead/ }));

    const form = await screen.findByTestId('woo-keys-form');
    expect(screen.getByTestId('collapsible-content')).toHaveTextContent('WooCommerce → Settings → Advanced → REST API');
    expect(within(form).getByLabelText('Consumer key')).toHaveAttribute('type', 'password');
    expect(within(form).getByLabelText('Consumer secret')).toHaveAttribute('type', 'password');
  });

  it('saves a pasted key pair once and clears the fields', async () => {
    const user = userEvent.setup();
    vi.mocked(ConnectorsController.commitConnectWooCommerceWithKeys).mockResolvedValue(asOpaque({ id: 'c2' }));
    render(<Flow />);
    await user.click(screen.getByRole('button', { name: /Paste REST keys instead/ }));
    const form = await screen.findByTestId('woo-keys-form');

    await user.type(within(form).getByLabelText('Store address'), 'dezentralshop.ch');
    await user.type(within(form).getByLabelText('Consumer key'), 'ck_0123456789abcdef');
    await user.type(within(form).getByLabelText('Consumer secret'), 'cs_0123456789abcdef');
    await user.click(within(form).getByRole('button', { name: 'Save keys' }));

    await waitFor(() => expect(ConnectorsController.commitConnectWooCommerceWithKeys).toHaveBeenCalledTimes(1));
    expect(ConnectorsController.commitConnectWooCommerceWithKeys).toHaveBeenCalledWith({
      address: 'dezentralshop.ch',
      consumerKey: 'ck_0123456789abcdef',
      consumerSecret: 'cs_0123456789abcdef',
    });
    await waitFor(() => expect(within(form).getByLabelText('Consumer secret')).toHaveValue(''));
    expect(document.body.innerHTML).not.toContain('cs_0123456789abcdef');
    expect(localStorage.length).toBe(0);
  });
});
