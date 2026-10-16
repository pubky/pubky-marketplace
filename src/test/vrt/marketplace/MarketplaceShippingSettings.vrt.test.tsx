// Intentional import order — browser-mode mock factories rely on stable aliases.
/* eslint-disable simple-import-sort/imports */
import { describe, expect, it, vi } from 'vitest';
import { renderForVRT, VRT_ROOT_TESTID } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';
import { MarketplaceShippingSettings } from '@/templates/Marketplace/MarketplaceShippingSettings';

const view = vi.hoisted(() => ({
  presets: [] as unknown[],
  isLoading: false,
  rates: null as unknown,
}));

const presetFixtures = vi.hoisted(() => {
  const owner = 'y'.repeat(52);
  return [
    {
      id: `${owner}:preset_standard`,
      owner_id: owner,
      label: 'Standard shipping',
      price_minor: 1_200,
      currency: 'USD',
      estimated_min_days: 3,
      estimated_max_days: 7,
      created_at: 1_754_000_000_000,
      updated_at: 1_755_000_000_000,
    },
    {
      id: `${owner}:preset_express`,
      owner_id: owner,
      label: 'Express courier',
      price_minor: 2_500,
      currency: 'USD',
      estimated_min_days: 1,
      estimated_max_days: 2,
      created_at: 1_754_100_000_000,
      updated_at: 1_754_100_000_000,
    },
  ];
});

// Rates are fetched over the network in the app; a fixed snapshot (or none) keeps the hint deterministic.
vi.mock('@/hooks/useIndicativeBtcRate/useIndicativeBtcRate', () => ({
  useIndicativeBtcRate: (enabled: boolean) => (enabled ? view.rates : null),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/marketplace/settings/shipping',
  useSearchParams: () => new URLSearchParams(),
}));

const multiCurrencyFixtures = vi.hoisted(() => {
  const owner = 'y'.repeat(52);
  const base = {
    owner_id: owner,
    estimated_min_days: 2,
    estimated_max_days: 4,
    created_at: 1_754_000_000_000,
    updated_at: 1_755_000_000_000,
  };
  return [
    { ...base, id: `${owner}:preset_chf`, label: 'Swiss Post', price_minor: 800, currency: 'CHF' },
    { ...base, id: `${owner}:preset_usd`, label: 'Standard shipping', price_minor: 1_200, currency: 'USD' },
    { ...base, id: `${owner}:preset_jpy`, label: 'Yamato Transport', price_minor: 1_500, currency: 'JPY' },
  ];
});

vi.mock('@/hooks/useMarketplaceShippingPresets/useMarketplaceShippingPresets', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/hooks/useMarketplaceShippingPresets/useMarketplaceShippingPresets')>();
  return {
    ...actual,
    useMarketplaceShippingPresets: () => ({
      presets: view.presets,
      isLoading: view.isLoading,
      saveFromFields: vi.fn(async () => true),
      remove: vi.fn(async () => {}),
    }),
  };
});

vi.mock('@/organisms/ContentLayout/ContentLayout', () => ({
  ContentLayout: ({ children }: { children: React.ReactNode }) => <main className="w-full py-6">{children}</main>,
}));

describe('Marketplace shipping presets settings — visual regression', () => {
  it('renders the preset list at desktop viewport', async () => {
    view.presets = presetFixtures;
    view.isLoading = false;

    const screen = await renderForVRT(<MarketplaceShippingSettings />, { viewport: VRT_VIEWPORT_DESKTOP });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('shipping-settings-list-desktop');
  });

  it('renders the preset list at mobile viewport', async () => {
    view.presets = presetFixtures;
    view.isLoading = false;

    const screen = await renderForVRT(<MarketplaceShippingSettings />, { viewport: VRT_VIEWPORT_MOBILE });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('shipping-settings-list-mobile');
  });

  it('renders presets in several currencies with the converted hint at desktop viewport', async () => {
    view.presets = multiCurrencyFixtures;
    view.isLoading = false;
    view.rates = {
      satUsd: 0.001,
      btcUsd: 100_000,
      lastUpdatedAt: new Date('2026-10-15T09:40:00Z'),
      fiatPerBtc: { USD: '100000', EUR: '90000', CHF: '80000', JPY: '15000000' },
    };

    const screen = await renderForVRT(<MarketplaceShippingSettings />, { viewport: VRT_VIEWPORT_DESKTOP });
    await vi.waitFor(() => {
      if (!screen.container.textContent?.includes('≈')) throw new Error('The converted hint has not rendered yet.');
    });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('shipping-settings-multicurrency-desktop');
    view.rates = null;
  });

  it('renders the empty state at desktop viewport', async () => {
    view.presets = [];
    view.isLoading = false;

    const screen = await renderForVRT(<MarketplaceShippingSettings />, { viewport: VRT_VIEWPORT_DESKTOP });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('shipping-settings-empty-desktop');
  });

  it('renders the create form at desktop viewport', async () => {
    view.presets = presetFixtures;
    view.isLoading = false;

    const screen = await renderForVRT(<MarketplaceShippingSettings />, { viewport: VRT_VIEWPORT_DESKTOP });
    await screen.getByRole('button', { name: 'Add preset' }).click();
    await vi.waitFor(() => {
      if (!screen.container.querySelector('#shippingLabel')) throw new Error('The preset form has not opened yet.');
    });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('shipping-settings-create-desktop');
  });
});
