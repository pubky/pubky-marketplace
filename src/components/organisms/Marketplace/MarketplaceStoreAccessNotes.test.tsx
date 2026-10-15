import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarketplaceStoreAccessNotes } from './MarketplaceStoreAccessNotes';

describe('MarketplaceStoreAccessNotes', () => {
  it('uses the approved Shopify wording', () => {
    render(<MarketplaceStoreAccessNotes provider="shopify" />);
    const notes = screen.getByTestId('store-access-notes');

    expect(screen.getByText('What Pubky can do with this connection')).toBeInTheDocument();
    expect(notes).toHaveTextContent(
      'Read your products, stock and locations, so you can choose what to list on Pubky and keep stock in sync.',
    );
    expect(notes).toHaveTextContent(
      'Create an order in your Shopify store when someone buys on Pubky. It arrives already paid, your stock goes down, and your usual fulfilment runs.',
    );
    expect(notes).toHaveTextContent('Read fulfilments, so tracking reaches the buyer.');
    expect(notes).toHaveTextContent('Pubky never takes payments through Shopify, and refunds go back through Pubky.');
    expect(notes).toHaveTextContent(
      "Buyers can choose at checkout to share their shipping address with your store. If they don't, the order arrives without it, and you copy the address from your Pubky orders.",
    );
    expect(notes).toHaveTextContent(
      "Disconnect removes Pubky's access straight away. Also uninstall the app in Shopify to revoke it there.",
    );
  });

  it('names WooCommerce and where its key is revoked', () => {
    render(<MarketplaceStoreAccessNotes provider="woocommerce" />);
    const notes = screen.getByTestId('store-access-notes');
    expect(notes).toHaveTextContent('Create an order in your WooCommerce store');
    expect(notes).toHaveTextContent('Pubky never takes payments through WooCommerce');
    expect(notes).toHaveTextContent('delete the key in WooCommerce under Settings, Advanced, REST API');
    expect(notes).not.toHaveTextContent('Shopify');
  });

  it('has the four sections the seller looks for', () => {
    render(<MarketplaceStoreAccessNotes provider="woocommerce" />);
    for (const heading of [
      'What Pubky can do with this connection',
      'What happens on a sale',
      'Buyer addresses',
      'Disconnect',
    ]) {
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    }
  });
});
