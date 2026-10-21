import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCommerceStore } from '@/stores/commerce/commerce.store';
import { useMarketplaceDisplayStore } from '@/stores/marketplace-display/marketplace-display.store';
import { setHeavySuiteBudgets } from '@/test-utils/load-budget';
import { collectMarketplaceCountryFacets, MarketplaceFilters } from './MarketplaceFilters';

setHeavySuiteBudgets();

describe('MarketplaceFilters', () => {
  beforeEach(() => {
    useCommerceStore.getState().reset();
    useMarketplaceDisplayStore.setState({ displayCurrency: 'USD' });
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('folds the dropdown filters behind a Filters toggle that counts the active ones', async () => {
    useCommerceStore.setState({ categoryId: null, countryCode: 'CH', sort: 'price_low' });
    render(<MarketplaceFilters resultCount={8} />);

    const toggle = screen.getByTestId('marketplace-filters-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAccessibleName('Filters, 2 active');
    const group = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    // Hidden on phones only; `sm:contents` keeps it on wider screens.
    expect(group).toHaveClass('hidden', 'sm:contents');

    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(group).toHaveClass('contents');
    expect(group).not.toHaveClass('hidden');
  });

  it('keeps the display currency picker out of the folded filters', () => {
    render(<MarketplaceFilters resultCount={8} />);

    const toggle = screen.getByTestId('marketplace-filters-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const group = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    const currency = screen.getByRole('combobox', { name: /^Display currency:/ });
    expect(group).not.toContainElement(currency);
    expect(currency).toBeVisible();
  });

  it('renders the designer filter controls around supplied search and sell controls', () => {
    render(
      <MarketplaceFilters
        resultCount={8}
        searchControl={<input aria-label="Filter market" />}
        sellControl={<button type="button">Sell an item</button>}
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Filter market' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sell an item' })).toBeInTheDocument();
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.getByText('Anywhere')).toBeInTheDocument();
    expect(screen.getByText('Newest')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Category' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Listing layout: Grid' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Display currency: US dollars' })).toBeInTheDocument();

    const triggers = screen.getAllByRole('combobox');
    expect(triggers).toHaveLength(5);
    for (const trigger of triggers) {
      expect(trigger).toHaveClass('font-semibold');
    }
    expect(screen.getByTestId('card')).toHaveClass('flex-wrap');
  });

  it('hides the payment filter when the deployment offers no payment options', () => {
    render(<MarketplaceFilters resultCount={8} />);
    expect(screen.queryByRole('combobox', { name: 'Payment method' })).not.toBeInTheDocument();
  });

  it('filters by an offered payment method and clears with the other filters', async () => {
    const user = userEvent.setup();
    render(<MarketplaceFilters resultCount={8} paymentMethodOptions={['bitcoin', 'usdt', 'paypal']} />);

    const trigger = screen.getByRole('combobox', { name: 'Payment method' });
    expect(trigger).toHaveTextContent('Any payment');
    await user.click(trigger);
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Any payment',
      'Bitcoin',
      'USDT',
      'PayPal',
    ]);
    await user.click(screen.getByRole('option', { name: 'PayPal' }));
    expect(useCommerceStore.getState().paymentMethod).toBe('paypal');

    await user.click(screen.getByRole('button', { name: 'Reset search and filters' }));
    expect(useCommerceStore.getState().paymentMethod).toBeNull();
  });

  it('keeps an active payment method listed after the deployment stops offering it, so it can be cleared', async () => {
    const user = userEvent.setup();
    useCommerceStore.getState().setPaymentMethod('usdt');
    render(<MarketplaceFilters resultCount={0} paymentMethodOptions={['bitcoin', 'paypal']} />);

    const trigger = screen.getByRole('combobox', { name: 'Payment method' });
    expect(trigger).toHaveTextContent('USDT');
    await user.click(trigger);
    await user.click(screen.getByRole('option', { name: 'Any payment' }));
    expect(useCommerceStore.getState().paymentMethod).toBeNull();
  });

  it('updates layout and display currency through compact selectors', async () => {
    const user = userEvent.setup();
    render(<MarketplaceFilters resultCount={8} />);

    await user.click(screen.getByRole('combobox', { name: 'Listing layout: Grid' }));
    await user.click(screen.getByRole('option', { name: 'List' }));
    expect(useCommerceStore.getState().layout).toBe('list');

    await user.click(screen.getByRole('combobox', { name: 'Display currency: US dollars' }));
    await user.click(screen.getByRole('option', { name: 'Bitcoin' }));
    expect(useMarketplaceDisplayStore.getState().displayCurrency).toBe('BTC');
  });

  it('starts on the currency the browser language suggests when the buyer has not chosen', () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['de-CH', 'de']);
    useMarketplaceDisplayStore.setState({ displayCurrency: null });

    render(<MarketplaceFilters resultCount={8} />);

    expect(screen.getByRole('combobox', { name: 'Display currency: Swiss francs' })).toHaveTextContent('CHF');
    vi.restoreAllMocks();
  });

  it('keeps an explicit choice over the browser language', () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['de-CH']);
    useMarketplaceDisplayStore.setState({ displayCurrency: 'USD' });

    render(<MarketplaceFilters resultCount={8} />);

    expect(screen.getByRole('combobox', { name: 'Display currency: US dollars' })).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('offers every listing currency as a display currency and shows the chosen code', async () => {
    const user = userEvent.setup();
    render(<MarketplaceFilters resultCount={8} />);

    await user.click(screen.getByRole('combobox', { name: 'Display currency: US dollars' }));
    for (const name of [
      'US dollars',
      'Euros',
      'Swiss francs',
      'British pounds',
      'Japanese yen',
      'Canadian dollars',
      'Australian dollars',
      'Bitcoin',
    ]) {
      expect(screen.getByRole('option', { name })).toBeInTheDocument();
    }
    expect(screen.getAllByRole('option')).toHaveLength(8);

    await user.click(screen.getByRole('option', { name: 'Japanese yen' }));

    expect(useMarketplaceDisplayStore.getState().displayCurrency).toBe('JPY');
    expect(screen.getByRole('combobox', { name: 'Display currency: Japanese yen' })).toHaveTextContent('JPY');
  });

  it('clears active discovery filters without changing layout', async () => {
    const user = userEvent.setup();
    useCommerceStore.getState().setLayout('list');
    useCommerceStore.getState().setQuery('camera');
    useCommerceStore.getState().setCategoryId('fashion');
    useCommerceStore.getState().setAttributeFilter('size', 'L');
    render(<MarketplaceFilters resultCount={1} />);

    await user.click(screen.getByRole('button', { name: 'Reset search and filters' }));

    expect(useCommerceStore.getState()).toMatchObject({
      query: '',
      categoryId: null,
      attributeFilters: {},
      saleFormat: 'all',
      layout: 'list',
    });
  });

  it('selects a top-level category from the nested designer menu', async () => {
    const user = userEvent.setup();
    render(<MarketplaceFilters resultCount={8} />);

    await user.click(screen.getByRole('button', { name: 'Category' }));
    await user.hover(screen.getByRole('menuitem', { name: /Fashion/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'All Fashion' }));
    expect(useCommerceStore.getState().categoryId).toBe('fashion');
  });

  it('does not put aria-current on category menuitems', async () => {
    const user = userEvent.setup();
    render(<MarketplaceFilters resultCount={8} />);

    await user.click(screen.getByRole('button', { name: 'Category' }));
    const allCategories = screen.getByRole('menuitem', { name: /All Categories/ });
    expect(allCategories).not.toHaveAttribute('aria-current');
    expect(allCategories).toHaveAttribute('data-selected', 'true');
  });

  it('clears attribute filters when the category changes', () => {
    useCommerceStore.getState().setCategoryId('fashion');
    useCommerceStore.getState().setAttributeFilter('size', 'L');
    expect(useCommerceStore.getState().attributeFilters).toEqual({ size: 'L' });

    useCommerceStore.getState().setCategoryId('electronics');
    expect(useCommerceStore.getState().attributeFilters).toEqual({});
  });

  it('keeps alternative countries in the unfiltered facet set', () => {
    const item = (countryCode: string) => ({
      id: `seller:${countryCode}`,
      sellerId: 'seller',
      listingId: countryCode,
      state: 'active' as const,
      title: countryCode,
      description: '',
      categoryId: 'fashion',
      condition: 'good' as const,
      tags: [],
      saleFormat: 'fixed_price' as const,
      price: { amountMinor: 100, currency: 'USD', exponent: 2 },
      auction: null,
      attributes: null,
      location: { countryCode, region: null },
      mediaUrls: [],
      listingReputation: null,
      revision: 1,
      updatedAt: 1,
    });
    expect(collectMarketplaceCountryFacets([item('BE'), item('FR'), item('PT')])).toEqual([
      ['BE', 1],
      ['FR', 1],
      ['PT', 1],
    ]);
  });

  it('renders alternative countries when one country is selected', async () => {
    const item = (countryCode: string) => ({
      id: `seller:${countryCode}`,
      sellerId: 'seller',
      listingId: countryCode,
      state: 'active' as const,
      title: countryCode,
      description: '',
      categoryId: 'fashion',
      condition: 'good' as const,
      tags: [],
      saleFormat: 'fixed_price' as const,
      price: { amountMinor: 100, currency: 'USD', exponent: 2 },
      auction: null,
      attributes: null,
      location: { countryCode, region: null },
      mediaUrls: [],
      listingReputation: null,
      revision: 1,
      updatedAt: 1,
    });

    useCommerceStore.getState().setCountryCode('BE');
    render(
      <MarketplaceFilters
        resultCount={1}
        facetPool={[item('BE')]}
        countryFacetPool={[item('BE'), item('FR'), item('PT')]}
      />,
    );
    const locationSelect = screen.getByRole('combobox', { name: 'Item location' });
    HTMLElement.prototype.scrollIntoView = vi.fn();
    fireEvent.keyDown(locationSelect, { key: 'ArrowDown' });

    await waitFor(() => expect(screen.getByRole('option', { name: 'France · 1' })).toBeInTheDocument());
    expect(screen.getByRole('option', { name: 'Portugal · 1' })).toBeInTheDocument();
  });

  it('renders attribute facets from the facet pool and toggles a filter', async () => {
    const user = userEvent.setup();
    useCommerceStore.getState().setCategoryId('fashion');
    const facetItem = {
      id: 'seller:varsity_fleece',
      sellerId: 'seller',
      listingId: 'varsity_fleece',
      state: 'active' as const,
      title: 'Heavyweight varsity fleece',
      description: 'Boxy 90s collegiate fleece.',
      categoryId: 'fashion-men-tops-hoodies',
      condition: 'good' as const,
      tags: [],
      saleFormat: 'fixed_price' as const,
      price: { amountMinor: 7_200, currency: 'USD', exponent: 2 },
      auction: null,
      attributes: { size: 'L', brand: 'Champion', color: ['grey', 'navy'] },
      location: { countryCode: 'US', region: null },
      mediaUrls: [],
      listingReputation: null,
      revision: 1,
      updatedAt: 1_000,
    };
    render(<MarketplaceFilters resultCount={1} facetPool={[facetItem]} />);

    expect(screen.getByText('Size')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'L · 1' }));
    expect(useCommerceStore.getState().attributeFilters).toEqual({ size: 'L' });
    // Toggling the active chip clears it again.
    await user.click(screen.getByRole('button', { name: 'L · 1' }));
    expect(useCommerceStore.getState().attributeFilters).toEqual({});
  });
});

describe('MarketplaceFilters - Snapshots', () => {
  // The recorded snapshot was taken with the 'fashion' category left selected by
  // the last test above. Pin that state so a failure in an earlier test cannot
  // leak its filters into this one.
  beforeEach(() => {
    useCommerceStore.getState().reset();
    useCommerceStore.getState().setCategoryId('fashion');
    useMarketplaceDisplayStore.setState({ displayCurrency: 'USD' });
  });

  it('matches the default filter snapshot', () => {
    const { container } = render(<MarketplaceFilters resultCount={8} />);
    expect(container.firstChild).toMatchSnapshot();
  });
});
