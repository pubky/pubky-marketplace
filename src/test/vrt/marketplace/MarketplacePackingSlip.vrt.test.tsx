// Intentional import order — browser-mode mock factories rely on stable aliases.
/* eslint-disable simple-import-sort/imports */
import { createMarketplaceVrtAuthStore } from '@/test/mocks/marketplace-vrt';
import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { renderForVRT, VRT_ROOT_TESTID } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';
import { MarketplacePackingSlipDialog } from '@/organisms/Marketplace/MarketplacePackingSlipDialog';

// The seller's print-friendly packing slip. The slip renders ONLY what the
// seller's client legitimately holds — the address this device opened from
// the seller's single-order projection, the restore-the-key stop when it
// cannot, or the truthful unavailable notice with ruled lines.
const fixtures = vi.hoisted(async () => {
  const { createOrderFixture } = await import('@/test/fixtures/commerce/orders');
  const { marketplaceDeliveryAddressSchema } = await import('@/services/marketplace/marketplace-projections');
  const { toCamelCaseWire } = await import('@/libs/commerce/wire-casing');
  const { default: sellerPaidShippingAddress } =
    await import('@/test/fixtures/commerce/seller-paid-shipping-address.json');
  const deliveryAddress = marketplaceDeliveryAddressSchema.parse(toCamelCaseWire(sellerPaidShippingAddress));
  return {
    paidOrder: createOrderFixture('paid'),
    sellerPaidShippingOrder: createOrderFixture('paid', {
      id: '018f47d2-6a27-7c23-a49d-000000009999',
      deliveryAddress,
    }),
    undecryptableOrder: createOrderFixture('paid', {
      id: '018f47d2-6a27-7c23-a49d-000000009998',
      deliveryAddress: {
        format: 'hpke_v1' as const,
        keyId: 'a'.repeat(32),
        commandId: '018f47d2-6a27-7c23-a62f-000000000734',
        envelope: 'A'.repeat(2795),
      },
    }),
    shippedOrder: createOrderFixture('shipped', {
      shipment: {
        carrier: 'USPS',
        trackingNumber: '9400111899223197428490',
        state: 'shipped' as const,
        shippedAt: '2026-08-14T10:00:00.000Z',
        deliveredAt: null,
      },
    }),
  };
});

vi.mock('next/navigation', () => ({
  usePathname: () => '/marketplace/orders',
}));

vi.mock('@/stores/auth/auth.store', async () => ({
  useAuthStore: createMarketplaceVrtAuthStore({
    currentUserPubky: (await fixtures).sellerPaidShippingOrder.sellerPubky,
  }),
}));

vi.mock('@/controllers/commerce/commerce', async () => ({
  CommerceController: {
    getMarketplaceOrder: async (orderId: string) => {
      const { sellerPaidShippingOrder, undecryptableOrder } = await fixtures;
      return [sellerPaidShippingOrder, undecryptableOrder].find((order) => order.id === orderId) ?? null;
    },
    getOrderDeliveryAddress: async (order: { deliveryAddress?: { format: string; address?: unknown } }) =>
      order.deliveryAddress?.format === 'plaintext_v1'
        ? { kind: 'address', address: order.deliveryAddress.address }
        : order.deliveryAddress?.format === 'hpke_v1'
          ? { kind: 'undecryptable', reason: 'key_missing' }
          : { kind: 'none' },
  },
}));

async function openSlip(trigger: { click: () => Promise<void> }) {
  await trigger.click();
  await vi.waitFor(() => {
    if (!document.querySelector('[data-packing-slip]')) throw new Error('The packing slip has not opened yet.');
  });
  // Whether a focus ring paints depends on focus-visible heuristics that
  // differ by browser and by what ran before in the session. Blur so the
  // capture is deterministic regardless of suite context.
  (document.activeElement as HTMLElement | null)?.blur();
}

function SlipHarness({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-10">{children}</main>;
}

describe('Marketplace packing slip — visual regression', () => {
  it('renders the packing slip for a paid order at desktop viewport', async () => {
    const { paidOrder } = await fixtures;

    const screen = await renderForVRT(
      <SlipHarness>
        <MarketplacePackingSlipDialog order={paidOrder} />
      </SlipHarness>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await openSlip(screen.getByRole('button', { name: 'Packing slip' }));
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('packing-slip-paid-desktop');
  });

  it('renders the packing slip for a paid order at mobile viewport', async () => {
    const { paidOrder } = await fixtures;

    const screen = await renderForVRT(
      <SlipHarness>
        <MarketplacePackingSlipDialog order={paidOrder} />
      </SlipHarness>,
      { viewport: VRT_VIEWPORT_MOBILE },
    );
    await openSlip(screen.getByRole('button', { name: 'Packing slip' }));
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('packing-slip-paid-mobile');
  });

  it('renders the packing slip with shipment facts at desktop viewport', async () => {
    const { shippedOrder } = await fixtures;

    const screen = await renderForVRT(
      <SlipHarness>
        <MarketplacePackingSlipDialog order={shippedOrder} />
      </SlipHarness>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await openSlip(screen.getByRole('button', { name: 'Packing slip' }));
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('packing-slip-shipped-desktop');
  });

  it('renders the restore-the-key stop when this device cannot open the address at desktop viewport', async () => {
    const { undecryptableOrder } = await fixtures;

    const screen = await renderForVRT(
      <SlipHarness>
        <MarketplacePackingSlipDialog order={undecryptableOrder} />
      </SlipHarness>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await openSlip(screen.getByRole('button', { name: 'Packing slip' }));
    await vi.waitFor(() => {
      if (!document.querySelector('[data-packing-slip]')?.textContent?.includes('Do not ship yet')) {
        throw new Error('The undecryptable branch has not rendered yet.');
      }
    });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('packing-slip-undecryptable-desktop');
  });

  it('renders a seller paid shipping address at desktop viewport', async () => {
    const { sellerPaidShippingOrder } = await fixtures;

    const screen = await renderForVRT(
      <SlipHarness>
        <MarketplacePackingSlipDialog order={sellerPaidShippingOrder} />
      </SlipHarness>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await openSlip(screen.getByRole('button', { name: 'Packing slip' }));
    await vi.waitFor(() => {
      if (!document.querySelector('[data-packing-slip]')?.textContent?.includes('1 Market Street')) {
        throw new Error('The seller address branch has not rendered yet.');
      }
    });
    const surface = document.querySelector('[data-packing-slip]');
    if (!(surface instanceof HTMLElement)) throw new Error('The packing slip surface is missing.');
    await expect(page.elementLocator(surface)).toMatchScreenshot('packing-slip-seller-paid-shipping-address-desktop');
  });
});
