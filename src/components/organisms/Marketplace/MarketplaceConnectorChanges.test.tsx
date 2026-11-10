import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectorChangesState, ReviewItem } from '@/hooks/useConnectorChanges/useConnectorChanges';
import type { ConnectorProductChange } from '@/libs/commerce/connectors';
import { changeState, evaluateChangeListings } from '@/pipes/commerce/connector-change-apply';
import { createCommerceListingFixture } from '@/test/fixtures/commerce/commerce';
import { bootsFollowingTheStore, recordedChange, withLinkedVariantIds } from '@/test-utils/connector-changes';
import { MarketplaceConnectorChanges } from './MarketplaceConnectorChanges';

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: { currentUserPubky: string }) => unknown) =>
    selector({ currentUserPubky: 'y'.repeat(52) }),
}));

const V1 = 'gid://shopify/ProductVariant/50001';
const connection = { id: 'c1', domain: 'demo.myshopify.com', provider: 'shopify' as const };

function itemFor(
  change: ConnectorProductChange,
  record = bootsFollowingTheStore(),
  failure: ReviewItem['failure'] = null,
): ReviewItem {
  const linked = withLinkedVariantIds(change, { [V1]: 'variant_01' });
  const verdicts = evaluateChangeListings(linked, new Map([['boots_01', record]]));
  const state = changeState(verdicts);
  if (state === 'nothing_to_do') throw new Error('nothing to review');
  return {
    change: linked,
    verdicts,
    state,
    titles: { boots_01: record.title },
    variantLabels: { boots_01: { variant_01: '' } },
    failure,
  };
}

function changesFor(state: ConnectorChangesState, workingId: string | null = null) {
  return {
    state,
    workingId,
    refresh: vi.fn(async () => {}),
    apply: vi.fn(async () => {}),
    dismiss: vi.fn(async () => {}),
    detach: vi.fn(async () => {}),
  };
}

describe('MarketplaceConnectorChanges', () => {
  it('lists a price change with what it does and applies it on a tap', async () => {
    const item = itemFor(recordedChange('price'));
    const changes = changesFor({ status: 'ready', items: [item], unsettled: 0, capped: false });
    render(<MarketplaceConnectorChanges connection={connection} changes={changes} />);

    expect(screen.getByRole('heading', { name: 'Shopify changes (1)' })).toBeInTheDocument();
    expect(screen.getByText('Price: $125.00 to $130.00')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Apply price' }));
    expect(changes.apply).toHaveBeenCalledWith(item);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(changes.dismiss).toHaveBeenCalledWith(item);
  });

  it('shows both sides of a conflict and offers the store’s value, the listing’s, or detaching', async () => {
    const item = itemFor(recordedChange('content'), bootsFollowingTheStore({ title: 'My own title' }));
    const changes = changesFor({ status: 'ready', items: [item], unsettled: 0, capped: false });
    render(<MarketplaceConnectorChanges connection={connection} changes={changes} />);

    const conflict = screen.getByTestId('store-change-conflict');
    expect(within(conflict).getByText('Yours: My own title')).toBeInTheDocument();
    expect(within(conflict).getByText('Your store: Trail Boots II')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^Use the store/ }));
    expect(changes.apply).toHaveBeenCalledWith(item, { takeStore: true });
    await userEvent.click(screen.getByRole('button', { name: 'Keep mine' }));
    expect(changes.dismiss).toHaveBeenCalledWith(item);
    await userEvent.click(screen.getByRole('button', { name: 'Stop following the store for this listing' }));
    expect(changes.detach).toHaveBeenCalledWith(item, 'boots_01');
  });

  it('sends a new store variant to the import flow', () => {
    const change = {
      id: 'c-variants',
      providerProductId: 'gid://shopify/Product/9001',
      fieldGroup: 'variants',
      base: { options: [], variants: [{ providerVariantId: V1, title: 'Default', sku: null, optionValues: [] }] },
      proposed: {
        options: [],
        variants: [
          { providerVariantId: V1, title: 'Default', sku: null, optionValues: [] },
          { providerVariantId: 'gid://shopify/ProductVariant/50003', title: 'Large', sku: null, optionValues: [] },
        ],
      },
      proposedHash: 'a'.repeat(64),
      detectedAt: '2026-08-19T22:00:00.000Z',
      updatedAt: '2026-08-19T22:00:00.000Z',
      listings: [
        { listingId: 'boots_01', direction: 'from_store', variants: [{ variantId: '', providerVariantId: V1 }] },
      ],
    } as ConnectorProductChange;
    render(
      <MarketplaceConnectorChanges
        connection={connection}
        changes={changesFor({ status: 'ready', items: [itemFor(change)], unsettled: 0, capped: false })}
      />,
    );

    expect(screen.getByText(/new in your store, Large/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Import it' })).toHaveAttribute(
      'href',
      expect.stringContaining('/marketplace/settings/store-connections/c1'),
    );
  });

  it('says why a change cannot be applied, and why a tapped one failed', () => {
    const euros = {
      ...recordedChange('price'),
      proposed: { variants: [{ providerVariantId: V1, amountMinor: 1000, currency: 'EUR', exponent: 2 }] },
    } as ConnectorProductChange;
    render(
      <MarketplaceConnectorChanges
        connection={connection}
        changes={changesFor({
          status: 'ready',
          items: [itemFor(euros, undefined, 'unconfirmed')],
          unsettled: 0,
          capped: false,
        })}
      />,
    );

    expect(screen.getByText(/different currency/)).toBeInTheDocument();
    expect(screen.getByTestId('store-change-failure')).toHaveTextContent('has not confirmed the update');
    expect(screen.queryByRole('button', { name: 'Apply price' })).not.toBeInTheDocument();
  });

  it('offers to pause again, not to make active, when an automatic pause did not go through', () => {
    const change = recordedChange('status');
    const mug = createCommerceListingFixture({ listingId: 'mug_01' });
    const verdicts = evaluateChangeListings(change, new Map([['mug_01', mug]]));
    const item: ReviewItem = {
      change,
      verdicts,
      state: 'applicable',
      titles: { mug_01: mug.title },
      variantLabels: {},
      failure: 'unconfirmed',
    };
    render(
      <MarketplaceConnectorChanges
        connection={connection}
        changes={changesFor({ status: 'ready', items: [item], unsettled: 0, capped: false })}
      />,
    );

    expect(screen.getByRole('button', { name: 'Pause listing' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Make active' })).not.toBeInTheDocument();
  });

  it('says how many changes could not be confirmed yet, even when none is left to review, and retries', async () => {
    const changes = changesFor({ status: 'ready', items: [], unsettled: 2, capped: false });
    render(<MarketplaceConnectorChanges connection={connection} changes={changes} />);

    expect(screen.getByRole('heading', { name: 'Shopify changes' })).toBeInTheDocument();
    expect(screen.getByTestId('store-changes-unsettled')).toHaveTextContent('2 changes could not be checked');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(changes.refresh).toHaveBeenCalled();
  });

  it('disables the buttons of the change being applied', () => {
    const item = itemFor(recordedChange('price'));
    render(
      <MarketplaceConnectorChanges
        connection={connection}
        changes={changesFor({ status: 'ready', items: [item], unsettled: 0, capped: false }, item.change.id)}
      />,
    );

    expect(screen.getByRole('button', { name: 'Apply price' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeDisabled();
  });

  it('names a failed load and retries it', async () => {
    const changes = changesFor({ status: 'failed', message: 'Your store changes could not be loaded.' });
    render(<MarketplaceConnectorChanges connection={connection} changes={changes} />);

    expect(screen.getByRole('alert')).toHaveTextContent('could not be loaded');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(changes.refresh).toHaveBeenCalled();
  });

  it.each([
    ['nothing to review', { status: 'ready', items: [], unsettled: 0, capped: false } as ConnectorChangesState],
    ['loading', { status: 'loading' } as ConnectorChangesState],
    ['unavailable', { status: 'unavailable' } as ConnectorChangesState],
  ])('renders nothing when %s', (_name, state) => {
    const { container } = render(<MarketplaceConnectorChanges connection={connection} changes={changesFor(state)} />);

    expect(container).toBeEmptyDOMElement();
  });
});
