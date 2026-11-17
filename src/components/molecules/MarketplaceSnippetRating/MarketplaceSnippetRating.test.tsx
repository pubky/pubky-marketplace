import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CommerceReputationBucket } from '@/models/commerce/commerce.schema';
import { TEST_TRUSTED_ATTESTOR } from '@/test/fixtures/commerce/trusted-attestors';
import { MarketplaceSnippetRating } from './MarketplaceSnippetRating';

const seconds = (iso: string) => Date.parse(iso) / 1000;

function bucket(overrides: Partial<CommerceReputationBucket> = {}): CommerceReputationBucket {
  return {
    orders: 4,
    buyers: 3,
    sumBuyerMeans: 13.8,
    weightedSum: 18,
    weightTotal: 4,
    histogram: [0, 0, 0, 2, 2],
    firstIat: seconds('2026-08-01T00:00:00Z'),
    lastIat: seconds('2026-08-10T00:00:00Z'),
    sellerBuyers: null,
    sumSellerBuyerMeans: null,
    ...overrides,
  };
}

describe('MarketplaceSnippetRating', () => {
  it('keeps the index stars and count for a snippet without trust buckets', () => {
    render(<MarketplaceSnippetRating snippet={{ avg: 4.8, count: 23, verifiedCount: 19 }} />);

    expect(screen.getByRole('img', { name: 'Rated 4.8 out of 5 from 23 reviews' })).toBeInTheDocument();
    expect(screen.queryByText(/buyers/)).not.toBeInTheDocument();
  });

  it('shows the per-buyer mean of trusted buckets with its basis', () => {
    render(
      <MarketplaceSnippetRating
        snippet={{ avg: 3.9, count: 5, verifiedCount: 5, buckets: { [TEST_TRUSTED_ATTESTOR.pubky]: bucket() } }}
      />,
    );

    expect(screen.getByLabelText('Rated 4.6 out of 5 from 3 buyers, 4 orders')).toBeInTheDocument();
    expect(screen.getByText('3 buyers · 4 orders')).toBeInTheDocument();
  });

  it("prefers the read's exact scoped figure", () => {
    render(
      <MarketplaceSnippetRating
        snippet={{
          avg: 3.9,
          count: 5,
          verifiedCount: 5,
          buckets: { [TEST_TRUSTED_ATTESTOR.pubky]: bucket() },
          scoped: bucket({ buyers: 1, orders: 1, sumBuyerMeans: 4 }),
        }}
      />,
    );

    expect(screen.getByText('1 buyer · 1 order')).toBeInTheDocument();
  });

  it('says "No rating yet" when the trust window cuts every bucket', () => {
    render(
      <MarketplaceSnippetRating
        snippet={{
          avg: 4.8,
          count: 5,
          verifiedCount: 5,
          buckets: { [TEST_TRUSTED_ATTESTOR.pubky]: bucket({ firstIat: seconds('2025-12-20T00:00:00Z') }) },
        }}
        emptyClassName="text-sm"
      />,
    );

    expect(screen.getByText('No rating yet')).toHaveClass('text-sm');
    expect(screen.queryByText('4.8')).not.toBeInTheDocument();
  });
});
