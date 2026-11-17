import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarketplaceReviewFilterRating } from './MarketplaceReviewFilterRating';

describe('MarketplaceReviewFilterRating', () => {
  it('reads the matched figure with its basis phrase', () => {
    render(
      <MarketplaceReviewFilterRating
        summary={{ state: 'ready', filter: { kind: 'following' }, matched: { buyers: 3, orders: 4, avg: 4.8 } }}
      />,
    );

    expect(screen.getByTestId('marketplace-review-filter-rating')).toHaveTextContent('from 3 people you follow');
    expect(screen.getByRole('img')).toHaveAccessibleName(/4\.8/);
  });

  it('names a single person in the singular and the network and tag bases in their words', () => {
    const { rerender } = render(
      <MarketplaceReviewFilterRating
        summary={{ state: 'ready', filter: { kind: 'wot' }, matched: { buyers: 1, orders: 1, avg: 5 } }}
      />,
    );
    expect(screen.getByTestId('marketplace-review-filter-rating')).toHaveTextContent('from 1 person in your network');

    rerender(
      <MarketplaceReviewFilterRating
        summary={{
          state: 'ready',
          filter: { kind: 'tagged', labels: ['fast'] },
          matched: { buyers: 2, orders: 2, avg: 4 },
        }}
      />,
    );
    expect(screen.getByTestId('marketplace-review-filter-rating')).toHaveTextContent('from 2 people you tagged');
  });

  it('puts the label between the figure and its basis', () => {
    render(
      <MarketplaceReviewFilterRating
        label="products rated"
        summary={{ state: 'ready', filter: { kind: 'following' }, matched: { buyers: 2, orders: 2, avg: 4 } }}
      />,
    );

    expect(screen.getByTestId('marketplace-review-filter-rating')).toHaveTextContent(
      'products rated from 2 people you follow',
    );
  });

  it('says no reviews, never 0.0, when nobody matched', () => {
    render(
      <MarketplaceReviewFilterRating
        summary={{ state: 'ready', filter: { kind: 'following' }, matched: { buyers: 0, orders: 0, avg: null } }}
      />,
    );

    const text = screen.getByTestId('marketplace-review-filter-rating');
    expect(text).toHaveTextContent('No reviews from people you follow');
    expect(text.textContent).not.toContain('0.0');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('holds the place with a skeleton while the index has not answered', () => {
    render(<MarketplaceReviewFilterRating summary={{ state: 'loading', filter: { kind: 'wot' } }} />);

    expect(screen.getByTestId('marketplace-review-filter-rating-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('marketplace-review-filter-rating')).not.toBeInTheDocument();
  });

  it('says when no figure can be claimed for the filter', () => {
    render(<MarketplaceReviewFilterRating summary={{ state: 'unscored', filter: { kind: 'wot' } }} />);

    expect(screen.getByTestId('marketplace-review-filter-rating')).toHaveTextContent('No rating for this filter');
  });
});
