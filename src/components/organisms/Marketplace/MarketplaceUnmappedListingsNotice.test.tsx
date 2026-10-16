import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MarketplaceUnmappedListingsNotice } from './MarketplaceUnmappedListingsNotice';

const SELLER = 'y'.repeat(52);

const notice = {
  connectionId: 'c1',
  domain: 'dezentralshop.ch',
  listings: [
    { listingId: 'boots_01', mappingsRemoved: 2 },
    { listingId: '../odd', mappingsRemoved: 1 },
  ],
};

describe('MarketplaceUnmappedListingsNotice', () => {
  it('says the listings are no longer linked and links each one', () => {
    render(<MarketplaceUnmappedListingsNotice notice={notice} sellerPubky={SELLER} onDismiss={vi.fn()} />);

    const box = screen.getByTestId('store-connections-unmapped');
    expect(box).toHaveTextContent(
      "These listings were combined, so they're no longer linked. Re-import them from the catalog or end them.",
    );
    expect(box).toHaveTextContent('dezentralshop.ch');
    expect(within(box).getByRole('link', { name: 'boots_01' })).toHaveAttribute(
      'href',
      `/marketplace/listing/${SELLER}/boots_01`,
    );
    expect(within(box).getByRole('link', { name: 'Open the catalog' })).toHaveAttribute(
      'href',
      '/marketplace/settings/store-connections/c1',
    );
  });

  it('shows an id that is not safe for a route as plain text, and links nothing without a signed-in seller', () => {
    const { rerender } = render(
      <MarketplaceUnmappedListingsNotice notice={notice} sellerPubky={SELLER} onDismiss={vi.fn()} />,
    );
    expect(screen.queryByRole('link', { name: '../odd' })).not.toBeInTheDocument();
    expect(screen.getByText('../odd')).toBeInTheDocument();

    rerender(<MarketplaceUnmappedListingsNotice notice={notice} sellerPubky={null} onDismiss={vi.fn()} />);
    expect(screen.queryByRole('link', { name: 'boots_01' })).not.toBeInTheDocument();
    expect(screen.getByText('boots_01')).toBeInTheDocument();
  });

  it('can be dismissed', async () => {
    const onDismiss = vi.fn();
    render(<MarketplaceUnmappedListingsNotice notice={notice} sellerPubky={SELLER} onDismiss={onDismiss} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
