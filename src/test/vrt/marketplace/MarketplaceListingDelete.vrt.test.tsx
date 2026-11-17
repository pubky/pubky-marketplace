// Intentional import order — browser-mode mock factories rely on stable aliases.
/* eslint-disable simple-import-sort/imports */
import { describe, expect, it, vi } from 'vitest';
import { expectVrtSurface, renderForVRT } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';
import { MarketplaceListingDeleteDialog } from '@/organisms/Marketplace/MarketplaceListingDeleteDialog';
import type {
  ListingDeletePlan,
  UseDeleteMarketplaceListingsResult,
} from '@/hooks/useDeleteMarketplaceListings/useDeleteMarketplaceListings';

const fixtures = vi.hoisted(async () => {
  const { COMMERCE_FIXTURE_SELLER, createCommerceListingFixture } = await import('@/test/fixtures/commerce/commerce');
  const target = (listingId: string, title: string) => ({
    ownerPubky: COMMERCE_FIXTURE_SELLER,
    listingId,
    title,
    record: createCommerceListingFixture({ listingId }),
  });
  return { target };
});

function controllerFor(plan: ListingDeletePlan): UseDeleteMarketplaceListingsResult {
  return {
    open: true,
    plan,
    isDeleting: false,
    hasHomeserverSession: true,
    request: async () => {},
    confirm: async () => {},
    cancel: () => {},
  };
}

async function waitForDialog() {
  await vi.waitFor(() => {
    if (!document.querySelector('[data-surface="listing-delete-dialog"]')) {
      throw new Error('The delete dialog has not opened yet.');
    }
  });
  (document.activeElement as HTMLElement | null)?.blur();
}

describe('Marketplace listing delete — visual regression', () => {
  it('renders the confirmation for one listing with open orders at desktop viewport', async () => {
    const { target } = await fixtures;
    const plan: ListingDeletePlan = {
      targets: [target('boots', 'Vintage leather boots')],
      blocked: [],
      openOrders: 2,
      ordersChecked: true,
    };

    await renderForVRT(<MarketplaceListingDeleteDialog controller={controllerFor(plan)} />, {
      viewport: VRT_VIEWPORT_DESKTOP,
    });
    await waitForDialog();

    await expect(await expectVrtSurface('listing-delete-dialog')).toMatchScreenshot(
      'delete-single-open-orders-desktop',
    );
  });

  it('renders the bulk confirmation at mobile viewport', async () => {
    const { target } = await fixtures;
    const plan: ListingDeletePlan = {
      targets: [target('boots', 'Vintage leather boots'), target('lamp', 'Brass desk lamp')],
      blocked: [],
      openOrders: 0,
      ordersChecked: true,
    };

    await renderForVRT(<MarketplaceListingDeleteDialog controller={controllerFor(plan)} />, {
      viewport: VRT_VIEWPORT_MOBILE,
    });
    await waitForDialog();

    await expect(await expectVrtSurface('listing-delete-dialog')).toMatchScreenshot('delete-bulk-mobile');
  });
});
