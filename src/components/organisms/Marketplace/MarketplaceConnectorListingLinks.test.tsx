import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnectorListingLinks } from '@/hooks/useConnectorListingLinks/useConnectorListingLinks';
import type { ConnectorCatalogProduct } from '@/libs/commerce/connectors';
import { connectionFixture } from '@/test-utils/connector-fixtures';
import { asOpaque } from '@/test-utils/type-assertions';
import { listingLinksAnchorId, MarketplaceConnectorListingLinks } from './MarketplaceConnectorListingLinks';

vi.mock('@/hooks/useConnectorListingLinks/useConnectorListingLinks', () => ({ useConnectorListingLinks: vi.fn() }));
vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (select: (state: { currentUserPubky: string }) => unknown) =>
    select({ currentUserPubky: 'y'.repeat(52) }),
}));

const connection = connectionFixture({
  id: 'c1',
  provider: 'shopify',
  domain: 'john.myshopify.com',
  status: 'connected',
  scopes: [],
});

const tee: ConnectorCatalogProduct = {
  providerProductId: 'gid://shopify/Product/1',
  title: 'Organic tee',
  options: [],
  imageUrls: [],
  selected: false,
  variants: [
    {
      providerVariantId: 'gid://shopify/ProductVariant/11',
      sku: 'TEE-S',
      optionValues: [{ name: 'Size', value: 'S' }],
      price: { amountMinor: 2500, currency: 'USD', exponent: 2 },
    },
    {
      providerVariantId: 'gid://shopify/ProductVariant/12',
      sku: 'TEE-M',
      optionValues: [{ name: 'Size', value: 'M' }],
      price: { amountMinor: 2500, currency: 'USD', exponent: 2 },
    },
  ],
};

function links(overrides: Partial<ReturnType<typeof useConnectorListingLinks>> = {}) {
  const value = {
    state: {
      status: 'ready' as const,
      products: [tee],
      unlinked: [
        {
          listing: {
            listingId: 'my-tee',
            title: 'My tee',
            variants: [
              { id: 's', options: { Size: 'S' }, enabled: true },
              { id: 'big', options: { Size: 'Big' }, enabled: true },
            ],
          },
          reason: 'no_match' as const,
        },
      ],
    },
    linkingId: null,
    check: vi.fn().mockResolvedValue(true),
    linkByHand: vi.fn().mockResolvedValue(true),
    store: 'Shopify',
    ...overrides,
  };
  vi.mocked(useConnectorListingLinks).mockReturnValue(asOpaque<ReturnType<typeof useConnectorListingLinks>>(value));
  return value;
}

describe('MarketplaceConnectorListingLinks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  it('renders nothing while checking or when every listing is linked', () => {
    links({ state: { status: 'loading' } });
    const { container, rerender } = render(<MarketplaceConnectorListingLinks connection={connection} />);
    expect(container).toBeEmptyDOMElement();
    links({ state: { status: 'ready', unlinked: [], products: [tee] } });
    rerender(<MarketplaceConnectorListingLinks connection={connection} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says which listings are not linked, why, and what that means for their orders', () => {
    links();
    render(<MarketplaceConnectorListingLinks connection={connection} />);
    const card = screen.getByTestId('listing-links');
    expect(card).toHaveAttribute('id', listingLinksAnchorId('c1'));
    expect(card).toHaveTextContent('1 listing is not linked to john.myshopify.com');
    expect(card).toHaveTextContent('Orders for it are not sent to your Shopify store');
    const row = screen.getByTestId('listing-link-row-my-tee');
    expect(row).toHaveTextContent('My tee');
    expect(row).toHaveTextContent('No product in your store has the same SKU or handle.');
    expect(within(row).getByRole('button', { name: 'Link' })).toBeDisabled();
  });

  it('links a listing by hand once every variant has its store variant', async () => {
    const user = userEvent.setup();
    const value = links();
    render(<MarketplaceConnectorListingLinks connection={connection} />);

    await user.click(screen.getByRole('combobox', { name: 'Store product for My tee' }));
    await user.click(screen.getByRole('option', { name: 'Organic tee' }));
    const link = screen.getByRole('button', { name: 'Link' });
    expect(link).toBeDisabled();

    await user.click(screen.getByRole('combobox', { name: 'Store variant for Big' }));
    await user.click(screen.getByRole('option', { name: 'M (TEE-M)' }));
    await user.click(link);

    expect(value.linkByHand).toHaveBeenCalledWith(expect.objectContaining({ listingId: 'my-tee' }), tee, {
      s: 'gid://shopify/ProductVariant/11',
      big: 'gid://shopify/ProductVariant/12',
    });
  });

  it('shows a check that failed and checks again on request', async () => {
    const value = links({ state: { status: 'failed', message: 'Your store could not be reached.' } });
    render(<MarketplaceConnectorListingLinks connection={connection} />);
    expect(screen.getByTestId('listing-links-failed')).toHaveTextContent('Your store could not be reached.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Check again' }));
    expect(value.check).toHaveBeenCalled();
  });
});
