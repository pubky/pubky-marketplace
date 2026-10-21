import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TEST_TRUSTED_ATTESTOR } from '@/test/fixtures/commerce/trusted-attestors';
import { MarketplaceSellerIdentity } from './MarketplaceSellerIdentity';

describe('MarketplaceSellerIdentity', () => {
  it('does not render a shop-opened tenure line', () => {
    render(
      <MarketplaceSellerIdentity
        sellerPubky={'s'.repeat(52)}
        displayName="Satoshi Vintage"
        reputation={{ status: 'new_seller' }}
      />,
    );

    expect(screen.queryByText('Sold by')).not.toBeInTheDocument();
    expect(screen.getByText('Satoshi Vintage')).toBeInTheDocument();
    expect(screen.queryByText(/Shop opened/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Seller-stated/)).not.toBeInTheDocument();
  });

  it('counts only reviews from trusted attestors as verified purchases', () => {
    render(
      <MarketplaceSellerIdentity
        sellerPubky={'s'.repeat(52)}
        displayName="Satoshi Vintage"
        reputation={{
          status: 'rated',
          summary: {
            count: 8,
            verifiedCount: 7,
            avg: 4.2,
            histogram: [0, 1, 1, 2, 4],
            responseCount: 0,
            editedLateCount: 0,
            attestors: { [TEST_TRUSTED_ATTESTOR.pubky]: 3, ['x'.repeat(52)]: 4 },
            lastReviewedAt: null,
          },
        }}
      />,
    );

    expect(screen.getByRole('img', { name: 'Rated 4.2 out of 5 from 8 reviews, 3 verified purchases' })).toBeVisible();
  });

  it('preserves the full seller name in the owner card layout contract', () => {
    render(
      <div className="w-40">
        <MarketplaceSellerIdentity
          sellerPubky={'s'.repeat(52)}
          displayName="Northwind Vintage Goods"
          reputation={{ status: 'new_seller' }}
        />
      </div>,
    );

    const identity = screen.getByText('Northwind Vintage Goods').closest('div')?.parentElement;
    expect(identity).toHaveClass('min-w-0');
    expect(identity).not.toHaveClass('shrink-0');
    expect(screen.getByText('Northwind Vintage Goods')).toHaveClass('break-words');
  });
});
