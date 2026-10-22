import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import { SELLING_BLOCKED_COUNTRY_MESSAGE, SHOP_COUNTRY_LOCKED_MESSAGE } from '@/libs/commerce/region-modes';
import { AppError } from '@/libs/error/error';
import { ClientErrorCode } from '@/libs/error/error.codes';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import { createCommerceShopFixture } from '@/test/fixtures/commerce/commerce';
import { resetRegionState, setRegionModes, stubClientRegion } from '@/test-utils/region-modes';
import { MarketplaceShopSettingsForm } from './MarketplaceShopSettingsForm';

const OWNER = 'y'.repeat(52);

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: { currentUserPubky: string }) => unknown) => selector({ currentUserPubky: OWNER }),
}));

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    getShop: vi.fn(),
    getOrFetchShop: vi.fn(),
    refreshShop: vi.fn(),
    commitUpsertShop: vi.fn(),
    commitCreateMedia: vi.fn(),
    getSellerAnnualLimit: vi.fn(),
  },
}));

vi.mock('@/molecules/Toaster/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/hooks/useMarketplaceMediaUrl/useMarketplaceMediaUrl', async () => {
  return await import('@/test/mocks/marketplace-media-hooks');
});

const LAUNCH = 'EU=blocked,GB=blocked,US=blocked';

const country = () => screen.getByLabelText('Country');
const hint = () => screen.queryByTestId('shop-settings-country-blocked');

beforeEach(() => {
  resetRegionState();
  vi.clearAllMocks();
  const missing = new AppError({
    category: ErrorCategory.Client,
    code: ClientErrorCode.NOT_FOUND,
    message: 'No shop',
    service: ErrorService.Homeserver,
    operation: 'getOwnedResponse',
    context: { statusCode: 404 },
  });
  vi.mocked(CommerceController.getOrFetchShop).mockRejectedValue(missing);
  vi.mocked(CommerceController.refreshShop).mockRejectedValue(missing);
  vi.mocked(CommerceController.getShop).mockResolvedValue(null);
  vi.mocked(CommerceController.getSellerAnnualLimit).mockResolvedValue({ enabled: false });
});
afterEach(() => resetRegionState());

describe('the shop settings country field under the region modes', () => {
  it('starts empty, so no blocked country is pre-selected', async () => {
    setRegionModes(LAUNCH);
    render(<MarketplaceShopSettingsForm />);

    expect(await screen.findByLabelText('Country')).toHaveValue('');
    expect(hint()).not.toBeInTheDocument();
  });

  it.each(['US', 'de', 'GB'])('says selling is not available from %s as soon as it is typed', async (code) => {
    const user = userEvent.setup();
    setRegionModes(LAUNCH);
    render(<MarketplaceShopSettingsForm />);
    await user.type(await screen.findByLabelText('Country'), code);

    expect(hint()).toHaveTextContent(SELLING_BLOCKED_COUNTRY_MESSAGE);
  });

  it('says nothing for a country that is open, and clears the line when the country changes', async () => {
    const user = userEvent.setup();
    setRegionModes(LAUNCH);
    render(<MarketplaceShopSettingsForm />);
    await user.type(await screen.findByLabelText('Country'), 'US');
    expect(hint()).toBeInTheDocument();

    await user.clear(country());
    await user.type(country(), 'CH');
    expect(hint()).not.toBeInTheDocument();
  });

  it('refuses to save a blocked country and shows the sentence once', async () => {
    const user = userEvent.setup();
    setRegionModes(LAUNCH);
    render(<MarketplaceShopSettingsForm />);
    await user.type(await screen.findByLabelText('Country'), 'US');
    await user.type(screen.getByLabelText('Shipping policy'), 'Ships within a week.');
    await user.type(screen.getByLabelText('Return policy'), 'Returns within 14 days.');
    await user.click(screen.getByRole('radio', { name: /private individual/ }));
    await user.click(screen.getByRole('button', { name: 'Save storefront' }));

    await waitFor(() => expect(screen.getAllByText(SELLING_BLOCKED_COUNTRY_MESSAGE)).toHaveLength(1));
    expect(CommerceController.commitUpsertShop).not.toHaveBeenCalled();
  });

  it('keeps the US as ordinary a choice as any while no region is blocked', async () => {
    const user = userEvent.setup();
    setRegionModes('EU=nuanced,GB=nuanced');
    render(<MarketplaceShopSettingsForm />);
    await user.type(await screen.findByLabelText('Country'), 'US');

    expect(hint()).not.toBeInTheDocument();
  });
});

describe('the shop country of a shop that already has one', () => {
  beforeEach(() => {
    vi.mocked(CommerceController.refreshShop).mockResolvedValue(
      createCommerceShopFixture({ ownerPubky: OWNER, location: { countryCode: 'CH' } }),
    );
  });

  it('is read-only from a visitor region inside the block, with the reason under it', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('DE');
    render(<MarketplaceShopSettingsForm />);

    await waitFor(() => expect(country()).toBeDisabled());
    expect(country()).toHaveValue('CH');
    expect(screen.getByTestId('shop-settings-country-locked')).toHaveTextContent(SHOP_COUNTRY_LOCKED_MESSAGE);
    expect(screen.getByLabelText('Shop name')).toBeEnabled();
  });

  it('can be edited from a visitor region outside the block', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('CH');
    render(<MarketplaceShopSettingsForm />);

    await waitFor(() => expect(country()).toHaveValue('CH'));
    await waitFor(() => expect(country()).toBeEnabled());
    expect(screen.queryByTestId('shop-settings-country-locked')).not.toBeInTheDocument();
  });

  it('can be edited while no region is blocked', async () => {
    setRegionModes('EU=nuanced');
    render(<MarketplaceShopSettingsForm />);

    await waitFor(() => expect(country()).toHaveValue('CH'));
    expect(country()).toBeEnabled();
  });
});
