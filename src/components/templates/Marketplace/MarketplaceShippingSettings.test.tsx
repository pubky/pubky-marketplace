import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKETPLACE_ROUTES } from '@/app/routes';
import { TooltipProvider } from '@/atoms/Tooltip/Tooltip';
import { CommerceController } from '@/controllers/commerce/commerce';
import { peekListingComposerReturnTo, rememberListingComposerReturnTo } from '@/libs/commerce/listing-publish-guards';
import { useMarketplaceDisplayStore } from '@/stores/marketplace-display/marketplace-display.store';
import { MarketplaceShippingSettings } from './MarketplaceShippingSettings';

const OWNER = 'y'.repeat(52);

const presetsView = vi.hoisted(() => ({
  presets: [] as Array<{
    id: string;
    owner_id: string;
    label: string;
    price_minor: number;
    currency: string;
    estimated_min_days: number;
    estimated_max_days: number;
    created_at: number;
    updated_at: number;
  }>,
  saveFromFields: vi.fn(async (_id: string | null, _fields: { shippingLabel: string }, _currency: string) => true),
  remove: vi.fn(async () => {}),
}));

const navigation = vi.hoisted(() => ({ search: '' }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/marketplace/settings/shipping',
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

const deliveryKeyView = vi.hoisted(() => ({
  enabled: false,
  publication: null as 'matches' | 'missing' | null,
}));

vi.mock('@/hooks/useMyDeliveryKey/useMyDeliveryKey', () => ({
  useMyDeliveryKey: () => ({
    enabled: deliveryKeyView.enabled,
    status: deliveryKeyView.publication
      ? { local: null, publication: deliveryKeyView.publication, publishedKeyId: null }
      : null,
    isLoading: false,
    isWorking: false,
    loadFailed: false,
    create: vi.fn(async () => true),
    publish: vi.fn(async () => true),
  }),
}));

vi.mock('@/hooks/useMarketplaceShippingPresets/useMarketplaceShippingPresets', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/hooks/useMarketplaceShippingPresets/useMarketplaceShippingPresets')>();
  return {
    ...actual,
    useMarketplaceShippingPresets: () => ({
      presets: presetsView.presets,
      isLoading: false,
      saveFromFields: presetsView.saveFromFields,
      remove: presetsView.remove,
    }),
  };
});

vi.mock('@/controllers/commerce/commerce', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/controllers/commerce/commerce')>();
  return {
    ...actual,
    CommerceController: { ...actual.CommerceController, getIndicativeBtcRate: vi.fn() },
  };
});

vi.mock('@/organisms/ContentLayout/ContentLayout', () => ({
  ContentLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

const RATE = {
  satUsd: 0.001,
  btcUsd: 100_000,
  lastUpdatedAt: new Date('2026-10-15T09:40:00Z'),
  fiatPerBtc: { USD: '100000', EUR: '90000', CHF: '80000', JPY: '15000000' },
};

function preset(id: string, label: string, currency: string, priceMinor: number) {
  return {
    id: `${OWNER}:${id}`,
    owner_id: OWNER,
    label,
    price_minor: priceMinor,
    currency,
    estimated_min_days: 3,
    estimated_max_days: 7,
    created_at: 1,
    updated_at: 1,
  };
}

function renderPage() {
  return render(
    <TooltipProvider>
      <MarketplaceShippingSettings />
    </TooltipProvider>,
  );
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.setPointerCapture = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  navigation.search = '';
  deliveryKeyView.enabled = false;
  deliveryKeyView.publication = null;
  presetsView.presets = [];
  useMarketplaceDisplayStore.setState({ displayCurrency: 'USD', showFxEstimate: true });
  vi.mocked(CommerceController.getIndicativeBtcRate).mockResolvedValue(RATE);
});

describe('MarketplaceShippingSettings presets', () => {
  it('shows each preset in its own currency, with the usual converted hint', async () => {
    presetsView.presets = [
      preset('chf', 'Swiss Post', 'CHF', 800),
      preset('usd', 'UPS', 'USD', 1_200),
      preset('jpy', 'Yamato', 'JPY', 1_500),
    ];

    renderPage();

    expect(screen.getByText('Swiss Post').closest('div')).toHaveTextContent('CHF 8.00');
    expect(screen.getByText('UPS').closest('div')).toHaveTextContent('$12.00');
    expect(screen.getByText('Yamato').closest('div')).toHaveTextContent('¥1,500');
    // CHF 8.00 = 0.0001 BTC = $10.00; ¥1,500 = 0.0001 BTC = $10.00; $12.00 shows its bitcoin counterpart.
    expect(await screen.findAllByText('≈ $10.00')).toHaveLength(2);
    expect(await screen.findByText('≈ ₿12,000')).toBeInTheDocument();
  });

  it('shows no hint when the rates are unavailable', async () => {
    vi.mocked(CommerceController.getIndicativeBtcRate).mockRejectedValue(new Error('rates down'));
    presetsView.presets = [preset('chf', 'Swiss Post', 'CHF', 800)];

    renderPage();

    await waitFor(() => expect(CommerceController.getIndicativeBtcRate).toHaveBeenCalled());
    expect(screen.getByText('Swiss Post').closest('div')).not.toHaveTextContent('≈');
  });

  it('starts a new preset in the currency of the latest one', async () => {
    presetsView.presets = [preset('chf', 'Swiss Post', 'CHF', 800)];
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Add preset' }));

    expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveTextContent('Swiss francs (CHF)');
    expect(screen.getByLabelText('Flat price (CHF)')).toHaveAttribute('placeholder', '12.00');
  });

  it('starts a new preset in the browser currency when there is no preset yet', async () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['ja-JP']);
    useMarketplaceDisplayStore.setState({ displayCurrency: null });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Add preset' }));

    expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveTextContent('Japanese yen (JPY)');
    expect(screen.getByLabelText('Flat price (JPY)')).toHaveAttribute('placeholder', '1200');
    vi.restoreAllMocks();
  });

  it('saves a new preset in the chosen currency', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Add preset' }));

    await user.type(screen.getByLabelText('Shipping label'), 'Swiss Post');
    await user.click(screen.getByRole('combobox', { name: 'Currency' }));
    await user.click(screen.getByRole('option', { name: 'Swiss francs (CHF)' }));
    await user.type(screen.getByLabelText('Flat price (CHF)'), '8.50');
    await user.click(screen.getByRole('button', { name: 'Save preset' }));

    await waitFor(() => expect(presetsView.saveFromFields).toHaveBeenCalledTimes(1));
    expect(presetsView.saveFromFields).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ shippingLabel: 'Swiss Post', shippingPrice: '8.50' }),
      'CHF',
    );
  });

  it('starts the next new preset in the currency of the one just saved', async () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['ja-JP']);
    useMarketplaceDisplayStore.setState({ displayCurrency: null });
    presetsView.saveFromFields.mockImplementation(async (_id, fields, currency) => {
      presetsView.presets = [preset('chf', fields.shippingLabel, currency, 850)];
      return true;
    });
    const user = userEvent.setup();
    const { rerender } = renderPage();
    await user.click(screen.getByRole('button', { name: 'Add preset' }));
    expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveTextContent('Japanese yen (JPY)');
    await user.type(screen.getByLabelText('Shipping label'), 'Swiss Post');
    await user.click(screen.getByRole('combobox', { name: 'Currency' }));
    await user.click(screen.getByRole('option', { name: 'Swiss francs (CHF)' }));
    await user.type(screen.getByLabelText('Flat price (CHF)'), '8.50');
    await user.click(screen.getByRole('button', { name: 'Save preset' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'New preset' })).not.toBeInTheDocument());

    rerender(
      <TooltipProvider>
        <MarketplaceShippingSettings />
      </TooltipProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Add preset' }));

    expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveTextContent('Swiss francs (CHF)');
    expect(screen.getByLabelText('Shipping label')).toHaveValue('');
    expect(screen.getByLabelText('Min days')).toHaveValue('3');
    vi.restoreAllMocks();
  });

  it('validates the price in the chosen currency', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Add preset' }));
    await user.type(screen.getByLabelText('Shipping label'), 'Yamato');
    await user.click(screen.getByRole('combobox', { name: 'Currency' }));
    await user.click(screen.getByRole('option', { name: 'Japanese yen (JPY)' }));

    await user.type(screen.getByLabelText('Flat price (JPY)'), '800.50');
    await user.click(screen.getByRole('button', { name: 'Save preset' }));

    expect(await screen.findByText('Enter a whole JPY amount.')).toBeInTheDocument();
    expect(presetsView.saveFromFields).not.toHaveBeenCalled();
  });

  it('edits a preset in its own currency and exponent', async () => {
    presetsView.presets = [preset('jpy', 'Yamato', 'JPY', 1_500)];
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Edit Yamato' }));

    expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveTextContent('Japanese yen (JPY)');
    expect(screen.getByLabelText('Flat price (JPY)')).toHaveValue('1500');
  });

  it('edits an existing US dollar preset as dollars and cents', async () => {
    presetsView.presets = [preset('usd', 'UPS', 'USD', 1_250)];
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Edit UPS' }));

    expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveTextContent('US dollars (USD)');
    expect(screen.getByLabelText('Flat price (USD)')).toHaveValue('12.50');
    const card = screen.getByRole('heading', { name: 'Edit preset' }).closest('div');
    expect(within(card as HTMLElement).getByRole('button', { name: 'Save preset' })).toBeInTheDocument();
  });
});

describe('MarketplaceShippingSettings preset form focus', () => {
  it('opens the new preset form right under the page heading and focuses its label field', async () => {
    presetsView.presets = [preset('usd', 'UPS', 'USD', 1_200)];
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Add preset' }));

    const form = screen.getByRole('region', { name: 'New preset' });
    const pageHeading = screen.getByRole('heading', { level: 1, name: 'Shipping' });
    const firstPreset = screen.getByRole('heading', { name: 'UPS' });
    expect(pageHeading.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(form.compareDocumentPosition(firstPreset) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    expect(screen.getByLabelText('Shipping label')).toHaveFocus();
  });

  it('restores the Add preset button and its focus on cancel', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Add preset' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('region', { name: 'New preset' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add preset' })).toHaveFocus();
  });

  it('returns focus to the Add preset button after saving a new preset', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Add preset' }));
    await user.type(screen.getByLabelText('Shipping label'), 'Swiss Post');
    await user.type(screen.getByLabelText('Flat price (USD)'), '8.50');
    await user.click(screen.getByRole('button', { name: 'Save preset' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Add preset' })).toHaveFocus());
  });

  it('focuses the label when editing and returns focus to that preset on cancel', async () => {
    presetsView.presets = [preset('usd', 'UPS', 'USD', 1_200), preset('chf', 'Swiss Post', 'CHF', 800)];
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Edit Swiss Post' }));

    expect(screen.getByRole('region', { name: 'Edit preset' })).toBeInTheDocument();
    expect(screen.getByLabelText('Shipping label')).toHaveFocus();
    expect(screen.getByLabelText('Shipping label')).toHaveValue('Swiss Post');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('button', { name: 'Edit Swiss Post' })).toHaveFocus();
  });

  it('opens the new preset form above the return to the listing draft', async () => {
    deliveryKeyView.enabled = true;
    deliveryKeyView.publication = 'missing';
    navigation.search = `returnTo=${encodeURIComponent(MARKETPLACE_ROUTES.SELL)}`;
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Add preset' }));

    const form = screen.getByRole('region', { name: 'New preset' });
    const listingReturn = screen.getByTestId('listing-composer-return');
    expect(form.compareDocumentPosition(listingReturn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByLabelText('Shipping label')).toHaveFocus();
  });
});

describe('MarketplaceShippingSettings return to the listing draft', () => {
  it('shows no return action when the seller did not come from a listing', () => {
    renderPage();

    expect(screen.queryByTestId('listing-composer-return')).not.toBeInTheDocument();
  });

  it('links back to the draft while the delivery key is not published', () => {
    deliveryKeyView.enabled = true;
    deliveryKeyView.publication = 'missing';
    navigation.search = `returnTo=${encodeURIComponent(MARKETPLACE_ROUTES.SELL)}`;

    renderPage();

    expect(screen.getByRole('link', { name: 'Back to listing' })).toHaveAttribute('href', MARKETPLACE_ROUTES.SELL);
    expect(peekListingComposerReturnTo()).toBe(MARKETPLACE_ROUTES.SELL);
  });

  it('offers Continue listing once the delivery key is published, and forgets the return on use', async () => {
    const editPath = `/marketplace/listing/${OWNER}/item/edit`;
    deliveryKeyView.enabled = true;
    deliveryKeyView.publication = 'matches';
    navigation.search = `returnTo=${encodeURIComponent(editPath)}`;
    renderPage();

    const link = screen.getByRole('link', { name: 'Continue listing' });
    expect(link).toHaveAttribute('href', editPath);
    link.addEventListener('click', (event) => event.preventDefault());
    await userEvent.click(link);

    expect(peekListingComposerReturnTo()).toBeNull();
  });

  it('keeps the return when the seller reaches Shipping from Payment settings', () => {
    rememberListingComposerReturnTo(MARKETPLACE_ROUTES.SELL);

    renderPage();

    expect(screen.getByRole('link', { name: 'Back to listing' })).toHaveAttribute('href', MARKETPLACE_ROUTES.SELL);
  });

  it.each(['https://evil.example/marketplace/sell', '//evil.example', '/marketplace/orders'])(
    'ignores a return target that is not a listing composer: %s',
    (target) => {
      navigation.search = `returnTo=${encodeURIComponent(target)}`;

      renderPage();

      expect(screen.queryByTestId('listing-composer-return')).not.toBeInTheDocument();
    },
  );
});
