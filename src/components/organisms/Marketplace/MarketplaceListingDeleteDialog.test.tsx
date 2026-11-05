import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type {
  ListingDeletePlan,
  ListingDeleteTarget,
  UseDeleteMarketplaceListingsResult,
} from '@/hooks/useDeleteMarketplaceListings/useDeleteMarketplaceListings';
import { COMMERCE_FIXTURE_SELLER, createCommerceListingFixture } from '@/test/fixtures/commerce/commerce';
import { MarketplaceListingDeleteDialog } from './MarketplaceListingDeleteDialog';

const target = (listingId: string, title = `Listing ${listingId}`): ListingDeleteTarget => ({
  ownerPubky: COMMERCE_FIXTURE_SELLER,
  listingId,
  title,
  record: createCommerceListingFixture({ listingId }),
});

function auction(listingId: string): ListingDeleteTarget {
  const record = createCommerceListingFixture({ listingId });
  record.sale = {
    format: 'auction',
    startingPrice: { amountMinor: 4_500, currency: 'USD', exponent: 2 },
    minimumIncrement: { amountMinor: 500, currency: 'USD', exponent: 2 },
    startsAt: '2026-09-01T00:00:00.000Z',
    endsAt: '2099-01-01T00:00:00.000Z',
    antiSnipingWindowSeconds: 120,
    antiSnipingExtensionSeconds: 120,
  };
  return { ownerPubky: COMMERCE_FIXTURE_SELLER, listingId, title: `Auction ${listingId}`, record };
}

function controllerFor(
  plan: ListingDeletePlan | null,
  overrides: Partial<UseDeleteMarketplaceListingsResult> = {},
): UseDeleteMarketplaceListingsResult {
  return {
    open: true,
    plan,
    isDeleting: false,
    hasHomeserverSession: true,
    request: vi.fn(async () => {}),
    confirm: vi.fn(async () => {}),
    cancel: vi.fn(),
    ...overrides,
  };
}

const planFor = (targets: ListingDeleteTarget[], overrides: Partial<ListingDeletePlan> = {}): ListingDeletePlan => ({
  targets,
  blocked: [],
  openOrders: 0,
  ordersChecked: true,
  ...overrides,
});

describe('MarketplaceListingDeleteDialog', () => {
  it('says what deleting does, and offers unlisting instead', () => {
    render(<MarketplaceListingDeleteDialog controller={controllerFor(planFor([target('one')]))} />);

    expect(screen.getByRole('heading', { name: 'Delete this listing?' })).toBeInTheDocument();
    expect(screen.getByText(/can't be undone/)).toBeInTheDocument();
    expect(screen.getByText(/Paid orders still settle and can be fulfilled/)).toBeInTheDocument();
    expect(screen.getByText(/A drop that includes it releases it/)).toBeInTheDocument();
    expect(screen.getByTestId('listing-delete-unlist-hint')).toHaveTextContent('unlist it instead');
    expect(screen.queryByTestId('listing-delete-open-orders')).not.toBeInTheDocument();
  });

  it('warns about open orders but still allows the delete', async () => {
    const controller = controllerFor(planFor([target('one')], { openOrders: 2 }));
    render(<MarketplaceListingDeleteDialog controller={controller} />);

    expect(screen.getByTestId('listing-delete-open-orders')).toHaveTextContent('2 open orders');
    await userEvent.click(screen.getByRole('button', { name: 'Delete listing' }));
    expect(controller.confirm).toHaveBeenCalledOnce();
  });

  it('says when open orders could not be checked', () => {
    render(
      <MarketplaceListingDeleteDialog controller={controllerFor(planFor([target('one')], { ordersChecked: false }))} />,
    );

    expect(screen.getByTestId('listing-delete-orders-unchecked')).toBeInTheDocument();
    expect(screen.queryByTestId('listing-delete-open-orders')).not.toBeInTheDocument();
  });

  it('cannot confirm while it is still checking, and says so', () => {
    render(<MarketplaceListingDeleteDialog controller={controllerFor(null)} />);

    expect(screen.getByTestId('listing-delete-checking')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete listing' })).toBeDisabled();
  });

  it('lists several listings and counts them on the button', () => {
    render(
      <MarketplaceListingDeleteDialog
        controller={controllerFor(planFor([target('a', 'Alpha'), target('b', 'Bravo'), target('c', 'Charlie')]))}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Delete 3 listings?' })).toBeInTheDocument();
    expect(screen.getByTestId('listing-delete-titles')).toHaveTextContent('AlphaBravoCharlie');
    expect(screen.getByRole('button', { name: 'Delete 3 listings' })).toBeEnabled();
  });

  it('refuses an auction with bids and does not offer to delete it', () => {
    const live = auction('live');
    render(
      <MarketplaceListingDeleteDialog
        controller={controllerFor(planFor([live], { blocked: [{ target: live, bids: 2 }] }))}
      />,
    );

    expect(screen.getByTestId('listing-delete-blocked')).toHaveTextContent(
      "This auction has 2 bids, so it can't be deleted until it ends.",
    );
    expect(screen.getByRole('button', { name: /^Delete/ })).toBeDisabled();
  });

  it('skips the blocked listing in a bulk delete and deletes the rest', () => {
    const live = auction('live');
    render(
      <MarketplaceListingDeleteDialog
        controller={controllerFor(planFor([live, target('plain')], { blocked: [{ target: live, bids: 1 }] }))}
      />,
    );

    expect(screen.getByTestId('listing-delete-blocked')).toHaveTextContent('It will be skipped.');
    expect(screen.getByRole('button', { name: 'Delete listing' })).toBeEnabled();
  });

  it('still offers unlisting for a fixed-price listing when a live auction is skipped beside it', () => {
    const live = auction('live');
    render(
      <MarketplaceListingDeleteDialog
        controller={controllerFor(planFor([live, target('plain')], { blocked: [{ target: live, bids: 1 }] }))}
      />,
    );

    expect(screen.getByTestId('listing-delete-unlist-hint')).toBeInTheDocument();
  });

  it('disables the delete without a homeserver session', () => {
    render(
      <MarketplaceListingDeleteDialog
        controller={controllerFor(planFor([target('one')]), { hasHomeserverSession: false })}
      />,
    );

    expect(screen.getByRole('button', { name: 'Delete listing' })).toBeDisabled();
    expect(screen.getByTestId('listing-delete-needs-session')).toBeInTheDocument();
  });

  it('keeps the listing on Keep', async () => {
    const controller = controllerFor(planFor([target('one')]));
    render(<MarketplaceListingDeleteDialog controller={controller} />);

    await userEvent.click(screen.getByRole('button', { name: 'Keep listing' }));

    expect(controller.cancel).toHaveBeenCalled();
    expect(controller.confirm).not.toHaveBeenCalled();
  });
});
