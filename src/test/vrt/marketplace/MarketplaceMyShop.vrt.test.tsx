// Intentional import order — browser-mode mock factories rely on stable aliases.
/* eslint-disable simple-import-sort/imports */
import { createMarketplaceVrtAuthStore } from '@/test/mocks/marketplace-vrt';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderForVRT, VRT_ROOT_TESTID } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';
import { MarketplaceMyShop } from '@/templates/Marketplace/MarketplaceMyShop';

// No rate in this capture: the indicative-rate hook resolves to null (no
// rate -> no estimate), keeping the scenario network-free and byte-identical
// to the pre-estimate baseline.
vi.mock('@/hooks/useIndicativeBtcRate/useIndicativeBtcRate', () => ({
  useIndicativeBtcRate: () => null,
}));

const configuredShop = vi.hoisted(() => ({
  name: 'Satoshi Vintage',
  bio: 'Circular fashion and Bitcoin.',
  countryCode: 'US',
  region: 'NY',
  shippingPolicy: 'Ships within three business days.',
  returnPolicy: 'Returns accepted within 30 days.',
  vacationMode: true,
}));

const view = vi.hoisted(() => ({
  configured: false,
  isLoading: false,
  withImages: false,
  loadError: false,
  shipsToCountries: '',
  selling: {
    active: false,
    checking: false,
    blocked: false,
    held: false,
    source: null,
    message: null,
    sellingMessage: null,
    info: null,
  } as unknown,
}));

// Deterministic solid-color previews for the images-set editor state.
const AVATAR_DATA_URL = vi.hoisted(
  () =>
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGMQqejBihiGlgQAPF1GAQp5eMUAAAAASUVORK5CYII=',
);
const BANNER_DATA_URL = vi.hoisted(
  () =>
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAIAAAA8r+mnAAAAEUlEQVR4nGOwMZqGFTFQTwIATn4ggS6iTnsAAAAASUVORK5CYII=',
);

const imageSlot = vi.hoisted(() => (previewUrl: string | null) => ({
  previewUrl,
  hasImage: previewUrl !== null,
  error: null,
  inputRef: { current: null },
  choose: () => undefined,
  onInputChange: () => undefined,
  remove: () => undefined,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/marketplace/my-shop',
}));

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: createMarketplaceVrtAuthStore({ currentUserPubky: 'y'.repeat(52) }),
}));

// The browser build has no region policy; a scene sets what the policy would say.
vi.mock('@/hooks/useSellingAvailability/useSellingAvailability', () => ({
  useSellingAvailability: () => view.selling,
}));

vi.mock('@/hooks/useMarketplaceShopSettings/useMarketplaceShopSettings', async () => {
  const { useForm } = await import('react-hook-form');
  const { marketplaceShopSettingsDefaults } =
    await import('@/hooks/useMarketplaceShopSettings/useMarketplaceShopSettings.types');
  return {
    useMarketplaceShopSettings: () => ({
      form: useForm({
        defaultValues: view.configured
          ? { ...configuredShop, shipsToCountries: view.shipsToCountries }
          : marketplaceShopSettingsDefaults,
      }),
      revision: view.configured ? 3 : 0,
      isLoading: view.isLoading,
      loadError: view.loadError,
      reload: vi.fn(),
      isSaving: false,
      hasShop: view.configured,
      avatar: imageSlot(view.withImages ? AVATAR_DATA_URL : null),
      banner: imageSlot(view.withImages ? BANNER_DATA_URL : null),
      submit: vi.fn(async () => false),
    }),
  };
});

vi.mock('@/organisms/ContentLayout/ContentLayout', () => ({
  ContentLayout: ({ children }: { children: React.ReactNode }) => <main className="w-full py-6">{children}</main>,
}));

describe('Marketplace my shop — visual regression', () => {
  beforeEach(() => {
    view.loadError = false;
    view.shipsToCountries = '';
    view.selling = {
      active: false,
      checking: false,
      blocked: false,
      held: false,
      source: null,
      message: null,
      sellingMessage: null,
      info: null,
    };
  });

  // Where selling is blocked the storefront settings stay open, so the seller can change the shop country.
  it.each([
    {
      name: 'declared',
      declaredCountry: 'GB',
      ip: 'CH',
      line: "Your shop country is United Kingdom, where selling isn't available yet.",
    },
    { name: 'ip', declaredCountry: 'CH', ip: 'US', line: "Selling isn't available in your region yet." },
  ])(
    'renders the storefront settings with the selling notice, $name case, at desktop viewport',
    async ({ name, declaredCountry, ip, line }) => {
      const { evaluateCommerceAvailability } = await import('@/libs/commerce/commerce-availability');
      const { createRegionPolicy, parseRegionModes } = await import('@/libs/commerce/region-modes');
      const parsed = parseRegionModes('EU=blocked,GB=blocked,US=blocked');
      if (!parsed.ok) throw new Error(parsed.error);
      view.selling = evaluateCommerceAvailability(createRegionPolicy(parsed.entries), {
        declaredCountry,
        declaredIs: 'shop',
        client: { status: 'ready', country: ip },
      });
      view.configured = true;
      view.isLoading = false;
      view.withImages = false;

      const screen = await renderForVRT(<MarketplaceMyShop />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });
      await vi.waitFor(() => {
        if (!screen.container.textContent?.includes(line)) throw new Error('The selling notice has not rendered yet.');
      });
      await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(`my-shop-region-blocked-${name}-desktop`);
    },
  );
  it('renders the create-shop state for a seller without a shop at desktop viewport', async () => {
    view.configured = false;
    view.isLoading = false;
    view.withImages = false;

    const screen = await renderForVRT(<MarketplaceMyShop />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('my-shop-create-desktop');
  });

  it('renders the create-shop state at mobile viewport', async () => {
    view.configured = false;
    view.isLoading = false;
    view.withImages = false;

    const screen = await renderForVRT(<MarketplaceMyShop />, { viewport: VRT_VIEWPORT_MOBILE, disableHover: true });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('my-shop-create-mobile');
  });

  it('renders the edit state for an existing shop at desktop viewport', async () => {
    view.configured = true;
    view.isLoading = false;
    view.withImages = false;

    const screen = await renderForVRT(<MarketplaceMyShop />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('my-shop-edit-desktop');
  });

  it('renders the edit state with an avatar and banner set at desktop viewport', async () => {
    view.configured = true;
    view.isLoading = false;
    view.withImages = true;

    const screen = await renderForVRT(<MarketplaceMyShop />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('my-shop-edit-images-desktop');
  });

  it.each([
    ['anywhere', ''],
    ['switzerland', 'CH'],
  ] as const)(
    'renders the ships-to field for a shop shipping %s at desktop viewport',
    async (name, shipsToCountries) => {
      view.configured = true;
      view.isLoading = false;
      view.withImages = false;
      view.shipsToCountries = shipsToCountries;

      const screen = await renderForVRT(<MarketplaceMyShop />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });
      await expect(screen.getByTestId('shop-settings-ships-to')).toMatchScreenshot(`my-shop-ships-to-${name}-desktop`);
    },
  );

  it('renders the loading skeleton at desktop viewport', async () => {
    view.configured = false;
    view.isLoading = true;
    view.withImages = false;

    const screen = await renderForVRT(<MarketplaceMyShop />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('my-shop-loading-desktop');
  });

  it.each([
    ['desktop', VRT_VIEWPORT_DESKTOP],
    ['mobile', VRT_VIEWPORT_MOBILE],
  ] as const)('renders the load-error recovery at %s viewport', async (name, viewport) => {
    view.configured = false;
    view.isLoading = false;
    view.withImages = false;
    view.loadError = true;
    const screen = await renderForVRT(<MarketplaceMyShop />, { viewport, disableHover: true });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(`my-shop-load-error-${name}`);
  });
});
