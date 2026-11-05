import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKETPLACE_ROUTES } from '@/app/routes';
import { COMMERCE_FIXTURE_SELLER, createCommerceListingFixture } from '@/test/fixtures/commerce/commerce';
import { MarketplaceEditListing } from './MarketplaceEditListing';

const router = vi.hoisted(() => ({ push: vi.fn() }));
const editing = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const deleteFlow = vi.hoisted(() => ({
  open: false,
  request: vi.fn(async (_targets: unknown[]) => {}),
  onDeleted: undefined as undefined | ((keys: string[]) => void),
}));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/hooks/useEditMarketplaceListing/useEditMarketplaceListing', () => ({
  useEditMarketplaceListing: () => editing.value,
}));
vi.mock('@/hooks/useDeleteMarketplaceListings/useDeleteMarketplaceListings', () => ({
  useDeleteMarketplaceListings: ({ onDeleted }: { onDeleted?: (keys: string[]) => void } = {}) => {
    deleteFlow.onDeleted = onDeleted;
    return {
      open: deleteFlow.open,
      plan: null,
      isDeleting: false,
      hasHomeserverSession: true,
      request: deleteFlow.request,
      confirm: vi.fn(),
      cancel: vi.fn(),
    };
  },
}));
vi.mock('@/organisms/Marketplace/MarketplaceContentLayout', () => ({
  MarketplaceContentLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/organisms/Marketplace/MarketplaceListingForm', () => ({
  MarketplaceListingForm: ({ onSubmit }: { onSubmit: () => Promise<boolean> }) => (
    <button
      type="button"
      onClick={() => {
        void onSubmit().then((saved) => {
          formState.lastSaved = saved;
        });
      }}
    >
      Save changes
    </button>
  ),
}));
vi.mock('@/molecules/Marketplace/ListingPublishGuardNotice', () => ({ ListingPublishGuardNotice: () => null }));

const formState = vi.hoisted(() => ({ lastSaved: null as boolean | null }));

const record = createCommerceListingFixture({ listingId: 'boots' });

describe('MarketplaceEditListing delete', () => {
  beforeEach(() => {
    deleteFlow.request.mockClear();
    deleteFlow.open = false;
    formState.lastSaved = null;
    editing.value = {};
    router.push.mockClear();
  });

  it('offers Delete under the edit form and requests the listing being edited', () => {
    editing.value = { status: 'ready', ownedListing: record, publishBlocked: null, form: {}, media: {} };

    render(<MarketplaceEditListing sellerPubky={COMMERCE_FIXTURE_SELLER} listingId="boots" />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete listing' }));

    expect(deleteFlow.request).toHaveBeenCalledWith([
      { ownerPubky: record.ownerPubky, listingId: 'boots', title: record.title, record },
    ]);
  });

  it('returns to the seller studio once the listing is deleted', () => {
    editing.value = { status: 'ready', ownedListing: record, publishBlocked: null, form: {}, media: {} };

    render(<MarketplaceEditListing sellerPubky={COMMERCE_FIXTURE_SELLER} listingId="boots" />);
    deleteFlow.onDeleted?.([`${record.ownerPubky}:boots`]);

    expect(router.push).toHaveBeenCalledWith(MARKETPLACE_ROUTES.DASHBOARD);
  });

  it('still offers Delete for a listing the studio cannot edit', () => {
    editing.value = { status: 'unsupported', ownedListing: record };

    render(<MarketplaceEditListing sellerPubky={COMMERCE_FIXTURE_SELLER} listingId="boots" />);

    expect(screen.getByRole('heading', { name: 'This listing cannot be edited here' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete listing' })).toBeInTheDocument();
  });

  it('does not save while the delete confirmation is open', async () => {
    const submit = vi.fn(async () => 'boots');
    editing.value = { status: 'ready', ownedListing: record, publishBlocked: null, form: {}, media: {}, submit };
    deleteFlow.open = true;

    render(<MarketplaceEditListing sellerPubky={COMMERCE_FIXTURE_SELLER} listingId="boots" />);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes', hidden: true }));
    await vi.waitFor(() => expect(formState.lastSaved).toBe(false));

    expect(submit).not.toHaveBeenCalled();
  });

  it('saves normally when no delete is pending', async () => {
    const submit = vi.fn(async () => 'boots');
    editing.value = { status: 'ready', ownedListing: record, publishBlocked: null, form: {}, media: {}, submit };

    render(<MarketplaceEditListing sellerPubky={COMMERCE_FIXTURE_SELLER} listingId="boots" />);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await vi.waitFor(() => expect(formState.lastSaved).toBe(true));

    expect(submit).toHaveBeenCalledOnce();
  });

  it('offers no Delete before the listing has loaded', () => {
    editing.value = { status: 'loading', ownedListing: null };

    render(<MarketplaceEditListing sellerPubky={COMMERCE_FIXTURE_SELLER} listingId="boots" />);

    expect(screen.queryByRole('button', { name: 'Delete listing' })).not.toBeInTheDocument();
  });
});
