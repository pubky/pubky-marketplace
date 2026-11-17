// Intentional import order — browser-mode mock factories rely on stable aliases.
/* eslint-disable simple-import-sort/imports */
import { createMarketplaceVrtAuthStore } from '@/test/mocks/marketplace-vrt';
import { describe, expect, it, vi } from 'vitest';
import { renderForVRT, VRT_ROOT_TESTID } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';
import { USD_ASSET } from '@/libs/commerce/pricing';
import { MarketplaceBidDialog } from '@/organisms/Marketplace/MarketplaceBidDialog';
import { MarketplaceOfferDialog } from '@/organisms/Marketplace/MarketplaceOfferDialog';

const fixtures = vi.hoisted(async () => {
  const { createAuctionProjectionFixture } = await import('@/test/fixtures/commerce/projections');
  return {
    buyer: 'b'.repeat(52),
    auctionProjection: createAuctionProjectionFixture(),
  };
});

vi.mock('@/hooks/useRequireAuth/useRequireAuth', () => ({
  useRequireAuth: () => ({ requireAuth: (action: () => void) => action() }),
}));

vi.mock('@/stores/auth/auth.store', async () => ({
  useAuthStore: createMarketplaceVrtAuthStore({ currentUserPubky: (await fixtures).buyer }),
}));

vi.mock('@/hooks/useMarketplaceBid/useMarketplaceBid', async () => {
  const { useForm } = await import('react-hook-form');
  const { marketplaceBidDefaults } = await import('@/hooks/useMarketplaceBid/useMarketplaceBid.types');
  return {
    useMarketplaceBid: () => ({
      form: useForm({ defaultValues: marketplaceBidDefaults }),
      submit: vi.fn(async () => false),
      reset: vi.fn(),
    }),
  };
});

vi.mock('@/hooks/useMarketplaceOffer/useMarketplaceOffer', async () => {
  const { useForm } = await import('react-hook-form');
  const { marketplaceOfferDefaults } = await import('@/hooks/useMarketplaceOffer/useMarketplaceOffer.types');
  return {
    useMarketplaceOffer: () => ({
      form: useForm({ defaultValues: marketplaceOfferDefaults }),
      submit: vi.fn(async () => false),
      reset: vi.fn(),
    }),
  };
});

async function openDialog(trigger: { click: () => Promise<void> }) {
  await trigger.click();
  await vi.waitFor(() => {
    if (!document.querySelector('[role="dialog"]')) throw new Error('Dialog has not opened yet.');
  });
}

function DialogHarness({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-10">{children}</main>;
}

describe('Marketplace dialogs — visual regression', () => {
  it('renders the open bid dialog at desktop viewport', async () => {
    const { auctionProjection } = await fixtures;

    const screen = await renderForVRT(
      <DialogHarness>
        <MarketplaceBidDialog
          aggregateId={auctionProjection.aggregateId}
          projection={auctionProjection}
          priceAsset={USD_ASSET}
          onAccepted={() => {}}
        />
      </DialogHarness>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await openDialog(screen.getByRole('button', { name: 'Place a bid' }));
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('dialog-bid-open-desktop');
  });

  it('renders the open bid dialog at mobile viewport', async () => {
    const { auctionProjection } = await fixtures;

    const screen = await renderForVRT(
      <DialogHarness>
        <MarketplaceBidDialog
          aggregateId={auctionProjection.aggregateId}
          projection={auctionProjection}
          priceAsset={USD_ASSET}
          onAccepted={() => {}}
        />
      </DialogHarness>,
      { viewport: VRT_VIEWPORT_MOBILE },
    );
    await openDialog(screen.getByRole('button', { name: 'Place a bid' }));
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('dialog-bid-open-mobile');
  });

  it('renders the open bid dialog in light mode at desktop viewport', async () => {
    const { auctionProjection } = await fixtures;

    const screen = await renderForVRT(
      <DialogHarness>
        <MarketplaceBidDialog
          aggregateId={auctionProjection.aggregateId}
          projection={auctionProjection}
          priceAsset={USD_ASSET}
          onAccepted={() => {}}
        />
      </DialogHarness>,
      { viewport: VRT_VIEWPORT_DESKTOP, theme: 'light' },
    );
    await openDialog(screen.getByRole('button', { name: 'Place a bid' }));
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('dialog-bid-open-light-desktop');
  });

  it('renders the open bid dialog in light mode at mobile viewport', async () => {
    const { auctionProjection } = await fixtures;

    const screen = await renderForVRT(
      <DialogHarness>
        <MarketplaceBidDialog
          aggregateId={auctionProjection.aggregateId}
          projection={auctionProjection}
          priceAsset={USD_ASSET}
          onAccepted={() => {}}
        />
      </DialogHarness>,
      { viewport: VRT_VIEWPORT_MOBILE, theme: 'light' },
    );
    await openDialog(screen.getByRole('button', { name: 'Place a bid' }));
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('dialog-bid-open-light-mobile');
  });

  it('renders the open offer dialog at desktop viewport', async () => {
    const { auctionProjection } = await fixtures;

    const screen = await renderForVRT(
      <DialogHarness>
        <MarketplaceOfferDialog
          aggregateId={auctionProjection.aggregateId}
          expectedRevision={3}
          priceAsset={USD_ASSET}
          askingPrice={auctionProjection.unitPrice}
          onAccepted={() => {}}
        />
      </DialogHarness>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await openDialog(screen.getByRole('button', { name: 'Make offer' }));
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('dialog-offer-open-desktop');
  });
});
