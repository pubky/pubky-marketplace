import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { namedPrivateSellerNotice, PRIVATE_SELLER_NOTICE, ROLE_STATEMENT } from '@/libs/commerce/eu-region';
import { PREORDER_COPY } from '@/libs/commerce/preorder';
import { CheckoutSaleTerms } from './CheckoutSaleTerms';

vi.mock('@/hooks/useMarketplaceSellerSummary/useMarketplaceSellerSummary', () => ({
  useMarketplaceSellerSummary: (pubky: string) => ({ displayName: `Shop ${pubky}` }),
}));

describe('CheckoutSaleTerms', () => {
  it('shows the role statement once and no private-seller notice when no seller is private', () => {
    render(<CheckoutSaleTerms sellerPubkys={['a']} declarations={{ a: 'trader' }} />);
    expect(screen.getAllByTestId('role-statement')).toHaveLength(1);
    expect(screen.getByTestId('role-statement')).toHaveTextContent(ROLE_STATEMENT);
    expect(screen.queryByTestId('private-seller-notice')).not.toBeInTheDocument();
  });

  it('shows the private-seller notice unnamed in a one-seller cart', () => {
    render(<CheckoutSaleTerms sellerPubkys={['a']} declarations={{ a: 'private' }} />);
    expect(screen.getByTestId('private-seller-notice')).toHaveTextContent(PRIVATE_SELLER_NOTICE);
    expect(screen.getByTestId('private-seller-notice').textContent).toBe(PRIVATE_SELLER_NOTICE);
  });

  it('shows the notice only for the private seller, by name, in a mixed cart', () => {
    render(
      <CheckoutSaleTerms sellerPubkys={['a', 'b', 'c']} declarations={{ a: 'trader', b: 'private', c: 'unknown' }} />,
    );
    const notices = screen.getAllByTestId('private-seller-notice');
    expect(notices).toHaveLength(1);
    expect(notices[0]?.textContent).toBe(namedPrivateSellerNotice('Shop b'));
    expect(screen.getAllByTestId('role-statement')).toHaveLength(1);
  });

  it('shows a notice for each private seller, each naming its seller', () => {
    render(<CheckoutSaleTerms sellerPubkys={['a', 'b']} declarations={{ a: 'private', b: 'private' }} />);
    const notices = screen.getAllByTestId('private-seller-notice');
    expect(notices.map((notice) => notice.textContent)).toEqual([
      namedPrivateSellerNotice('Shop a'),
      namedPrivateSellerNotice('Shop b'),
    ]);
  });

  it('names when a preorder ships and when it can be cancelled for a refund', () => {
    render(
      <CheckoutSaleTerms
        sellerPubkys={['a']}
        declarations={{ a: 'trader' }}
        preorders={[{ title: 'Boots', preorder: { shipsFrom: '2026-12-01', graceDays: 7 } }]}
      />,
    );
    expect(screen.getByTestId('checkout-preorder-terms').textContent).toBe(
      PREORDER_COPY.checkoutTerms({ shipsFrom: '2026-12-01', graceDays: 7 }),
    );
  });
});
