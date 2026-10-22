import { render, screen, waitFor } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { marketplaceShopSettingsDefaults } from '@/hooks/useMarketplaceShopSettings/useMarketplaceShopSettings.types';
import {
  SELLING_BLOCKED_MESSAGE,
  SELLING_MOVED_ON_SHOP_SETTINGS,
  SELLING_PAUSED_NOTE,
} from '@/libs/commerce/region-modes';
import { resetRegionState, setRegionModes, stubClientRegion } from '@/test-utils/region-modes';
import { MarketplaceMyShop } from './MarketplaceMyShop';

const LAUNCH = 'EU=blocked,GB=blocked,US=blocked';

const view = vi.hoisted(() => ({ shopCountry: null as string | null, loading: false }));

const imageSlot = {
  previewUrl: null,
  hasImage: false,
  error: null,
  inputRef: { current: null },
  choose: vi.fn(),
  onInputChange: vi.fn(),
  remove: vi.fn(),
};

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: Object.assign(
    (selector: (state: { currentUserPubky: string }) => unknown) => selector({ currentUserPubky: 'y'.repeat(52) }),
    {
      getState: () => ({ currentUserPubky: 'y'.repeat(52), selectCurrentUserPubky: () => 'y'.repeat(52) }),
      setState: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    },
  ),
}));

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    getShop: vi.fn(async () =>
      view.shopCountry === null ? null : { record: { location: { countryCode: view.shopCountry } } },
    ),
  },
}));

vi.mock('@/organisms/ContentLayout/ContentLayout', () => ({
  ContentLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

vi.mock('@/organisms/Marketplace/MarketplaceSectionNav', () => ({ MarketplaceSectionNav: () => null }));
vi.mock('@/molecules/Marketplace/BackToMyShop', () => ({ BackToMyShop: () => null }));

vi.mock('@/hooks/useMarketplaceShopSettings/useMarketplaceShopSettings', () => ({
  useMarketplaceShopSettings: () => ({
    form: useForm({ defaultValues: { ...marketplaceShopSettingsDefaults, countryCode: view.shopCountry ?? '' } }),
    revision: 1,
    isLoading: view.loading,
    loadError: false,
    reload: vi.fn(),
    isSaving: false,
    hasShop: true,
    countryBlocked: false,
    avatar: imageSlot,
    banner: imageSlot,
    submit: vi.fn(async () => false),
  }),
}));

beforeEach(() => {
  resetRegionState();
  view.shopCountry = null;
  view.loading = false;
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  resetRegionState();
  window.history.replaceState(null, '', '/');
});

describe('My storefront in a blocked region', () => {
  it('stays open with the shop country field, for a seller whose shop is in a blocked country', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('CH');
    view.shopCountry = 'GB';
    render(<MarketplaceMyShop />);

    const notice = await screen.findByTestId('storefront-selling-unavailable');
    expect(notice).toHaveTextContent(SELLING_BLOCKED_MESSAGE);
    expect(screen.getByTestId('selling-unavailable-hint')).toHaveTextContent(SELLING_MOVED_ON_SHOP_SETTINGS);
    expect(screen.getByLabelText('Country')).toBeEnabled();
    expect(screen.getByLabelText('Country')).toHaveValue('GB');
  });

  it('stays open for a seller whose own region is blocked, and says the details can still change', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('US');
    view.shopCountry = 'CH';
    render(<MarketplaceMyShop />);

    const notice = await screen.findByTestId('storefront-selling-unavailable');
    expect(notice).toHaveTextContent(SELLING_BLOCKED_MESSAGE);
    expect(screen.getByTestId('selling-unavailable-hint')).toHaveTextContent(SELLING_PAUSED_NOTE);
    expect(screen.getByLabelText('Country')).toBeEnabled();
  });

  it('says nothing for a seller from an open country with an open shop country', async () => {
    setRegionModes(LAUNCH);
    const fetchStub = stubClientRegion('CH');
    view.shopCountry = 'CH';
    render(<MarketplaceMyShop />);

    await waitFor(() => expect(fetchStub).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText('Country')).toBeInTheDocument());
    expect(screen.queryByTestId('storefront-selling-unavailable')).not.toBeInTheDocument();
  });

  it('says nothing, and reads no region, while no region is blocked', () => {
    setRegionModes('none');
    const fetchStub = stubClientRegion('US');
    view.shopCountry = 'GB';
    render(<MarketplaceMyShop />);

    expect(screen.queryByTestId('storefront-selling-unavailable')).not.toBeInTheDocument();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('focuses the country field when the link from a selling notice lands on it', async () => {
    setRegionModes(LAUNCH);
    stubClientRegion('CH');
    view.shopCountry = 'GB';
    window.history.replaceState(null, '', '/marketplace/storefront#countryCode');
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
    render(<MarketplaceMyShop />);

    await waitFor(() => expect(screen.getByLabelText('Country')).toHaveFocus());
    expect(scrollIntoView).toHaveBeenCalled();
  });
});
