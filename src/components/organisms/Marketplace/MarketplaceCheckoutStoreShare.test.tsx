import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectorShareChoice } from '@/application/commerce/commerce';
import { MarketplaceCheckoutStoreShare } from './MarketplaceCheckoutStoreShare';

const SELLER = 's'.repeat(52);
const STORES = new Map<string, ConnectorShareChoice>([
  [SELLER, { sellerPubky: SELLER, shopDomain: 'dezentralshop.ch', keyId: 'k', publicKey: new Uint8Array(32) }],
]);

describe('MarketplaceCheckoutStoreShare', () => {
  it('renders nothing for a checkout with no connected store', () => {
    const { container } = render(
      <MarketplaceCheckoutStoreShare stores={new Map()} chosen={new Set()} onChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('offers an unticked checkbox that names the store', () => {
    render(<MarketplaceCheckoutStoreShare stores={STORES} chosen={new Set()} onChange={vi.fn()} />);
    const box = screen.getByRole('checkbox', {
      name: 'Share my shipping address with dezentralshop.ch to fulfil this order',
    });
    expect(box).not.toBeChecked();
  });

  it('reports the buyer choice, and shows a ticked box when chosen', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <MarketplaceCheckoutStoreShare stores={STORES} chosen={new Set()} onChange={onChange} />,
    );
    await userEvent.setup().click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(SELLER, true);

    rerender(<MarketplaceCheckoutStoreShare stores={STORES} chosen={new Set([SELLER])} onChange={onChange} />);
    expect(screen.getByRole('checkbox')).toBeChecked();
  });
});
