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

  it('shows counted item stars as a per-buyer mean once the index serves trust buckets', () => {
    const scoped = {
      orders: 4,
      buyers: 3,
      sumBuyerMeans: 13.8,
      weightedSum: 13.8,
      weightTotal: 3,
      histogram: [0, 0, 0, 2, 3] as [number, number, number, number, number],
      firstIat: 1_772_323_200,
      lastIat: 1_788_220_800,
      sellerBuyers: 2,
      sumSellerBuyerMeans: 9.4,
    };
    render(
      <MarketplaceSellerIdentity
        sellerPubky={'s'.repeat(52)}
        displayName="Satoshi Vintage"
        reputation={{
          status: 'rated',
          summary: {
            count: 8,
            verifiedCount: 7,
            avg: 2.5,
            histogram: [2, 1, 0, 2, 3],
            responseCount: 0,
            editedLateCount: 0,
            attestors: { [TEST_TRUSTED_ATTESTOR.pubky]: 5, ['x'.repeat(52)]: 2 },
            lastReviewedAt: null,
            buckets: { [TEST_TRUSTED_ATTESTOR.pubky]: scoped },
            scoped,
          },
        }}
      />,
    );

    expect(screen.getByRole('img', { name: 'Rated 4.6 out of 5 from 3 buyers, 4 orders' })).toBeVisible();
    expect(screen.queryByText(/reviews/)).not.toBeInTheDocument();
  });

  it('shows "No rating yet" when the index serves buckets but none is trusted', () => {
    render(
      <MarketplaceSellerIdentity
        sellerPubky={'s'.repeat(52)}
        displayName="Satoshi Vintage"
        reputation={{
          status: 'rated',
          summary: {
            count: 2,
            verifiedCount: 2,
            avg: 5,
            histogram: [0, 0, 0, 0, 2],
            responseCount: 0,
            editedLateCount: 0,
            attestors: { ['x'.repeat(52)]: 2 },
            lastReviewedAt: null,
            buckets: {},
          },
        }}
      />,
    );

    expect(screen.getByText('No rating yet')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
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
