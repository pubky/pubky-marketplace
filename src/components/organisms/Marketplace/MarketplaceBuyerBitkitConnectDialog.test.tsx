import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceBuyerBitkitConnectDialog } from './MarketplaceBuyerBitkitConnectDialog';

const copy = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useCopyToClipboard/useCopyToClipboard', () => ({
  useCopyToClipboard: () => ({ copyToClipboard: copy }),
}));

const props = {
  open: true,
  buyerPubky: 'b'.repeat(52),
  state: 'not_payable' as const,
  canPayWithPaypal: true,
  onOpenChange: vi.fn(),
  onRecheck: vi.fn(),
};

describe('MarketplaceBuyerBitkitConnectDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('guides the buyer to their existing account and copies its full key', async () => {
    const user = userEvent.setup();
    render(<MarketplaceBuyerBitkitConnectDialog {...props} />);
    const dialog = screen.getByRole('dialog', { name: 'Connect Bitkit' });
    expect(within(dialog).getByText('Open Bitkit on your phone and tap your profile.')).toBeVisible();
    expect(within(dialog).getByText(/Pubky Ring on the same phone/)).toBeVisible();
    expect(within(dialog).getByTestId('buyer-bitkit-account')).toHaveTextContent(props.buyerPubky);
    expect(within(dialog).getByRole('link', { name: 'Download Bitkit on the App Store' })).toHaveAttribute(
      'href',
      'https://get.bitkit.to/iOS',
    );
    expect(within(dialog).getByRole('link', { name: 'Get Bitkit on Google Play' })).toHaveAttribute(
      'href',
      'https://get.bitkit.to/PlayStore',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Copy pubky' }));
    expect(copy).toHaveBeenCalledWith(props.buyerPubky);
    await user.click(within(dialog).getByRole('button', { name: 'Check connection' }));
    expect(props.onRecheck).toHaveBeenCalledTimes(1);
    expect(props.onOpenChange).not.toHaveBeenCalled();
  });

  it('disables repeated checks while the read is in flight', () => {
    render(<MarketplaceBuyerBitkitConnectDialog {...props} state="checking" />);
    expect(screen.getByRole('status')).toHaveTextContent('Checking connection…');
    expect(screen.getByRole('button', { name: 'Check connection' })).toBeDisabled();
  });

  it('closes with the shared dialog close button without checking or paying', async () => {
    const user = userEvent.setup();
    render(<MarketplaceBuyerBitkitConnectDialog {...props} />);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(props.onRecheck).not.toHaveBeenCalled();
  });

  it.each(['unverified', 'unknown'] as const)('does not treat %s as a connection', (state) => {
    render(<MarketplaceBuyerBitkitConnectDialog {...props} state={state} />);
    expect(screen.getByRole('status')).toHaveTextContent('Couldn’t check the connection. Try again.');
    expect(screen.queryByRole('button', { name: 'Continue checkout' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check connection' })).toBeEnabled();
  });

  it('offers Continue only when the wallet is verified, without making a payment', async () => {
    const user = userEvent.setup();
    render(<MarketplaceBuyerBitkitConnectDialog {...props} state="payable" />);
    expect(screen.getByRole('status')).toHaveTextContent('Bitkit is connected.');
    expect(screen.queryByRole('button', { name: 'Check connection' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue checkout' }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(props.onRecheck).not.toHaveBeenCalled();
  });

  it('explains server incompatibility without claiming connection succeeded', () => {
    render(<MarketplaceBuyerBitkitConnectDialog {...props} state="unsupported" />);
    expect(screen.getByRole('status')).toHaveTextContent('Bitcoin checkout does not support Bitkit 2.6 yet');
    expect(screen.queryByRole('button', { name: 'Continue checkout' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to checkout' })).toBeEnabled();
  });
});
