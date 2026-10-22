import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AwaitingReleaseReview } from '@/application/commerce/commerce';
import { COMMERCE_REVIEW_EDIT_WINDOW_SECONDS } from '@/config/commerce';
import { CommerceController } from '@/controllers/commerce/commerce';
import type { CommerceReviewModelSchema } from '@/models/commerce/commerce.schema';
import type { MarketplaceOrder } from '@/services/marketplace/marketplace';
import { marketplaceOrderSchema } from '@/services/marketplace/marketplace-projections';
import {
  createOrderFixture,
  createUsdtOrderFixture,
  ORDER_FIXTURE_BUYER,
  ORDER_FIXTURE_SELLER,
} from '@/test/fixtures/commerce/orders';
import { purchaseAttestationJwsFixture, TEST_TRUSTED_ATTESTOR } from '@/test/fixtures/commerce/trusted-attestors';
import { REFUND_FIXTURE_ADDRESS, REFUND_FIXTURE_TX_HASH } from '@/test/fixtures/commerce/usdt-refund.wire';
import { MarketplaceOrderActions } from './MarketplaceOrderActions';

// The component reads two honest projections through the controller: the
// seller's D2 band consent (review dialog) and the local copy of the user's
// own published review record (status line). Both are mocked per scenario.
vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    getMarketplaceBandConsent: vi.fn(async () => null),
    getOwnMarketplaceOrderReviews: vi.fn(async () => []),
    getAwaitingReleaseOwnMarketplaceReviews: vi.fn(async () => []),
    commitMarkReady: vi.fn(async () => ({ ok: true })),
    commitConfirmPickup: vi.fn(async () => ({ ok: true })),
    executeMarketplaceCommand: vi.fn(async () => ({
      ok: true,
      result: { kind: 'order', order: { state: 'cancelled' } },
    })),
    fetchPickupReveal: vi.fn(async () => {
      throw new Error('not under test here');
    }),
  },
}));

vi.mock('@/molecules/Toaster/use-toast', () => ({
  toast: vi.fn(),
}));

const mockedController = vi.mocked(CommerceController);

beforeEach(() => {
  mockedController.getMarketplaceBandConsent.mockReset().mockResolvedValue(null);
  mockedController.getOwnMarketplaceOrderReviews.mockReset().mockResolvedValue([]);
  mockedController.getAwaitingReleaseOwnMarketplaceReviews.mockReset().mockResolvedValue([]);
});

const WINDOW_MS = COMMERCE_REVIEW_EDIT_WINDOW_SECONDS * 1000;

function ownReview(createdAt: string): NonNullable<MarketplaceOrder['reviews']>[number] {
  return {
    id: '018f47d2-6a27-7c23-a62f-000000000601',
    reviewerPubky: ORDER_FIXTURE_BUYER,
    subjectPubky: 's'.repeat(52),
    rating: 5,
    text: 'Accurate and fast.',
    createdAt,
  };
}

function renderActions({
  reviewCreatedAt,
  canEditReview = true,
  withOwnReview = true,
}: {
  reviewCreatedAt?: string;
  canEditReview?: boolean;
  withOwnReview?: boolean;
} = {}) {
  const order = createOrderFixture('completed', {
    reviews: withOwnReview ? [ownReview(reviewCreatedAt ?? new Date(Date.now() - 60_000).toISOString())] : [],
  });
  const actOnOrder = vi.fn(async () => true);
  render(
    <MarketplaceOrderActions order={order} isBuyer={true} canEditReview={canEditReview} actOnOrder={actOnOrder} />,
  );
  return { order, actOnOrder };
}

describe('MarketplaceOrderActions review editing', () => {
  it('offers the edit inside the 24-hour window in transaction-service mode', () => {
    renderActions({ reviewCreatedAt: new Date(Date.now() - (WINDOW_MS - 60_000)).toISOString() });

    expect(screen.getByRole('button', { name: 'Edit review' })).toBeInTheDocument();
    // The review already exists, so the create affordance is gone.
    expect(screen.queryByRole('button', { name: 'Leave review' })).not.toBeInTheDocument();
  });

  it('withholds the edit once the window has closed instead of failing on submit', () => {
    renderActions({ reviewCreatedAt: new Date(Date.now() - (WINDOW_MS + 60_000)).toISOString() });

    expect(screen.queryByRole('button', { name: 'Edit review' })).not.toBeInTheDocument();
  });

  it('withholds the edit in sandbox mode: the sandbox has no review.update command', () => {
    renderActions({ canEditReview: false });

    expect(screen.queryByRole('button', { name: 'Edit review' })).not.toBeInTheDocument();
  });

  it('withholds the edit when the caller has not reviewed the order', () => {
    renderActions({ withOwnReview: false });

    expect(screen.queryByRole('button', { name: 'Edit review' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leave review' })).toBeInTheDocument();
  });

  it('prefills the existing review and submits review.update with the revised terms', async () => {
    const user = userEvent.setup();
    const { order, actOnOrder } = renderActions();

    await user.click(screen.getByRole('button', { name: 'Edit review' }));
    expect(screen.getByText('Edit your review')).toBeInTheDocument();

    const textField = screen.getByLabelText(/^Review of Handmade leather boots/);
    expect(textField).toHaveValue('Accurate and fast.');
    const stars = within(screen.getByRole('radiogroup', { name: 'Rating for Handmade leather boots' }));
    expect(stars.getByRole('radio', { name: '5 stars' })).toBeChecked();

    await user.click(stars.getByRole('radio', { name: '3 stars' }));
    await user.clear(textField);
    await user.type(textField, 'Item arrived scratched after all.');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(actOnOrder).toHaveBeenCalledWith(order, 'review.update', {
      items: [{ listingId: 'boots', rating: 3, text: 'Item arrived scratched after all.' }],
    });
  });

  it('changes the review rating with arrow keys and submits the same form field', async () => {
    const user = userEvent.setup();
    const { order, actOnOrder } = renderActions({ withOwnReview: false });

    await user.click(screen.getByRole('button', { name: 'Leave review' }));
    const group = within(screen.getByRole('radiogroup', { name: 'Rating for Handmade leather boots' }));
    const oneStar = group.getByRole('radio', { name: '1 star' });
    await user.click(oneStar);
    expect(oneStar).toBeChecked();
    expect(oneStar).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(group.getByRole('radio', { name: '2 stars' })).toBeChecked();
    expect(group.getByRole('radio', { name: '2 stars' })).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(group.getByRole('radio', { name: '3 stars' })).toBeChecked();
    expect(group.getByRole('radio', { name: '3 stars' })).toHaveFocus();

    await user.type(screen.getByLabelText(/^Review of Handmade leather boots/), 'Accurate and fast.');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(actOnOrder).toHaveBeenCalledWith(order, 'review.create', {
      items: [{ listingId: 'boots', rating: 3, text: 'Accurate and fast.' }],
      allowAmountBand: false,
    });
  });

  it('keeps a single tab stop on the checked rating radio', async () => {
    const user = userEvent.setup();
    renderActions({ withOwnReview: false });

    await user.click(screen.getByRole('button', { name: 'Leave review' }));
    const group = within(screen.getByRole('radiogroup', { name: 'Rating for Handmade leather boots' }));
    const checked = group.getByRole('radio', { name: '5 stars' });
    const radios = group.getAllByRole('radio');
    expect(checked).toBeChecked();
    expect(radios.filter((radio) => radio.tabIndex >= 0)).toEqual([checked]);

    checked.focus();
    await user.tab();
    expect(screen.getByLabelText(/^Review of Handmade leather boots/)).toHaveFocus();
  });
});

describe('MarketplaceOrderActions review disclosure', () => {
  it('tells the buyer the review is public, tied to their Pubky, and shows the purchase', async () => {
    const user = userEvent.setup();
    renderActions({ withOwnReview: false });

    await user.click(screen.getByRole('button', { name: 'Leave review' }));
    expect(screen.getByTestId('review-disclosure')).toHaveTextContent(
      'Your review is public, tied to your Pubky, and shows you bought this item.',
    );
  });

  it('tells the buyer the price range of each reviewed item becomes public', async () => {
    const user = userEvent.setup();
    renderActions({ withOwnReview: false });

    await user.click(screen.getByRole('button', { name: 'Leave review' }));
    expect(screen.getByTestId('review-disclosure')).toHaveTextContent(
      'The price range of each item you review becomes public too.',
    );
  });

  it('keeps the price-range line out of the sandbox dialog, whose attestations carry no price', async () => {
    const user = userEvent.setup();
    renderActions({ withOwnReview: false, canEditReview: false });

    await user.click(screen.getByRole('button', { name: 'Leave review' }));
    expect(screen.getByTestId('review-disclosure')).not.toHaveTextContent(/price range/);
  });

  it('tells a seller reviewing a buyer that the review shows the buyer ordered from them', async () => {
    const user = userEvent.setup();
    const order = createOrderFixture('completed', { reviews: [] });
    render(<MarketplaceOrderActions order={order} isBuyer={false} canEditReview={false} actOnOrder={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Leave review' }));
    expect(screen.getByTestId('review-disclosure')).toHaveTextContent(
      'Your review is public, tied to your Pubky, and shows this buyer ordered from you.',
    );
  });

  it('says in the band opt-in helper text that the band becomes public', async () => {
    mockedController.getMarketplaceBandConsent.mockResolvedValue(true);
    const user = userEvent.setup();
    renderActions({ withOwnReview: false });

    await user.click(screen.getByRole('button', { name: 'Leave review' }));
    expect(await screen.findByText(/it becomes public with your review/i)).toBeInTheDocument();
  });
});

describe('MarketplaceOrderActions amount-band opt-in (D2 both-sides consent)', () => {
  it('renders the opt-in only when the seller consented, and submits the buyer choice', async () => {
    mockedController.getMarketplaceBandConsent.mockResolvedValue(true);
    const user = userEvent.setup();
    const { order, actOnOrder } = renderActions({ withOwnReview: false });

    await user.click(screen.getByRole('button', { name: 'Leave review' }));
    const checkbox = await screen.findByRole('checkbox', { name: /include an approximate price range/i });
    expect(checkbox).not.toBeChecked();

    await user.type(screen.getByLabelText(/^Review of Handmade leather boots/), 'Accurate and fast.');
    await user.click(checkbox);
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(actOnOrder).toHaveBeenCalledWith(order, 'review.create', {
      items: [{ listingId: 'boots', rating: 5, text: 'Accurate and fast.' }],
      allowAmountBand: true,
    });
  });

  it('defaults the opt-in to excluded (not included unless both sides opt in)', async () => {
    mockedController.getMarketplaceBandConsent.mockResolvedValue(true);
    const user = userEvent.setup();
    const { order, actOnOrder } = renderActions({ withOwnReview: false });

    await user.click(screen.getByRole('button', { name: 'Leave review' }));
    await screen.findByRole('checkbox', { name: /include an approximate price range/i });
    await user.type(screen.getByLabelText(/^Review of Handmade leather boots/), 'Accurate and fast.');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(actOnOrder).toHaveBeenCalledWith(order, 'review.create', {
      items: [{ listingId: 'boots', rating: 5, text: 'Accurate and fast.' }],
      allowAmountBand: false,
    });
  });

  it('states truthfully that the seller has not enabled bands instead of a dead checkbox', async () => {
    mockedController.getMarketplaceBandConsent.mockResolvedValue(false);
    const user = userEvent.setup();
    renderActions({ withOwnReview: false });

    await user.click(screen.getByRole('button', { name: 'Leave review' }));
    expect(await screen.findByText(/has not enabled price-range sharing/i)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('renders neither checkbox nor note when the backend has no attestation support', async () => {
    mockedController.getMarketplaceBandConsent.mockResolvedValue(null);
    const user = userEvent.setup();
    renderActions({ withOwnReview: false });

    await user.click(screen.getByRole('button', { name: 'Leave review' }));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByText(/price-range sharing/i)).not.toBeInTheDocument();
  });
});

describe('MarketplaceOrderActions own-review verified status', () => {
  const ISSUED_IN_WINDOW = Date.parse('2026-10-20T12:00:00Z') / 1000;

  function attestedRecord(iss: string, iat: number): CommerceReviewModelSchema['record'] {
    return {
      listingId: 'boots',
      eligibilityAttestation: purchaseAttestationJwsFixture({ iss, iat }),
    } as CommerceReviewModelSchema['record'];
  }

  function publishedReviewRow(overrides: Partial<CommerceReviewModelSchema> = {}): CommerceReviewModelSchema {
    return {
      id: `${ORDER_FIXTURE_BUYER}:8Z8CWH8NVYQY39ZEBFGKQWWEKG`,
      owner_id: ORDER_FIXTURE_BUYER,
      review_id: '8Z8CWH8NVYQY39ZEBFGKQWWEKG',
      order_id: 'order-1',
      subject_id: 's'.repeat(52),
      record: attestedRecord(TEST_TRUSTED_ATTESTOR.pubky, ISSUED_IN_WINDOW),
      attestation_verified: true,
      attestation_iss: TEST_TRUSTED_ATTESTOR.pubky,
      sync_status: 'synced',
      updated_at: Date.now(),
      ...overrides,
    };
  }

  it('shows the verified state when the published record carries a verifying attestation', async () => {
    mockedController.getOwnMarketplaceOrderReviews.mockResolvedValue([publishedReviewRow()]);
    renderActions();

    await waitFor(() => {
      expect(screen.getByTestId('own-review-status')).toHaveTextContent(
        `Verified purchase · Pubky Market — your published review embeds a purchase attestation signed by attestor ${TEST_TRUSTED_ATTESTOR.pubky.slice(0, 8)}….`,
      );
    });
  });

  it('does not claim a verified purchase when the attestation was issued before the attestor became trusted', async () => {
    const issuedBeforeWindow = Date.parse(TEST_TRUSTED_ATTESTOR.validFrom) / 1000 - 1;
    mockedController.getOwnMarketplaceOrderReviews.mockResolvedValue([
      publishedReviewRow({ record: attestedRecord(TEST_TRUSTED_ATTESTOR.pubky, issuedBeforeWindow) }),
    ]);
    renderActions();

    await waitFor(() => {
      expect(screen.getByTestId('own-review-status')).toHaveTextContent(/is not an attestor this app recognizes/);
    });
    expect(screen.getByTestId('own-review-status')).not.toHaveTextContent(/Verified purchase/);
  });

  it('does not claim a verified purchase when the attestation signer is not a trusted attestor', async () => {
    mockedController.getOwnMarketplaceOrderReviews.mockResolvedValue([
      publishedReviewRow({ attestation_iss: 'o'.repeat(52), record: attestedRecord('o'.repeat(52), ISSUED_IN_WINDOW) }),
    ]);
    renderActions();

    await waitFor(() => {
      expect(screen.getByTestId('own-review-status')).toHaveTextContent(
        'Your published review embeds a valid purchase attestation, but its signer (oooooooo…) is not an attestor this app recognizes.',
      );
    });
    expect(screen.getByTestId('own-review-status')).not.toHaveTextContent(/Verified purchase/);
  });

  it('shows the pending-publication state truthfully', async () => {
    mockedController.getOwnMarketplaceOrderReviews.mockResolvedValue([publishedReviewRow({ sync_status: 'pending' })]);
    renderActions();

    await waitFor(() => {
      expect(screen.getByTestId('own-review-status')).toHaveTextContent(
        /Publication is pending and will retry automatically/,
      );
    });
  });

  it('does not claim that no attestation was issued when the durable row is unavailable', async () => {
    mockedController.getOwnMarketplaceOrderReviews.mockResolvedValue([]);
    renderActions();

    await waitFor(() => {
      expect(screen.getByTestId('own-review-status')).toHaveTextContent(/publication status will appear/);
    });
  });

  describe('after the user withdrew the review', () => {
    const REMOVED_STATUS = 'You removed your review. It is no longer public.';

    function renderWithdrawn(actions?: { reviewCreatedAt?: string }) {
      const order = createOrderFixture('completed', {
        reviews: [
          {
            ...ownReview(actions?.reviewCreatedAt ?? new Date(Date.now() - 60_000).toISOString()),
            publicRemoved: true,
          },
        ],
      });
      render(<MarketplaceOrderActions order={order} isBuyer={true} canEditReview={true} actOnOrder={vi.fn()} />);
      return order;
    }

    it('says the review was removed, not saved, when no local record is left', async () => {
      mockedController.getOwnMarketplaceOrderReviews.mockResolvedValue([]);
      renderWithdrawn();

      const status = screen.getByTestId('own-review-status');
      expect(status).toHaveTextContent(REMOVED_STATUS);
      await waitFor(() => expect(mockedController.getOwnMarketplaceOrderReviews).toHaveBeenCalled());
      expect(status).not.toHaveTextContent(/Your review is saved/);
      expect(status).not.toHaveTextContent(/publication status will appear/);
    });

    it('does not show a leftover published record as live', async () => {
      mockedController.getOwnMarketplaceOrderReviews.mockResolvedValue([publishedReviewRow()]);
      renderWithdrawn();

      await waitFor(() => expect(mockedController.getOwnMarketplaceOrderReviews).toHaveBeenCalled());
      const status = screen.getByTestId('own-review-status');
      expect(status).toHaveTextContent(REMOVED_STATUS);
      expect(status).not.toHaveTextContent(/Verified purchase/);
    });

    it('does not say a withdrawn review publishes later', async () => {
      mockedController.getAwaitingReleaseOwnMarketplaceReviews.mockResolvedValue([
        {
          orderId: createOrderFixture('completed').id,
          releaseAt: '2026-11-01T00:00:00.000Z',
          reviewerRole: 'buyer',
          items: [],
        },
      ]);
      renderWithdrawn();

      await waitFor(() => expect(mockedController.getAwaitingReleaseOwnMarketplaceReviews).toHaveBeenCalled());
      expect(screen.queryByTestId('own-review-pending')).not.toBeInTheDocument();
      expect(screen.getByTestId('own-review-status')).toHaveTextContent(REMOVED_STATUS);
    });

    it('keeps the order showing that the user reviewed it, with the edit that restores the review', () => {
      renderWithdrawn();

      expect(screen.queryByRole('button', { name: 'Leave review' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Edit review' })).toBeInTheDocument();
    });

    it('still says a live review is saved', async () => {
      mockedController.getOwnMarketplaceOrderReviews.mockResolvedValue([]);
      renderActions();

      await waitFor(() => {
        expect(screen.getByTestId('own-review-status')).toHaveTextContent(/publication status will appear/);
      });
      expect(screen.getByTestId('own-review-status')).not.toHaveTextContent(REMOVED_STATUS);
    });
  });
});

describe('MarketplaceOrderActions a review the double-blind window withholds', () => {
  function held(overrides: Partial<AwaitingReleaseReview> = {}): AwaitingReleaseReview {
    return {
      orderId: createOrderFixture('completed').id,
      releaseAt: '2026-11-01T00:00:00.000Z',
      reviewerRole: 'buyer',
      items: [],
      ...overrides,
    };
  }

  it('says when the buyer’s review publishes, instead of a publication status', async () => {
    mockedController.getAwaitingReleaseOwnMarketplaceReviews.mockResolvedValue([held()]);
    renderActions();

    expect(await screen.findByTestId('own-review-pending')).toHaveTextContent(
      'Publishes when the seller reviews, or on Nov 1, 2026',
    );
    expect(screen.getByTestId('own-review-status')).not.toHaveTextContent(/publication status will appear/);
  });

  it('mirrors the wording for the seller', async () => {
    mockedController.getAwaitingReleaseOwnMarketplaceReviews.mockResolvedValue([held({ reviewerRole: 'seller' })]);
    const order = createOrderFixture('completed', {
      reviews: [{ ...ownReview(new Date(Date.now() - 60_000).toISOString()), reviewerPubky: ORDER_FIXTURE_SELLER }],
    });
    render(<MarketplaceOrderActions order={order} isBuyer={false} canEditReview={true} actOnOrder={vi.fn()} />);

    expect(await screen.findByTestId('own-review-pending')).toHaveTextContent(
      'Publishes when the buyer reviews, or on Nov 1, 2026',
    );
  });

  it('ignores a review held for another order', async () => {
    mockedController.getAwaitingReleaseOwnMarketplaceReviews.mockResolvedValue([held({ orderId: 'another-order' })]);
    renderActions();

    await waitFor(() => expect(screen.getByTestId('own-review-status')).toHaveTextContent(/publication status/));
    expect(screen.queryByTestId('own-review-pending')).not.toBeInTheDocument();
  });

  it('offers Leave review while only the counterparty’s withheld stub is on the order', async () => {
    const order = marketplaceOrderSchema.parse({
      ...createOrderFixture('completed'),
      reviews: [{ role: 'seller', submitted: true }],
    });
    render(<MarketplaceOrderActions order={order} isBuyer={true} canEditReview={true} actOnOrder={vi.fn()} />);

    expect(await screen.findByRole('button', { name: 'Leave review' })).toBeInTheDocument();
    expect(screen.queryByTestId('own-review-status')).not.toBeInTheDocument();
    expect(mockedController.getAwaitingReleaseOwnMarketplaceReviews).not.toHaveBeenCalled();
  });
});

describe('MarketplaceOrderActions per-item reviews', () => {
  const LISTINGS = [
    { id: 'boots', title: 'Handmade leather boots' },
    { id: 'belt', title: 'Braided leather belt' },
    { id: 'wallet', title: 'Slim leather wallet' },
  ];

  function threeItemOrder(
    reviewed: { id: string; rating: number; text: string; shipping?: number; communication?: number }[] = [],
    firstReviewAgeMs = 60_000,
  ) {
    return createOrderFixture('completed', {
      lines: LISTINGS.map(({ id, title }) => ({
        ...createOrderFixture('completed').lines[0],
        listingAggregateId: `listing:${ORDER_FIXTURE_SELLER}_${id}`,
        title,
      })),
      reviews: reviewed.map((review, index) => ({
        id: `018f47d2-6a27-7c23-a62f-00000000070${index}`,
        reviewerPubky: ORDER_FIXTURE_BUYER,
        subjectPubky: ORDER_FIXTURE_SELLER,
        listingAggregateId: `listing:${ORDER_FIXTURE_SELLER}_${review.id}`,
        rating: review.rating,
        text: review.text,
        shipping: review.shipping ?? null,
        communication: review.communication ?? null,
        createdAt: new Date(Date.now() - firstReviewAgeMs + index).toISOString(),
      })),
    });
  }

  function renderOrder(order: MarketplaceOrder, canEditReview = true) {
    const actOnOrder = vi.fn(
      async (_order: MarketplaceOrder, _kind: string, _payload: Record<string, unknown>) => true,
    );
    render(
      <MarketplaceOrderActions order={order} isBuyer={true} canEditReview={canEditReview} actOnOrder={actOnOrder} />,
    );
    return actOnOrder;
  }

  const stars = (title: string) => within(screen.getByRole('radiogroup', { name: `Rating for ${title}` }));

  it('asks for stars and optional text on every listing of the order', async () => {
    const user = userEvent.setup();
    renderOrder(threeItemOrder());

    await user.click(screen.getByRole('button', { name: 'Leave review' }));
    expect(screen.getAllByTestId('review-item')).toHaveLength(3);
    for (const { title } of LISTINGS) {
      expect(stars(title).getAllByRole('radio')).toHaveLength(5);
      expect(screen.getByLabelText(`Review of ${title} (optional)`)).toHaveValue('');
    }
  });

  it('submits one item term per listing with empty text allowed and no seller ratings by default', async () => {
    const user = userEvent.setup();
    const order = threeItemOrder();
    const actOnOrder = renderOrder(order);

    await user.click(screen.getByRole('button', { name: 'Leave review' }));
    await user.click(stars('Handmade leather boots').getByRole('radio', { name: '4 stars' }));
    await user.click(stars('Slim leather wallet').getByRole('radio', { name: '2 stars' }));
    await user.type(screen.getByLabelText('Review of Braided leather belt (optional)'), '  Solid belt.  ');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(actOnOrder).toHaveBeenCalledTimes(1));
    expect(actOnOrder).toHaveBeenCalledWith(order, 'review.create', {
      items: [
        { listingId: 'boots', rating: 4, text: '' },
        { listingId: 'belt', rating: 5, text: 'Solid belt.' },
        { listingId: 'wallet', rating: 2, text: '' },
      ],
      allowAmountBand: false,
    });
  });

  it('sends the seller ratings once, next to the items', async () => {
    const user = userEvent.setup();
    const order = threeItemOrder();
    const actOnOrder = renderOrder(order);

    await user.click(screen.getByRole('button', { name: 'Leave review' }));
    const seller = within(screen.getByTestId('review-seller-ratings'));
    await user.click(
      within(seller.getByRole('radiogroup', { name: 'Shipping' })).getByRole('radio', { name: '4 stars' }),
    );
    await user.click(
      within(seller.getByRole('radiogroup', { name: 'Communication' })).getByRole('radio', { name: '5 stars' }),
    );
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(actOnOrder).toHaveBeenCalledTimes(1));
    expect(actOnOrder).toHaveBeenCalledWith(
      order,
      'review.create',
      expect.objectContaining({ seller: { shipping: 4, communication: 5 } }),
    );
  });

  it('refuses a single seller rating and lets the buyer clear it', async () => {
    const user = userEvent.setup();
    const actOnOrder = renderOrder(threeItemOrder());

    await user.click(screen.getByRole('button', { name: 'Leave review' }));
    const seller = within(screen.getByTestId('review-seller-ratings'));
    await user.click(
      within(seller.getByRole('radiogroup', { name: 'Shipping' })).getByRole('radio', { name: '3 stars' }),
    );
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('Rate both shipping and communication, or leave both blank.')).toBeInTheDocument();
    expect(actOnOrder).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Clear seller ratings' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(actOnOrder).toHaveBeenCalledTimes(1));
    expect(actOnOrder.mock.calls[0]?.[2]).not.toHaveProperty('seller');
  });

  it('offers only the listings not reviewed yet when adding items inside the window', async () => {
    const user = userEvent.setup();
    const order = threeItemOrder([{ id: 'boots', rating: 4, text: 'Great boots.', shipping: 5, communication: 4 }]);
    const actOnOrder = renderOrder(order);

    expect(screen.queryByRole('button', { name: 'Leave review' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review more items' }));
    expect(screen.getAllByTestId('review-item')).toHaveLength(2);
    expect(screen.queryByRole('radiogroup', { name: 'Rating for Handmade leather boots' })).not.toBeInTheDocument();
    expect(screen.getByTestId('review-seller-ratings-note')).toBeInTheDocument();
    expect(screen.queryByTestId('review-seller-ratings')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(actOnOrder).toHaveBeenCalledTimes(1));
    expect(actOnOrder).toHaveBeenCalledWith(order, 'review.create', {
      items: [
        { listingId: 'belt', rating: 5, text: '' },
        { listingId: 'wallet', rating: 5, text: '' },
      ],
      allowAmountBand: false,
    });
  });

  it('withholds adding items once the window from the first review has closed', () => {
    renderOrder(threeItemOrder([{ id: 'boots', rating: 4, text: '' }], WINDOW_MS + 60_000));

    expect(screen.queryByRole('button', { name: 'Review more items' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit review' })).not.toBeInTheDocument();
  });

  it('counts the window from the earliest of the buyer item reviews', () => {
    const order = threeItemOrder(
      [
        { id: 'boots', rating: 4, text: '' },
        { id: 'belt', rating: 3, text: '' },
      ],
      WINDOW_MS - 60_000,
    );
    renderOrder(order);

    expect(screen.getByRole('button', { name: 'Edit review' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review more items' })).toBeInTheDocument();
  });

  it('edits one item and sends only that item', async () => {
    const user = userEvent.setup();
    const order = threeItemOrder([
      { id: 'boots', rating: 4, text: 'Great boots.', shipping: 5, communication: 4 },
      { id: 'belt', rating: 3, text: 'Fine belt.', shipping: 5, communication: 4 },
      { id: 'wallet', rating: 5, text: '', shipping: 5, communication: 4 },
    ]);
    const actOnOrder = renderOrder(order);

    await user.click(screen.getByRole('button', { name: 'Edit review' }));
    expect(stars('Braided leather belt').getByRole('radio', { name: '3 stars' })).toBeChecked();
    expect(screen.getByLabelText('Review of Handmade leather boots (optional)')).toHaveValue('Great boots.');
    await user.click(stars('Braided leather belt').getByRole('radio', { name: '2 stars' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(actOnOrder).toHaveBeenCalledTimes(1));
    expect(actOnOrder).toHaveBeenCalledWith(order, 'review.update', {
      items: [{ listingId: 'belt', rating: 2, text: 'Fine belt.' }],
    });
  });

  it('sends the seller ratings alone with the first item when only they changed', async () => {
    const user = userEvent.setup();
    const order = threeItemOrder([
      { id: 'boots', rating: 4, text: 'Great boots.', shipping: 5, communication: 4 },
      { id: 'belt', rating: 3, text: '', shipping: 5, communication: 4 },
    ]);
    const actOnOrder = renderOrder(order);

    await user.click(screen.getByRole('button', { name: 'Edit review' }));
    const seller = within(screen.getByTestId('review-seller-ratings'));
    await user.click(
      within(seller.getByRole('radiogroup', { name: 'Communication' })).getByRole('radio', { name: '2 stars' }),
    );
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(actOnOrder).toHaveBeenCalledTimes(1));
    expect(actOnOrder).toHaveBeenCalledWith(order, 'review.update', {
      items: [{ listingId: 'boots', rating: 4, text: 'Great boots.' }],
      seller: { shipping: 5, communication: 2 },
    });
  });

  it('sends nothing when an edit changes nothing', async () => {
    const user = userEvent.setup();
    const actOnOrder = renderOrder(threeItemOrder([{ id: 'boots', rating: 4, text: 'Great boots.' }]));

    await user.click(screen.getByRole('button', { name: 'Edit review' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(actOnOrder).not.toHaveBeenCalled();
  });

  it('keeps the single v1 rating for a buyer on the sandbox', async () => {
    const user = userEvent.setup();
    const order = threeItemOrder();
    const actOnOrder = renderOrder(order, false);

    await user.click(screen.getByRole('button', { name: 'Leave review' }));
    expect(screen.queryByTestId('review-items')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Review'), 'Accurate and fast.');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(actOnOrder).toHaveBeenCalledTimes(1));
    expect(actOnOrder).toHaveBeenCalledWith(order, 'review.create', {
      rating: 5,
      text: 'Accurate and fast.',
      allowAmountBand: false,
    });
  });

  it('shows the publication state of each reviewed item under its title', async () => {
    mockedController.getOwnMarketplaceOrderReviews.mockResolvedValue([
      {
        id: `${ORDER_FIXTURE_BUYER}:A`,
        owner_id: ORDER_FIXTURE_BUYER,
        review_id: 'A',
        order_id: 'order-1',
        subject_id: ORDER_FIXTURE_SELLER,
        record: { listingId: 'belt' } as CommerceReviewModelSchema['record'],
        attestation_verified: false,
        attestation_iss: null,
        sync_status: 'pending',
        updated_at: Date.now(),
      },
    ]);
    renderOrder(
      threeItemOrder([
        { id: 'boots', rating: 4, text: '' },
        { id: 'belt', rating: 3, text: '' },
      ]),
    );

    await waitFor(() => {
      expect(screen.getByTestId('own-review-status')).toHaveTextContent(
        'Braided leather belt: Your review is saved. Publication is pending and will retry automatically.',
      );
    });
    expect(screen.getByTestId('own-review-status')).toHaveTextContent(
      'Handmade leather boots: Your review is saved. Its publication status will appear shortly.',
    );
  });
});

describe('MarketplaceOrderActions refund reference labels', () => {
  it.each([
    ['bitcoin', 'External Bitcoin transaction reference'],
    ['paypal', 'PayPal refund transaction id'],
    [undefined, 'External payment reference'],
  ] as const)('uses the %s rail label', async (paymentMethod, label) => {
    const order = createOrderFixture('return_received', { paymentMethod });
    render(
      <MarketplaceOrderActions
        order={order}
        isBuyer={false}
        canEditReview={false}
        actOnOrder={vi.fn(async () => true)}
      />,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: 'Record refund' }));
    expect(screen.getByLabelText(label)).toBeInTheDocument();
  });

  it('labels a Bitcoin refund amount in satoshis and shows the payment-code equation', async () => {
    const order = createOrderFixture('return_received', {
      paymentMethod: 'bitcoin',
      paykitTotalSats: 1_255,
      merchandiseTotal: { amountMinor: 1_000, currency: 'BTC', exponent: 8 },
      bitcoinPayable: { amountMinor: 1_255, currency: 'SAT', exponent: 0 },
      subtotal: { amountMinor: 1_000, currency: 'BTC', exponent: 8 },
      shipping: { amountMinor: 0, currency: 'BTC', exponent: 8 },
      total: { amountMinor: 1_255, currency: 'BTC', exponent: 8 },
    });
    const actOnOrder = vi.fn(async () => true);
    render(<MarketplaceOrderActions order={order} isBuyer={false} canEditReview={false} actOnOrder={actOnOrder} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Record refund' }));
    expect(screen.getByLabelText('Amount (₿)')).toHaveValue('1255');
    expect(screen.queryByLabelText('Amount (USD)')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('table', { name: 'Bitcoin payment breakdown' }))
        .getAllByRole('row')
        .map((row) => row.textContent),
    ).toEqual(['Items₿1,000', 'Shipping₿0', 'Payment code₿255', 'Total₿1,255']);
    await user.type(screen.getByLabelText('External Bitcoin transaction reference'), 'txid-canary-refund');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() =>
      expect(actOnOrder).toHaveBeenCalledWith(order, 'refund.record_external', {
        amountMinor: 1_255,
        transactionId: 'txid-canary-refund',
      }),
    );
  });

  it('tells a PayPal seller to refund in PayPal before recording the return', async () => {
    const order = createOrderFixture('return_received', { paymentMethod: 'paypal' });
    render(
      <MarketplaceOrderActions
        order={order}
        isBuyer={false}
        canEditReview={false}
        actOnOrder={vi.fn(async () => true)}
      />,
    );

    expect(screen.getByRole('button', { name: 'Record refund' })).toBeInTheDocument();
    expect(screen.getByTestId('paypal-refund-hint')).toHaveTextContent(
      'Refund the buyer in PayPal first, then record it here',
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Record refund' }));
    expect(screen.getByRole('heading', { name: 'Record refund' })).toBeInTheDocument();
    expect(screen.getByLabelText('Amount (USD)')).toHaveValue('137.00');
    expect(screen.getByLabelText('PayPal refund transaction id')).toBeInTheDocument();
  });

  it.each(['return_received', 'cancelled'] as const)(
    'lets the seller close a %s order after a PayPal partial refund, prefilled with the rest',
    async (state) => {
      const order = createOrderFixture(state, {
        paymentMethod: 'paypal',
        total: { amountMinor: 250, currency: 'USD', exponent: 2 },
        externalRefund: {
          amountMinor: 189,
          transactionId: '9RF12345AB678901C',
          recordedAt: '2026-09-24T18:00:00.000Z',
        },
      });
      const actOnOrder = vi.fn(async () => true);
      render(<MarketplaceOrderActions order={order} isBuyer={false} canEditReview={false} actOnOrder={actOnOrder} />);

      expect(screen.queryByTestId('paypal-refund-hint')).not.toBeInTheDocument();
      expect(screen.getByTestId('paypal-partial-refund-hint')).toHaveTextContent(
        'PayPal refunded $1.89 of $2.50. Record the rest to close this order.',
      );
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Record refund' }));
      expect(screen.getByTestId('refund-paypal-already')).toHaveTextContent('PayPal already refunded $1.89.');
      expect(screen.getByLabelText('Refunded outside PayPal (USD)')).toHaveValue('0.61');
      await user.type(screen.getByLabelText('PayPal refund transaction id'), 'BANKTRANSFER061');
      await user.click(screen.getByRole('button', { name: 'Confirm' }));

      await waitFor(() =>
        expect(actOnOrder).toHaveBeenCalledWith(order, 'refund.record_external', {
          amountMinor: 250,
          transactionId: 'BANKTRANSFER061',
        }),
      );
    },
  );

  it('offers no refund record once the order is refunded', () => {
    const order = createOrderFixture('refunded_external', {
      externalRefund: { amountMinor: 250, transactionId: '9RF12345AB678901C', recordedAt: '2026-09-24T18:00:00.000Z' },
    });
    render(
      <MarketplaceOrderActions
        order={order}
        isBuyer={false}
        canEditReview={false}
        actOnOrder={vi.fn(async () => true)}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Record refund' })).not.toBeInTheDocument();
  });
});

describe('MarketplaceOrderActions local pickup (Wave 7, §A6)', () => {
  const pickupControllerState = {
    confirmResponse: { ok: true } as unknown,
    cancelResponse: { ok: true, result: { kind: 'order', order: { state: 'cancelled' } } } as unknown,
  };

  beforeEach(() => {
    mockedController.commitMarkReady.mockClear().mockResolvedValue({ ok: true } as never);
    mockedController.commitConfirmPickup
      .mockClear()
      .mockImplementation(async () => pickupControllerState.confirmResponse as never);
    mockedController.executeMarketplaceCommand
      .mockClear()
      .mockImplementation(async () => pickupControllerState.cancelResponse as never);
    pickupControllerState.confirmResponse = { ok: true };
    pickupControllerState.cancelResponse = { ok: true, result: { kind: 'order', order: { state: 'cancelled' } } };
  });

  function renderPickupActions({
    state,
    isBuyer,
    overrides = {},
  }: {
    state: 'paid' | 'ready_for_pickup' | 'delivered';
    isBuyer: boolean;
    overrides?: Partial<MarketplaceOrder>;
  }) {
    const order = createOrderFixture(state, { fulfillment: 'pickup', ...overrides });
    const actOnOrder = vi.fn(async () => true);
    const onChanged = vi.fn();
    render(
      <MarketplaceOrderActions
        order={order}
        isBuyer={isBuyer}
        canEditReview={false}
        actOnOrder={actOnOrder}
        onChanged={onChanged}
      />,
    );
    return { order, actOnOrder, onChanged };
  }

  it('hints that Mark return received is for a pickup the buyer brought back', () => {
    const order = createOrderFixture('return_approved', { fulfillment: 'pickup' });
    render(
      <MarketplaceOrderActions
        order={order}
        isBuyer={false}
        canEditReview={false}
        actOnOrder={vi.fn(async () => true)}
      />,
    );

    expect(screen.getByRole('button', { name: 'Mark return received' })).toBeInTheDocument();
    expect(screen.getByTestId('mark-return-received-hint')).toHaveTextContent(
      'Press when the buyer has brought it back',
    );
  });

  it('offers the seller Mark ready for pickup and Confirm handover from paid — and no shipping actions', () => {
    renderPickupActions({ state: 'paid', isBuyer: false });

    expect(screen.getByRole('button', { name: 'Mark ready for pickup' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm handover' })).toBeInTheDocument();
    // Pickup orders never ship (§A6): no tracking, no label.
    expect(screen.queryByRole('button', { name: 'Mark shipped' })).not.toBeInTheDocument();
  });

  it('hides the packing-slip print affordance on pickup orders (§A5)', () => {
    renderPickupActions({ state: 'paid', isBuyer: false });
    expect(screen.queryByRole('button', { name: 'Packing slip' })).not.toBeInTheDocument();

    renderPickupActions({ state: 'delivered', isBuyer: false });
    expect(screen.queryByRole('button', { name: 'Packing slip' })).not.toBeInTheDocument();
  });

  it('keeps the packing-slip affordance on shipped orders', () => {
    const order = createOrderFixture('paid', { fulfillment: 'shipping' });
    render(
      <MarketplaceOrderActions
        order={order}
        isBuyer={false}
        canEditReview={false}
        actOnOrder={vi.fn(async () => true)}
      />,
    );
    expect(screen.getByRole('button', { name: 'Packing slip' })).toBeInTheDocument();
  });

  it('marks ready through commitMarkReady and reloads the timeline', async () => {
    const user = userEvent.setup();
    const { order, onChanged } = renderPickupActions({ state: 'paid', isBuyer: false });

    await user.click(screen.getByRole('button', { name: 'Mark ready for pickup' }));

    await waitFor(() => {
      expect(mockedController.commitMarkReady).toHaveBeenCalledWith(order.id, order.revision);
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it('offers the buyer Meeting point and Confirm handover from ready_for_pickup', () => {
    renderPickupActions({ state: 'ready_for_pickup', isBuyer: true });

    expect(screen.getByRole('button', { name: 'Meeting point' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm handover' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel order' })).toBeInTheDocument();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Meeting point',
      'Confirm handover',
      'Cancel order',
    ]);
  });

  it('withholds the meeting-point reveal once the order is terminal (§A3)', () => {
    // A delivered pickup order is NOT terminal — the buyer may still need the
    // pinned meeting point (a return is still possible).
    renderPickupActions({ state: 'delivered', isBuyer: true });
    expect(screen.getByRole('button', { name: 'Meeting point' })).toBeInTheDocument();
  });

  it('hides the reveal on a cancelled pickup order — the entitlement ended at the cancel (§A3)', () => {
    // The order keeps its payment receipt — the gate is the terminal state,
    // not the receipt, per the reveal cutoff.
    renderPickupActions({ state: 'delivered', isBuyer: true, overrides: { state: 'cancelled' } });
    expect(screen.queryByRole('button', { name: 'Meeting point' })).not.toBeInTheDocument();
  });

  it('warns the buyer before confirm — only once the item is in their hands', async () => {
    const user = userEvent.setup();
    renderPickupActions({ state: 'ready_for_pickup', isBuyer: true });

    await user.click(screen.getByRole('button', { name: 'Confirm handover' }));
    expect(screen.getByText('Only confirm once the item is in your hands.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm handover' }));
    await waitFor(() => {
      expect(mockedController.commitConfirmPickup).toHaveBeenCalled();
    });
  });

  it('carries the seller-attested wording on the seller confirm', async () => {
    const user = userEvent.setup();
    renderPickupActions({ state: 'paid', isBuyer: false });

    await user.click(screen.getByRole('button', { name: 'Confirm handover' }));
    expect(screen.getByText(/A handover you confirm yourself counts toward your reputation/)).toBeInTheDocument();
  });

  it('renders the seller-actor terms-change refusal as an explanation, not an error toast', async () => {
    pickupControllerState.confirmResponse = {
      ok: false,
      error: {
        code: 'INVALID_STATE',
        message:
          'The pickup terms changed after payment; the seller cannot confirm the handover until the buyer has seen the change.',
      },
    };
    const user = userEvent.setup();
    renderPickupActions({ state: 'ready_for_pickup', isBuyer: false });

    await user.click(screen.getByRole('button', { name: 'Confirm handover' }));
    await user.click(screen.getByRole('button', { name: 'Confirm handover' }));

    expect(
      await screen.findByText(/Until the buyer has seen the change, only the buyer can confirm the handover/),
    ).toBeInTheDocument();
  });

  it('states that cancelling moves no money on the pickup cancel dialog, and confirms the unilateral exit', async () => {
    const user = userEvent.setup();
    renderPickupActions({ state: 'paid', isBuyer: true, overrides: { pickupTermsChanged: true } });

    await user.click(screen.getByRole('button', { name: 'Cancel order' }));
    expect(screen.getByRole('heading', { name: 'Cancel order' })).toBeInTheDocument();
    expect(screen.getByText(/Cancelling moves no money/)).toBeInTheDocument();
    expect(screen.getByTestId('dialog-content')).toHaveClass('max-w-lg');

    await user.type(screen.getByLabelText('Reason'), 'The new spot is unreachable for me');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(mockedController.executeMarketplaceCommand).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'order.cancel_request' }),
      );
    });
    const { toast } = await import('@/molecules/Toaster/use-toast');
    expect(toast).toHaveBeenCalledWith({ title: 'Order cancelled' });
  });

  it('asks for seller approval on the pickup cancel dialog while no unilateral exit is open', async () => {
    const user = userEvent.setup();
    renderPickupActions({ state: 'paid', isBuyer: true });

    await user.click(screen.getByRole('button', { name: 'Cancel order' }));
    expect(screen.getByText(/Cancelling moves no money/)).toBeInTheDocument();
  });

  it('confirms a cancelled pickup order with the completed-cancellation toast', async () => {
    const { toast } = await import('@/molecules/Toaster/use-toast');
    const user = userEvent.setup();
    renderPickupActions({ state: 'paid', isBuyer: true });

    await user.click(screen.getByRole('button', { name: 'Cancel order' }));
    await user.type(screen.getByLabelText('Reason'), 'The spot does not work for me');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: 'Order cancelled' }));
  });

  it('reports a cancel_requested pickup outcome as a cancellation request', async () => {
    pickupControllerState.cancelResponse = {
      ok: true,
      result: { kind: 'order', order: { state: 'cancel_requested' } },
    };
    const { toast } = await import('@/molecules/Toaster/use-toast');
    const user = userEvent.setup();
    renderPickupActions({ state: 'paid', isBuyer: true, overrides: { firstRevealedAt: '2026-08-19T21:00:00.000Z' } });

    await user.click(screen.getByRole('button', { name: 'Cancel order' }));
    await user.type(screen.getByLabelText('Reason'), 'The spot does not work for me');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        variant: 'info',
        title: 'Cancellation requested',
      }),
    );
  });

  it('uses the shared compact cancellation dialog and the cancelled toast for an unpaid shipping checkout', async () => {
    const order = createOrderFixture('pending_payment', { fulfillment: 'shipping' });
    const actOnOrder = vi.fn(async () => true);
    const user = userEvent.setup();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    render(<MarketplaceOrderActions order={order} isBuyer canEditReview={false} actOnOrder={actOnOrder} />);

    await user.click(screen.getByRole('button', { name: 'Cancel checkout' }));
    expect(screen.getByRole('heading', { name: 'Cancel checkout' })).toBeInTheDocument();
    expect(screen.getByText(/Cancelling moves no money/)).toBeInTheDocument();
    expect(screen.getByTestId('dialog-content')).toHaveClass('m-6', 'rounded-xl', 'w-full', 'max-w-lg');
    expect(screen.getByTestId('dialog-content')).not.toHaveClass('sm:max-w-[calc(100vw-2rem)]');

    await user.type(screen.getByLabelText('Reason'), 'No longer needed');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() =>
      expect(actOnOrder).toHaveBeenCalledWith(order, 'order.cancel_request', { reason: 'No longer needed' }),
    );
    const { toast } = await import('@/molecules/Toaster/use-toast');
    // An unpaid checkout is cancelled at once (#348).
    expect(toast).toHaveBeenCalledWith({ title: 'Checkout cancelled' });
  });
});

describe('MarketplaceOrderActions digital orders (digital delivery design §6 E1–E4)', () => {
  function renderDigital(state: 'paid' | 'delivered' | 'completed', isBuyer: boolean) {
    const order = createOrderFixture(state, { fulfillment: 'digital' });
    render(
      <MarketplaceOrderActions
        order={order}
        isBuyer={isBuyer}
        canEditReview={false}
        actOnOrder={vi.fn(async () => true)}
      />,
    );
  }

  it('offers the buyer no return on a delivered digital order, and says why (E4)', () => {
    renderDigital('delivered', true);

    expect(screen.queryByRole('button', { name: 'Request return' })).not.toBeInTheDocument();
    expect(screen.getByTestId('digital-no-return-note')).toHaveTextContent(
      "Digital purchases can't be returned. Message the seller about a refund.",
    );
  });

  it('offers the seller no tracking, label or packing slip on a digital order (E1)', () => {
    renderDigital('paid', false);

    expect(screen.queryByRole('button', { name: 'Mark shipped' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Packing slip' })).not.toBeInTheDocument();
  });

  it('keeps Request return on a delivered shipped order', () => {
    const order = createOrderFixture('delivered', { fulfillment: 'shipping' });
    render(
      <MarketplaceOrderActions order={order} isBuyer canEditReview={false} actOnOrder={vi.fn(async () => true)} />,
    );

    expect(screen.getByRole('button', { name: 'Request return' })).toBeInTheDocument();
    expect(screen.queryByTestId('digital-no-return-note')).not.toBeInTheDocument();
  });
});

describe('MarketplaceOrderActions return policy', () => {
  function renderBuyer(overrides: Partial<MarketplaceOrder>) {
    const order = createOrderFixture('completed', { fulfillment: 'shipping', ...overrides });
    render(
      <MarketplaceOrderActions order={order} isBuyer canEditReview={false} actOnOrder={vi.fn(async () => true)} />,
    );
  }

  it('offers no return on a final sale and says why', () => {
    renderBuyer({ returnPolicy: { acceptsReturns: false, returnWindowDays: null } });

    expect(screen.queryByRole('button', { name: 'Request return' })).not.toBeInTheDocument();
    expect(screen.getByTestId('return-closed-note')).toHaveTextContent(
      "Final sale: the seller doesn't accept returns on this item.",
    );
  });

  it('offers no return after the return window', async () => {
    renderBuyer({ returnPolicy: { acceptsReturns: true, returnWindowDays: 14 } });

    expect(await screen.findByTestId('return-closed-note')).toHaveTextContent(
      'The return window for this order has closed.',
    );
    expect(screen.queryByRole('button', { name: 'Request return' })).not.toBeInTheDocument();
  });

  it('keeps Request return inside the window', () => {
    vi.useFakeTimers({ now: new Date('2026-08-20T12:00:00.000Z'), toFake: ['Date'] });
    try {
      renderBuyer({ returnPolicy: { acceptsReturns: true, returnWindowDays: 14 } });
    } finally {
      vi.useRealTimers();
    }

    expect(screen.getByRole('button', { name: 'Request return' })).toBeInTheDocument();
    expect(screen.queryByTestId('return-closed-note')).not.toBeInTheDocument();
  });
});

describe('MarketplaceOrderActions digital orders in an inconsistent shipped state (review P2)', () => {
  it('offers no Confirm delivery on a digital order projected as shipped', () => {
    render(
      <MarketplaceOrderActions
        order={createOrderFixture('shipped', { fulfillment: 'digital' })}
        isBuyer
        canEditReview={false}
        actOnOrder={vi.fn(async () => true)}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Confirm delivery' })).not.toBeInTheDocument();
  });

  it('keeps Confirm delivery on a shipped order', () => {
    render(
      <MarketplaceOrderActions
        order={createOrderFixture('shipped', { fulfillment: 'shipping' })}
        isBuyer
        canEditReview={false}
        actOnOrder={vi.fn(async () => true)}
      />,
    );

    expect(screen.getByRole('button', { name: 'Confirm delivery' })).toBeInTheDocument();
  });
});

describe('MarketplaceOrderActions shipment tracking', () => {
  const shippedWith = (carrier: string, trackingNumber: string) =>
    createOrderFixture('shipped', {
      fulfillment: 'shipping',
      shipment: { carrier, trackingNumber, state: 'shipped', shippedAt: '2026-08-14T10:00:00.000Z', deliveredAt: null },
    });

  const renderShipped = (order: MarketplaceOrder, isBuyer: boolean) =>
    render(
      <MarketplaceOrderActions
        order={order}
        isBuyer={isBuyer}
        canEditReview={false}
        actOnOrder={vi.fn(async () => true)}
        onChanged={vi.fn()}
      />,
    );

  it('offers the seller Add tracking on a shipped order with no number', () => {
    renderShipped(shippedWith('Other', ''), false);

    expect(screen.getByRole('button', { name: 'Add tracking' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark shipped' })).not.toBeInTheDocument();
  });

  it('offers the seller Edit tracking once a number is on the order', () => {
    renderShipped(shippedWith('UPS', '1Z999AA10123456784'), false);

    expect(screen.getByRole('button', { name: 'Edit tracking' })).toBeInTheDocument();
  });

  it('offers the buyer no tracking button', () => {
    renderShipped(shippedWith('Other', ''), true);
    expect(screen.queryByRole('button', { name: /tracking/i })).not.toBeInTheDocument();
  });

  it('lets the seller mark an order shipped with the tracking number left empty', async () => {
    const user = userEvent.setup();
    const actOnOrder = vi.fn(async () => true);
    render(
      <MarketplaceOrderActions
        order={createOrderFixture('paid', { fulfillment: 'shipping' })}
        isBuyer={false}
        canEditReview={false}
        actOnOrder={actOnOrder}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Mark shipped' }));
    expect(screen.getByLabelText('Tracking number (optional)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() =>
      expect(actOnOrder).toHaveBeenCalledWith(expect.anything(), 'fulfillment.ship', { carrier: 'USPS' }),
    );
  });
});

describe('MarketplaceOrderActions digital refunds and cancels (digital delivery design §6 E8, E9)', () => {
  const base = createOrderFixture('delivered');

  it.each(['delivered', 'completed'] as const)(
    'lets the seller record a refund on a %s digital order, and says what it changes (E9)',
    async (state) => {
      const { toast } = await import('@/molecules/Toaster/use-toast');
      const order = createOrderFixture(state, { fulfillment: 'digital', paymentMethod: 'bitcoin' });
      const actOnOrder = vi.fn(async () => true);
      render(<MarketplaceOrderActions order={order} isBuyer={false} canEditReview={false} actOnOrder={actOnOrder} />);

      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Record refund' }));
      await user.type(screen.getByLabelText('External Bitcoin transaction reference'), 'txid-digital-refund');
      await user.click(screen.getByRole('button', { name: 'Confirm' }));

      await waitFor(() =>
        expect(actOnOrder).toHaveBeenCalledWith(order, 'refund.record_external', expect.objectContaining({})),
      );
      expect(vi.mocked(toast)).toHaveBeenCalledWith({
        variant: 'info',
        title: "Refund recorded. The buyer can no longer download. An email already sent can't be recalled.",
      });
    },
  );

  it('offers no refund record on a delivered shipped order', () => {
    render(
      <MarketplaceOrderActions
        order={createOrderFixture('delivered', { fulfillment: 'shipping' })}
        isBuyer={false}
        canEditReview={false}
        actOnOrder={vi.fn(async () => true)}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Record refund' })).not.toBeInTheDocument();
  });

  it('tells the seller opened files stay sold before approving a cancel (E8)', () => {
    const order = createOrderFixture('cancel_requested', {
      fulfillment: 'digital',
      lines: [{ ...base.lines[0], fulfillment: 'digital', digitalKind: 'file' }],
    });
    render(
      <MarketplaceOrderActions
        order={order}
        isBuyer={false}
        canEditReview={false}
        actOnOrder={vi.fn(async () => true)}
      />,
    );

    expect(screen.getByRole('button', { name: 'Approve cancellation' })).toBeInTheDocument();
    expect(screen.getByTestId('digital-opened-stay-sold')).toHaveTextContent('Opened files stay counted as sold.');
  });

  it('says nothing about opened files on a cancel with no instant line', () => {
    const order = createOrderFixture('cancel_requested', {
      fulfillment: 'digital',
      lines: [{ ...base.lines[0], fulfillment: 'digital', digitalKind: 'email' }],
    });
    render(
      <MarketplaceOrderActions
        order={order}
        isBuyer={false}
        canEditReview={false}
        actOnOrder={vi.fn(async () => true)}
      />,
    );

    expect(screen.queryByTestId('digital-opened-stay-sold')).not.toBeInTheDocument();
  });
});

describe('MarketplaceOrderActions USDT refund recording', () => {
  const destination = {
    address: REFUND_FIXTURE_ADDRESS,
    network: 'arbitrum-one' as const,
    asset: 'USDT' as const,
    source: 'buyer_entered',
    confirmedAt: '2026-10-09T16:00:00.000Z',
  };

  it('holds Record refund until the buyer confirmed an address', () => {
    render(
      <MarketplaceOrderActions
        order={createUsdtOrderFixture('return_received')}
        isBuyer={false}
        canEditReview={false}
        actOnOrder={vi.fn(async () => true)}
      />,
    );

    expect(screen.getByRole('button', { name: 'Record refund' })).toBeDisabled();
    expect(screen.getByTestId('usdt-refund-address-hint')).toHaveTextContent(
      "Ask the buyer to confirm a refund address first. It's on their order page.",
    );
  });

  it('records the lowercase Arbitrum hash with the destination and parity amount shown', async () => {
    const order = createUsdtOrderFixture('return_received', { refundDestination: destination });
    const actOnOrder = vi.fn(async () => true);
    render(<MarketplaceOrderActions order={order} isBuyer={false} canEditReview={false} actOnOrder={actOnOrder} />);
    const user = userEvent.setup();

    expect(screen.queryByTestId('usdt-refund-address-hint')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Record refund' }));
    expect(screen.getByTestId('refund-usdt-destination')).toHaveTextContent(REFUND_FIXTURE_ADDRESS);
    expect(screen.getByTestId('refund-usdt-destination')).toHaveTextContent('Amount to send: 137.000000 USDT');
    expect(
      within(screen.getByTestId('refund-usdt-destination')).getByRole('link', { name: 'Look up address on Arbiscan' }),
    ).toHaveAttribute('href', `https://arbiscan.io/address/${REFUND_FIXTURE_ADDRESS.toLowerCase()}`);

    await user.type(screen.getByLabelText('Arbitrum transaction hash'), 'not-a-hash');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(
      await screen.findByText('Enter the Arbitrum transaction hash (0x followed by 64 characters).'),
    ).toBeInTheDocument();
    expect(actOnOrder).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText('Arbitrum transaction hash'));
    await user.type(
      screen.getByLabelText('Arbitrum transaction hash'),
      REFUND_FIXTURE_TX_HASH.toUpperCase().replace('0X', '0x'),
    );
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(actOnOrder).toHaveBeenCalledWith(order, 'refund.record_external', {
        amountMinor: 13_700,
        transactionId: REFUND_FIXTURE_TX_HASH,
      }),
    );
  });

  it('does not touch a Bitcoin refund: no hold, free-form evidence', () => {
    render(
      <MarketplaceOrderActions
        order={createOrderFixture('return_received', { paymentMethod: 'bitcoin' })}
        isBuyer={false}
        canEditReview={false}
        actOnOrder={vi.fn(async () => true)}
      />,
    );
    expect(screen.getByRole('button', { name: 'Record refund' })).toBeEnabled();
    expect(screen.queryByTestId('usdt-refund-address-hint')).not.toBeInTheDocument();
  });
});

describe('MarketplaceOrderActions Paykit cancel', () => {
  it('warns about the leftover Bitkit request while no payment is seen', async () => {
    const user = userEvent.setup();
    render(
      <MarketplaceOrderActions
        order={createOrderFixture('pending_payment', { paymentMethod: 'paykit', paykitRequestState: 'pending' })}
        isBuyer
        canEditReview={false}
        actOnOrder={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Cancel checkout' }));
    expect(screen.getByTestId('paykit-cancel-unpaid-request')).toBeInTheDocument();
  });

  it.each(['detected', 'awaiting_seller_confirmation', 'confirmed'] as const)(
    'offers no Cancel checkout once the request reads %s (#345)',
    (paykitRequestState) => {
      render(
        <MarketplaceOrderActions
          order={createOrderFixture('pending_payment', { paymentMethod: 'paykit', paykitRequestState })}
          isBuyer
          canEditReview={false}
          actOnOrder={vi.fn()}
          onChanged={vi.fn()}
        />,
      );

      expect(screen.queryByRole('button', { name: 'Cancel checkout' })).not.toBeInTheDocument();
    },
  );

  it('closes the cancel dialog when a re-read shows a payment was seen (#347)', async () => {
    const user = userEvent.setup();
    const props = { isBuyer: true, canEditReview: false, actOnOrder: vi.fn(), onChanged: vi.fn() };
    const { rerender } = render(
      <MarketplaceOrderActions
        order={createOrderFixture('pending_payment', { paymentMethod: 'paykit', paykitRequestState: 'pending' })}
        {...props}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Cancel checkout' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    rerender(
      <MarketplaceOrderActions
        order={createOrderFixture('pending_payment', { paymentMethod: 'paykit', paykitRequestState: 'detected' })}
        {...props}
      />,
    );

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('says an unpaid pickup checkout is cancelled, like a shipping one (#348)', async () => {
    const user = userEvent.setup();
    const { toast } = await import('@/molecules/Toaster/use-toast');
    vi.mocked(toast).mockClear();
    mockedController.executeMarketplaceCommand.mockResolvedValueOnce({
      ok: true,
      result: { kind: 'order', order: { state: 'cancelled' } },
    } as never);
    render(
      <MarketplaceOrderActions
        order={createOrderFixture('pending_payment', { fulfillment: 'pickup', paymentMethod: 'paypal' })}
        isBuyer
        canEditReview={false}
        actOnOrder={vi.fn(async () => true)}
        onChanged={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Cancel checkout' }));
    await user.type(within(screen.getByRole('dialog')).getByRole('textbox'), 'Changed my mind');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: 'Checkout cancelled' }));
  });

  it('says an unpaid checkout is cancelled, not that cancellation was requested (#348)', async () => {
    const user = userEvent.setup();
    const { toast } = await import('@/molecules/Toaster/use-toast');
    vi.mocked(toast).mockClear();
    render(
      <MarketplaceOrderActions
        order={createOrderFixture('pending_payment', { paymentMethod: 'paykit', paykitRequestState: 'pending' })}
        isBuyer
        canEditReview={false}
        actOnOrder={vi.fn(async () => true)}
        onChanged={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Cancel checkout' }));
    await user.type(within(screen.getByRole('dialog')).getByRole('textbox'), 'Changed my mind');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: 'Checkout cancelled' }));
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Cancellation requested' }));
  });
});
