// Intentional import order — browser-mode mock factories rely on stable aliases.
/* eslint-disable simple-import-sort/imports */
import { createMarketplaceVrtAuthStore } from '@/test/mocks/marketplace-vrt';
import { describe, expect, it, vi } from 'vitest';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { renderForVRT } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP } from '@/test-utils/vrt.viewports';
import { Badge } from '@/atoms/Badge/Badge';
import { asOpaque } from '@/test-utils/type-assertions';
import { BuyerCountryField } from '@/molecules/Marketplace/BuyerCountryField';
import { CheckoutSaleTerms } from '@/molecules/Marketplace/CheckoutSaleTerms';
import { RegionAvailabilityNotice } from '@/molecules/Marketplace/RegionAvailabilityNotice';
import { RegionRefusal } from '@/molecules/Marketplace/RegionRefusal';
import { SellerAnnualLimitNotice } from '@/molecules/Marketplace/SellerAnnualLimitNotice';
import { SellerSaleTerms } from '@/molecules/Marketplace/SellerSaleTerms';
import { SellerStatusBadge } from '@/molecules/Marketplace/SellerStatusBadge';
import {
  type MarketplaceShopSettingsData,
  marketplaceShopSettingsDefaults,
  marketplaceShopSettingsSchema,
} from '@/hooks/useMarketplaceShopSettings/useMarketplaceShopSettings.types';
import {
  type MarketplaceShopSettings,
  MarketplaceShopSettingsFormView,
} from '@/organisms/Marketplace/MarketplaceShopSettingsForm';
import type { RegionAvailability } from '@/hooks/useRegionAvailability/useRegionAvailability';

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: createMarketplaceVrtAuthStore({ currentUserPubky: 'b'.repeat(52) }),
}));

vi.mock('@/hooks/useMarketplaceSellerSummary/useMarketplaceSellerSummary', () => ({
  useMarketplaceSellerSummary: (pubky: string) => ({ displayName: pubky === 'a' ? 'Quiet Shop' : 'Harbour Goods' }),
}));

vi.mock('@/hooks/useSellerAnnualLimit/useSellerAnnualLimit', () => ({
  useSellerAnnualLimit: () => ({ status: 'idle' }),
}));

const SCENE = 'legal-copy-scene';

// Room above the content so a hint that opens upwards stays inside the captured box.
function Scene({ children }: { children: React.ReactNode }) {
  return (
    <div data-testid={SCENE} className="w-[720px] bg-background px-6 pt-56 pb-6">
      {children}
    </div>
  );
}

async function openHint(screen: Awaited<ReturnType<typeof renderForVRT>>, name: string | RegExp) {
  const icon = screen.getByRole('button', { name }).query();
  if (icon) await screen.getByRole('button', { name }).click();
}

async function capture(screen: Awaited<ReturnType<typeof renderForVRT>>, name: string) {
  await expect(screen.getByTestId(SCENE)).toMatchScreenshot(name);
}

const noRegion: RegionAvailability = {
  enabled: true,
  buyerCountry: null,
  setBuyerCountry: vi.fn(),
  needsCountry: false,
  refusal: null,
  canChangeCountry: false,
  usesCountry: false,
  digitalNote: null,
};

const slot = {
  previewUrl: null,
  hasImage: false,
  error: null,
  inputRef: { current: null },
  choose: vi.fn(),
  onInputChange: vi.fn(),
  remove: vi.fn(),
};

function SettingsHarness() {
  const form = useForm<MarketplaceShopSettingsData>({
    resolver: zodResolver(marketplaceShopSettingsSchema),
    defaultValues: { ...marketplaceShopSettingsDefaults, name: 'Quiet Shop', sellerStatus: 'private' },
  });
  const settings = asOpaque<MarketplaceShopSettings>({
    isLoading: false,
    loadError: null,
    hasShop: true,
    revision: 3,
    isSaving: false,
    reload: vi.fn(),
    avatar: slot,
    banner: slot,
    form,
    submit: async () => false,
  });
  return <MarketplaceShopSettingsFormView settings={settings} />;
}

describe('Marketplace legal copy — visual regression', () => {
  it('shows the seller card line for a private seller with its explanation open', async () => {
    const screen = await renderForVRT(
      <Scene>
        <div className="flex items-center gap-2">
          <SellerStatusBadge declaration="private" />
          <SellerSaleTerms declaration="private" />
        </div>
      </Scene>,
      { viewport: VRT_VIEWPORT_DESKTOP, disableHover: false },
    );
    await openHint(screen, 'About this sale');
    await capture(screen, 'legal-seller-card-private-desktop');
  });

  it('shows the seller card line for an undeclared seller with its explanation open', async () => {
    const screen = await renderForVRT(
      <Scene>
        <div className="flex items-center gap-2">
          <Badge variant="outline">Seller</Badge>
          <SellerSaleTerms declaration="undeclared" />
        </div>
      </Scene>,
      { viewport: VRT_VIEWPORT_DESKTOP, disableHover: false },
    );
    await openHint(screen, 'About this sale');
    await capture(screen, 'legal-seller-card-undeclared-desktop');
  });

  it('keeps the private-seller notice and role line next to Pay at checkout', async () => {
    const screen = await renderForVRT(
      <Scene>
        <CheckoutSaleTerms sellerPubkys={['a', 'b']} declarations={{ a: 'private', b: 'trader' }} />
      </Scene>,
      { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true },
    );
    await capture(screen, 'legal-checkout-terms-desktop');
  });

  it('asks for the buyer country with the reason behind an info icon', async () => {
    const screen = await renderForVRT(
      <Scene>
        <BuyerCountryField value={null} onChange={vi.fn()} />
      </Scene>,
      { viewport: VRT_VIEWPORT_DESKTOP, disableHover: false },
    );
    await openHint(screen, /country/i);
    await capture(screen, 'legal-buyer-country-desktop');
  });

  it('gives the digital reason for asking the country behind the info icon', async () => {
    const screen = await renderForVRT(
      <Scene>
        <RegionAvailabilityNotice
          region={{ ...noRegion, needsCountry: true, digitalNote: 'Digital items aren’t available' }}
          testIdPrefix="vrt"
        />
      </Scene>,
      { viewport: VRT_VIEWPORT_DESKTOP, disableHover: false },
    );
    await openHint(screen, /country/i);
    await capture(screen, 'legal-digital-country-desktop');
  });

  it('refuses an EU or UK buyer plainly', async () => {
    const screen = await renderForVRT(
      <Scene>
        <RegionAvailabilityNotice
          region={{
            ...noRegion,
            buyerCountry: 'DE',
            refusal: 'Not available to buyers in the EU or UK',
            canChangeCountry: true,
          }}
          testIdPrefix="vrt"
        />
      </Scene>,
      { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true },
    );
    await capture(screen, 'legal-eu-refusal-desktop');
  });

  it('keeps the buyer country in view with a way to change it once it is set', async () => {
    const screen = await renderForVRT(
      <Scene>
        <RegionAvailabilityNotice
          region={{ ...noRegion, buyerCountry: 'CH', usesCountry: true, digitalNote: 'Digital items aren’t available' }}
          testIdPrefix="vrt"
        />
      </Scene>,
      { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true },
    );
    await capture(screen, 'legal-country-kept-desktop');
  });

  it('puts the refusal above the private-seller notice at checkout, next to Pay', async () => {
    const screen = await renderForVRT(
      <Scene>
        <div className="grid gap-3">
          <RegionRefusal message="Not available to buyers in the EU or UK" testId="vrt-checkout-refusal" />
          <CheckoutSaleTerms sellerPubkys={['b']} declarations={{ b: 'trader' }} />
        </div>
      </Scene>,
      { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true },
    );
    await capture(screen, 'legal-checkout-refusal-desktop');
  });

  it('shows an EU seller their yearly counters with the rule behind an info icon', async () => {
    const screen = await renderForVRT(
      <Scene>
        <SellerAnnualLimitNotice
          limit={{
            enabled: true,
            year: 2026,
            limitReached: false,
            residentInEu: true,
            salesLimit: 29,
            eurLimitCents: 200_000,
            sales: 12,
            eurCents: 85_000,
          }}
        />
      </Scene>,
      { viewport: VRT_VIEWPORT_DESKTOP, disableHover: false },
    );
    await openHint(screen, 'About the yearly limit');
    await capture(screen, 'legal-annual-limit-desktop');
  });

  it('describes the Bitcoin confirmation setting in one line with an info icon for the detail', async () => {
    const screen = await renderForVRT(
      <main className="w-[640px] bg-background p-6">
        <SettingsHarness />
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP, disableHover: false },
    );
    await expect(screen.getByTestId('shop-settings-confirm-bitcoin')).toMatchScreenshot(
      'legal-confirm-bitcoin-desktop',
    );
  });
});
