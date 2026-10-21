import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REVIEW_REMOVAL_COPY } from '@/config/commerce-copy';
import { CommerceController } from '@/controllers/commerce/commerce';
import type { CommerceReviewModelSchema } from '@/models/commerce/commerce.schema';
import { toast } from '@/molecules/Toaster/use-toast';
import { useAuthStore } from '@/stores/auth/auth.store';
import { createOrderFixture, ORDER_FIXTURE_BUYER, ORDER_FIXTURE_SELLER } from '@/test/fixtures/commerce/orders';
import { MarketplaceMyReviews } from './MarketplaceMyReviews';

vi.mock('@/molecules/Toaster/use-toast', () => ({ toast: vi.fn() }));

const order = createOrderFixture('completed', {
  reviews: [
    {
      id: '018f47d2-6a27-7c23-a49d-0000000000aa',
      reviewerPubky: ORDER_FIXTURE_BUYER,
      subjectPubky: ORDER_FIXTURE_SELLER,
      rating: 5,
      text: 'Accurate and fast.',
      createdAt: '2026-08-21T10:00:00.000Z',
    },
  ],
});

function ownReview(text: string): CommerceReviewModelSchema {
  return {
    id: `${ORDER_FIXTURE_BUYER}:REVIEW1`,
    owner_id: ORDER_FIXTURE_BUYER,
    review_id: 'REVIEW1',
    order_id: order.id,
    subject_id: ORDER_FIXTURE_SELLER,
    record: {
      schemaVersion: 1,
      recordType: 'review',
      ownerPubky: ORDER_FIXTURE_BUYER,
      revision: 1,
      createdAt: '2026-08-21T10:00:00.000Z',
      updatedAt: '2026-08-21T10:00:00.000Z',
      reviewId: 'REVIEW1',
      subjectPubky: ORDER_FIXTURE_SELLER,
      listingOwnerPubky: ORDER_FIXTURE_SELLER,
      listingId: 'boots',
      role: 'buyer_reviewing_seller',
      ratings: { overall: 5 },
      text,
      eligibilityAttestation: 'A'.repeat(32),
    },
    attestation_verified: true,
    attestation_iss: 'issuer',
    sync_status: 'synced',
    updated_at: 1,
  };
}

describe('MarketplaceMyReviews', () => {
  beforeEach(() => {
    useAuthStore.getState().setCurrentUserPubky(ORDER_FIXTURE_BUYER);
  });

  afterEach(() => {
    useAuthStore.getState().setCurrentUserPubky(null);
    vi.restoreAllMocks();
    vi.mocked(toast).mockClear();
  });

  it('shows the local rows first, then an edit made on another device once the homeserver read lands', async () => {
    const get = vi
      .spyOn(CommerceController, 'getOwnMarketplaceReviews')
      .mockResolvedValueOnce([ownReview('Before the edit.')])
      .mockResolvedValue([ownReview('Edited on my phone.')]);
    let finishRefresh = () => {};
    const refresh = vi.spyOn(CommerceController, 'refreshOwnMarketplaceReviews').mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          finishRefresh = () => resolve(1);
        }),
    );

    render(<MarketplaceMyReviews orders={[order]} />);

    expect(await screen.findByText('Before the edit.')).toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalledWith([order]));
    finishRefresh();
    expect(await screen.findByText('Edited on my phone.')).toBeInTheDocument();
    expect(screen.queryByText('Before the edit.')).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('reads the homeserver once per set of reviewed orders, not on every poll', async () => {
    vi.spyOn(CommerceController, 'getOwnMarketplaceReviews').mockResolvedValue([ownReview('Same.')]);
    const refresh = vi.spyOn(CommerceController, 'refreshOwnMarketplaceReviews').mockResolvedValue(0);

    const { rerender } = render(<MarketplaceMyReviews orders={[order]} />);
    await screen.findByText('Same.');
    rerender(<MarketplaceMyReviews orders={[{ ...order, revision: order.revision + 1 }]} />);

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('does not read the homeserver while no order carries a review of the user', async () => {
    vi.spyOn(CommerceController, 'getOwnMarketplaceReviews').mockResolvedValue([ownReview('Local only.')]);
    const refresh = vi.spyOn(CommerceController, 'refreshOwnMarketplaceReviews');

    render(<MarketplaceMyReviews orders={[createOrderFixture('completed')]} />);

    expect(await screen.findByText('Local only.')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('keeps the local rows when the homeserver read fails', async () => {
    vi.spyOn(CommerceController, 'getOwnMarketplaceReviews').mockResolvedValue([ownReview('Still here.')]);
    vi.spyOn(CommerceController, 'refreshOwnMarketplaceReviews').mockRejectedValue(new Error('offline'));

    render(<MarketplaceMyReviews orders={[order]} />);

    expect(await screen.findByText('Still here.')).toBeInTheDocument();
  });

  it('asks before removing, then removes the row and says so', async () => {
    vi.spyOn(CommerceController, 'getOwnMarketplaceReviews').mockResolvedValue([ownReview('Remove me.')]);
    vi.spyOn(CommerceController, 'refreshOwnMarketplaceReviews').mockResolvedValue(0);
    const remove = vi.spyOn(CommerceController, 'commitDeleteOwnMarketplaceReview').mockResolvedValue('removed');
    const user = userEvent.setup();

    render(<MarketplaceMyReviews orders={[order]} />);
    await user.click(await screen.findByRole('button', { name: REVIEW_REMOVAL_COPY.action }));

    expect(remove).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(REVIEW_REMOVAL_COPY.dialogTitle)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: REVIEW_REMOVAL_COPY.confirm }));

    await waitFor(() => expect(screen.queryByText('Remove me.')).not.toBeInTheDocument());
    expect(remove).toHaveBeenCalledWith(order.id);
    expect(toast).toHaveBeenCalledWith({ description: REVIEW_REMOVAL_COPY.removed });
  });

  it('keeps the review when the confirmation is cancelled', async () => {
    vi.spyOn(CommerceController, 'getOwnMarketplaceReviews').mockResolvedValue([ownReview('Keep me.')]);
    vi.spyOn(CommerceController, 'refreshOwnMarketplaceReviews').mockResolvedValue(0);
    const remove = vi.spyOn(CommerceController, 'commitDeleteOwnMarketplaceReview');
    const user = userEvent.setup();

    render(<MarketplaceMyReviews orders={[order]} />);
    await user.click(await screen.findByRole('button', { name: REVIEW_REMOVAL_COPY.action }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));

    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByText('Keep me.')).toBeInTheDocument();
  });

  it('says the homeserver deletion will retry when it did not go through', async () => {
    vi.spyOn(CommerceController, 'getOwnMarketplaceReviews').mockResolvedValue([ownReview('Queued.')]);
    vi.spyOn(CommerceController, 'refreshOwnMarketplaceReviews').mockResolvedValue(0);
    vi.spyOn(CommerceController, 'commitDeleteOwnMarketplaceReview').mockResolvedValue('queued');
    const user = userEvent.setup();

    render(<MarketplaceMyReviews orders={[order]} />);
    await user.click(await screen.findByRole('button', { name: REVIEW_REMOVAL_COPY.action }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: REVIEW_REMOVAL_COPY.confirm }),
    );

    await waitFor(() => expect(screen.queryByText('Queued.')).not.toBeInTheDocument());
    expect(toast).toHaveBeenCalledWith({ variant: 'warning', description: REVIEW_REMOVAL_COPY.queued });
  });

  it('keeps the row and shows an error when removing throws', async () => {
    vi.spyOn(CommerceController, 'getOwnMarketplaceReviews').mockResolvedValue([ownReview('Stays.')]);
    vi.spyOn(CommerceController, 'refreshOwnMarketplaceReviews').mockResolvedValue(0);
    vi.spyOn(CommerceController, 'commitDeleteOwnMarketplaceReview').mockRejectedValue(new Error('db'));
    const user = userEvent.setup();

    render(<MarketplaceMyReviews orders={[order]} />);
    await user.click(await screen.findByRole('button', { name: REVIEW_REMOVAL_COPY.action }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: REVIEW_REMOVAL_COPY.confirm }),
    );

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({ variant: 'error', description: REVIEW_REMOVAL_COPY.failed }),
    );
    expect(screen.getByText('Stays.')).toBeInTheDocument();
  });
});
