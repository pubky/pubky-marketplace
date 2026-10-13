// Intentional import order — browser-mode mock factories rely on stable aliases.
/* eslint-disable simple-import-sort/imports */
import { describe, expect, it, vi } from 'vitest';
import { expectVrtSurface, renderForVRT } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';
import { DELIVERY_KEY_COPY } from '@/libs/commerce/delivery-key-copy';
import { DeliveryKeyBlockedNotice } from '@/molecules/Marketplace/DeliveryKeyBlockedNotice';
import { ListingPublishGuardNotice } from '@/molecules/Marketplace/ListingPublishGuardNotice';
import { MarketplaceDeliveryKeyStep } from '@/organisms/Marketplace/MarketplaceDeliveryKeyStep';

const SELLER = 'gy1wnkhfwezwdnawnur1bc3kw1x3jf5ggjj3cm37e31i5ntq3pco';

const keyState = vi.hoisted(() => ({
  publication: 'missing' as 'missing' | 'matches',
}));

vi.mock('@/hooks/useMyDeliveryKey/useMyDeliveryKey', () => ({
  useMyDeliveryKey: () => ({
    enabled: true,
    isLoading: false,
    isWorking: false,
    loadFailed: false,
    status: {
      local: null,
      publication: keyState.publication,
      publishedKeyId: keyState.publication === 'matches' ? 'k'.repeat(32) : null,
    },
    create: async () => true,
    publish: async () => true,
  }),
}));

vi.mock('@/organisms/Marketplace/MarketplaceSessionConnectDialog', () => ({
  MarketplaceSessionConnectDialog: () => null,
}));

function Page({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10">{children}</main>;
}

describe('Delivery key — visual regression', () => {
  it.each([
    ['desktop', VRT_VIEWPORT_DESKTOP],
    ['mobile', VRT_VIEWPORT_MOBILE],
  ] as const)('renders the buyer-facing missing delivery key notice at %s', async (name, viewport) => {
    await renderForVRT(
      <Page>
        <DeliveryKeyBlockedNotice block={{ kind: 'no_key', sellerPubky: SELLER, message: DELIVERY_KEY_COPY.noKey }} />
      </Page>,
      { viewport },
    );
    await expect(await expectVrtSurface('delivery-key-blocked')).toMatchScreenshot(`delivery-key-blocked-${name}`);
  });

  it.each([
    ['not-created', 'missing'],
    ['published', 'matches'],
  ] as const)('renders the selling setup delivery key step when %s', async (name, publication) => {
    keyState.publication = publication;
    await renderForVRT(
      <Page>
        <MarketplaceDeliveryKeyStep />
      </Page>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await expect(await expectVrtSurface('marketplace-delivery-key-step')).toMatchScreenshot(
      `delivery-key-step-${name}-desktop`,
    );
  });

  it('renders the publish guard that asks a seller to create the delivery key', async () => {
    await renderForVRT(
      <Page>
        <ListingPublishGuardNotice
          reason="no-delivery-key"
          surface="listing-publish-guard"
          id="listing-publish-guard"
          density="action"
        />
      </Page>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await expect(await expectVrtSurface('listing-publish-guard')).toMatchScreenshot(
      'delivery-key-publish-guard-desktop',
    );
  });
});
