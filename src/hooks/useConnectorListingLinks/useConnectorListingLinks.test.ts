import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListingLinkResult } from '@/application/connectors/connectors';
import { CommerceController } from '@/controllers/commerce/commerce';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import type { ConnectorCatalogProduct } from '@/libs/commerce/connectors';
import { toast } from '@/molecules/Toaster/use-toast';
import { createCommerceListingFixture } from '@/test/fixtures/commerce/commerce';
import { connectorRefusal } from '@/test-utils/connector-errors';
import { connectionFixture } from '@/test-utils/connector-fixtures';
import { asOpaque } from '@/test-utils/type-assertions';
import { useConnectorListingLinks } from './useConnectorListingLinks';

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: { currentUserPubky: string }) => unknown) =>
    selector({ currentUserPubky: 'y'.repeat(52) }),
}));

vi.mock('@/controllers/connectors/connectors', () => ({
  ConnectorsController: { commitAutoLinkListings: vi.fn(), commitLinkListing: vi.fn() },
}));

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: { getListingsBySeller: vi.fn() },
}));

vi.mock('@/molecules/Toaster/use-toast', () => ({ toast: vi.fn() }));

const connection = connectionFixture({
  id: 'c1',
  provider: 'shopify',
  domain: 'john.myshopify.com',
  status: 'connected',
  scopes: [],
});

const record = createCommerceListingFixture();
const scarf = { listing_id: 'scarf', record };

const product: ConnectorCatalogProduct = {
  providerProductId: 'gid://shopify/Product/1',
  title: 'Scarf',
  options: [],
  imageUrls: [],
  selected: false,
  variants: [
    {
      providerVariantId: 'gid://shopify/ProductVariant/11',
      optionValues: [],
      price: { amountMinor: 2500, currency: 'USD', exponent: 2 },
    },
  ],
};

function result(overrides: Partial<ListingLinkResult> = {}): ListingLinkResult {
  return {
    linked: [],
    unlinked: [{ listingId: 'scarf', title: record.title, reason: 'no_match' }],
    products: [product],
    resent: 0,
    ...overrides,
  };
}

describe('useConnectorListingLinks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(CommerceController.getListingsBySeller).mockResolvedValue(
      asOpaque<Awaited<ReturnType<typeof CommerceController.getListingsBySeller>>>([scarf]),
    );
  });

  it('links what matches as the page opens, says so, and lists the rest', async () => {
    vi.mocked(ConnectorsController.commitAutoLinkListings).mockResolvedValue(
      result({
        linked: [
          {
            listingId: 'tee',
            title: 'Tee',
            basis: 'sku',
            providerProductId: 'p',
            productTitle: 'Tee',
            mappings: [],
          },
        ],
        resent: 2,
      }),
    );
    const { result: hook } = renderHook(() => useConnectorListingLinks(connection));

    await waitFor(() => expect(hook.current.state.status).toBe('ready'));
    expect(ConnectorsController.commitAutoLinkListings).toHaveBeenCalledWith(connection, [
      expect.objectContaining({ listingId: 'scarf' }),
    ]);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '1 listing linked to Shopify',
        description: expect.stringContaining('2 orders that were not sent went again.'),
      }),
    );
    const state = hook.current.state;
    expect(state.status === 'ready' && state.unlinked.map((row) => row.listing.listingId)).toEqual(['scarf']);
  });

  it('does nothing for a connection that is not live', () => {
    renderHook(() => useConnectorListingLinks({ ...connection, status: 'draft' }));
    expect(ConnectorsController.commitAutoLinkListings).not.toHaveBeenCalled();
  });

  it('shows a failed check instead of saying nothing', async () => {
    vi.mocked(ConnectorsController.commitAutoLinkListings).mockRejectedValue(
      connectorRefusal('provider_rate_limited', 429),
    );
    const { result: hook } = renderHook(() => useConnectorListingLinks(connection));
    await waitFor(() => expect(hook.current.state.status).toBe('failed'));
    const state = hook.current.state;
    expect(state.status === 'failed' && state.message).toBe('The store is busy. Wait a minute, then try again.');
  });

  it('links a listing by hand and takes it off the list', async () => {
    vi.mocked(ConnectorsController.commitAutoLinkListings).mockResolvedValue(result());
    vi.mocked(ConnectorsController.commitLinkListing).mockResolvedValue({ linked: true, resent: 1 });
    const { result: hook } = renderHook(() => useConnectorListingLinks(connection));
    await waitFor(() => expect(hook.current.state.status).toBe('ready'));
    const state = hook.current.state;
    if (state.status !== 'ready') throw new Error('not ready');
    const [row] = state.unlinked;
    if (!row) throw new Error('no row');
    const variantId = row.listing.variants[0]?.id ?? '';

    await act(async () => {
      await hook.current.linkByHand(row.listing, product, { [variantId]: 'gid://shopify/ProductVariant/11' });
    });

    expect(ConnectorsController.commitLinkListing).toHaveBeenCalledWith('c1', [
      expect.objectContaining({
        listingId: 'scarf',
        variantId,
        providerVariantId: 'gid://shopify/ProductVariant/11',
      }),
    ]);
    const next = hook.current.state;
    expect(next.status === 'ready' && next.unlinked).toEqual([]);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Linked to Scarf' }));
  });
});
