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
const editOptions = vi.hoisted(() => ({ value: undefined as unknown }));
const storeSync = vi.hoisted(() => ({
  value: {
    ready: true,
    failed: false,
    retry: vi.fn(),
    syncs: [] as unknown[],
    follows: { content: false, price: false, variants: false },
    saving: null,
    toggleOverride: vi.fn(),
  },
}));
type StoreSyncProps = {
  syncs: unknown[];
  onToggle: (connectionId: string, group: string) => void;
};
const formProps = vi.hoisted(() => ({
  value: {} as { publishGuardReady?: boolean; storeSync: StoreSyncProps },
}));

vi.mock('@/hooks/useEditMarketplaceListing/useEditMarketplaceListing', () => ({
  useEditMarketplaceListing: (_seller: string, _listing: string, options: unknown) => {
    editOptions.value = options;
    return editing.value;
  },
}));
vi.mock('@/hooks/useListingStoreSync/useListingStoreSync', () => ({
  useListingStoreSync: () => storeSync.value,
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
  MarketplaceListingForm: (props: {
    onSubmit: () => Promise<boolean>;
    publishGuardReady?: boolean;
    storeSync: StoreSyncProps;
  }) => {
    formProps.value = props;
    const { onSubmit } = props;
    return (
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
    );
  },
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
    storeSync.value = {
      ready: true,
      failed: false,
      retry: vi.fn(),
      syncs: [],
      follows: { content: false, price: false, variants: false },
      saving: null,
      toggleOverride: vi.fn(),
    };
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

describe('MarketplaceEditListing store sync', () => {
  const sync = {
    connectionId: 'c1',
    domain: 'demo.myshopify.com',
    editInStoreUrl: null,
    groups: {
      content: { follows: true, overridden: false },
      price: { follows: true, overridden: false },
      variants: { follows: true, overridden: false },
    },
  };

  beforeEach(() => {
    editing.value = {
      status: 'ready',
      ownedListing: record,
      publishBlocked: null,
      publishGuardReady: true,
      form: {},
      media: {},
      resetFollowedGroup: vi.fn(),
    };
  });

  it('tells the edit hook which parts follow the store and hands the form each linked store', () => {
    storeSync.value = { ...storeSync.value, syncs: [sync], follows: { content: true, price: false, variants: true } };

    render(<MarketplaceEditListing sellerPubky={COMMERCE_FIXTURE_SELLER} listingId="boots" />);

    expect(editOptions.value).toEqual({ follows: { content: true, price: false, variants: true } });
    expect(formProps.value.storeSync.syncs).toEqual([sync]);
  });

  it('holds the save until the linked stores have been asked, so no followed field is saved unknowingly', () => {
    storeSync.value = { ...storeSync.value, ready: false };

    render(<MarketplaceEditListing sellerPubky={COMMERCE_FIXTURE_SELLER} listingId="boots" />);

    expect(formProps.value.publishGuardReady).toBe(false);
  });

  it('says saving is paused when the store link could not be checked, and offers to try again', () => {
    const retry = vi.fn();
    storeSync.value = { ...storeSync.value, ready: false, failed: true, retry };

    render(<MarketplaceEditListing sellerPubky={COMMERCE_FIXTURE_SELLER} listingId="boots" />);

    expect(screen.getByTestId('edit-listing-store-sync-failed')).toHaveTextContent('Saving is paused');
    expect(formProps.value.publishGuardReady).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('puts the form back to the published values when a part follows the store again, and only then', async () => {
    storeSync.value = { ...storeSync.value, syncs: [sync] };
    vi.mocked(storeSync.value.toggleOverride)
      .mockResolvedValueOnce({ follows: true, overridden: false })
      .mockResolvedValueOnce({ follows: false, overridden: true })
      .mockResolvedValueOnce(null);
    render(<MarketplaceEditListing sellerPubky={COMMERCE_FIXTURE_SELLER} listingId="boots" />);
    const reset = (editing.value as { resetFollowedGroup: ReturnType<typeof vi.fn> }).resetFollowedGroup;

    formProps.value.storeSync.onToggle('c1', 'content');
    await vi.waitFor(() => expect(reset).toHaveBeenCalledWith('content'));
    formProps.value.storeSync.onToggle('c1', 'price');
    formProps.value.storeSync.onToggle('c1', 'variants');
    await vi.waitFor(() => expect(storeSync.value.toggleOverride).toHaveBeenCalledTimes(3));

    expect(reset).toHaveBeenCalledTimes(1);
  });
});
