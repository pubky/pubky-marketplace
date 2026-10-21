import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommerceSellerReputationOverview } from '@/application/commerce/commerce';
import { MARKETPLACE_TRUSTED_ATTESTORS } from '@/config/commerce';
import type { CommerceReputationSummary } from '@/models/commerce/commerce.schema';
import { MarketplaceReputationHeader } from './MarketplaceReputationHeader';

const reputation = vi.hoisted((): { value: CommerceSellerReputationOverview | { status: 'loading' } } => ({
  value: { status: 'loading' },
}));

vi.mock('@/hooks/useMarketplaceReviews/useMarketplaceReviews', () => ({
  useSellerReputation: () => reputation.value,
}));

const SELLER = 's'.repeat(52);
const UNKNOWN_ATTESTOR = 'x'.repeat(52);

function rated(overrides: Partial<CommerceReputationSummary>): CommerceSellerReputationOverview {
  return {
    status: 'rated',
    summary: {
      count: 6,
      verifiedCount: 5,
      avg: 4.5,
      histogram: [0, 0, 1, 1, 4],
      responseCount: 0,
      editedLateCount: 0,
      attestors: {},
      lastReviewedAt: '2026-10-20T12:00:00.000Z',
      ...overrides,
    },
  };
}

describe('MarketplaceReputationHeader', () => {
  beforeEach(() => {
    reputation.value = { status: 'loading' };
  });

  it('counts only trusted-attestor reviews in the star row and the basis line', () => {
    reputation.value = rated({ attestors: { [MARKETPLACE_TRUSTED_ATTESTORS[0]]: 2, [UNKNOWN_ATTESTOR]: 3 } });

    render(<MarketplaceReputationHeader sellerPubky={SELLER} variant="full" />);

    expect(screen.getByRole('img', { name: 'Rated 4.5 out of 5 from 6 reviews, 2 verified purchases' })).toBeVisible();
    expect(screen.getByTitle('2 verified purchases')).toBeInTheDocument();
    expect(screen.getByText('2 of 6 reviews verified by the marketplace attestor')).toBeInTheDocument();
  });

  it('claims no verified purchases when every attestation comes from an unrecognized key', () => {
    reputation.value = rated({ attestors: { [UNKNOWN_ATTESTOR]: 5 } });

    render(<MarketplaceReputationHeader sellerPubky={SELLER} variant="full" />);

    expect(screen.getByRole('img', { name: 'Rated 4.5 out of 5 from 6 reviews' })).toBeVisible();
    expect(screen.queryByTitle(/verified purchase/)).not.toBeInTheDocument();
    expect(screen.getByText('5 attested reviews, none from an attestor this app recognizes')).toBeInTheDocument();
  });

  it('applies the same trusted-only count to the compact listing-page variant', () => {
    reputation.value = rated({ attestors: { [MARKETPLACE_TRUSTED_ATTESTORS[0]]: 1, [UNKNOWN_ATTESTOR]: 4 } });

    render(<MarketplaceReputationHeader sellerPubky={SELLER} />);

    expect(screen.getByRole('img', { name: 'Rated 4.5 out of 5 from 6 reviews, 1 verified purchase' })).toBeVisible();
  });
});
