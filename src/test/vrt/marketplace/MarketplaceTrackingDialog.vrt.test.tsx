// Intentional import order — browser-mode mock factories rely on stable aliases.
/* eslint-disable simple-import-sort/imports */
import { describe, expect, it, vi } from 'vitest';
import { renderForVRT, VRT_ROOT_TESTID } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';
import { MarketplaceTrackingDialog } from '@/organisms/Marketplace/MarketplaceTrackingDialog';

// The seller's add/edit tracking dialog on a shipped order: blank when the
// order was marked shipped without a number, filled when one is on file.
const fixtures = vi.hoisted(async () => {
  const { createOrderFixture } = await import('@/test/fixtures/commerce/orders');
  const shipment = (carrier: string, trackingNumber: string) => ({
    carrier,
    trackingNumber,
    state: 'shipped' as const,
    shippedAt: '2026-08-14T10:00:00.000Z',
    deliveredAt: null,
  });
  return {
    withoutTracking: createOrderFixture('shipped', { shipment: shipment('Other', '') }),
    withTracking: createOrderFixture('shipped', { shipment: shipment('UPS', '1Z999AA10123456784') }),
  };
});

vi.mock('@/controllers/commerce/order-tracking', () => ({
  CommerceOrderTrackingController: { commitUpdateOrderTracking: vi.fn(async () => ({ ok: true })) },
}));

async function openDialog(trigger: { click: () => Promise<void> }) {
  await trigger.click();
  await vi.waitFor(() => {
    if (!document.querySelector('[role="dialog"]')) throw new Error('The dialog has not opened yet.');
  });
  // Focus rings depend on focus-visible heuristics that differ by browser;
  // blur so the capture is deterministic.
  (document.activeElement as HTMLElement | null)?.blur();
}

function DialogHarness({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-10">{children}</main>;
}

describe('Marketplace tracking dialog — visual regression', () => {
  it('renders Add tracking for a shipped order with no number at desktop viewport', async () => {
    const { withoutTracking } = await fixtures;

    const screen = await renderForVRT(
      <DialogHarness>
        <MarketplaceTrackingDialog order={withoutTracking} onChanged={() => {}} />
      </DialogHarness>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await openDialog(screen.getByRole('button', { name: 'Add tracking' }));
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('dialog-tracking-add-desktop');
  });

  it('renders Edit tracking with the current carrier and number at desktop viewport', async () => {
    const { withTracking } = await fixtures;

    const screen = await renderForVRT(
      <DialogHarness>
        <MarketplaceTrackingDialog order={withTracking} onChanged={() => {}} />
      </DialogHarness>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await openDialog(screen.getByRole('button', { name: 'Edit tracking' }));
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('dialog-tracking-edit-desktop');
  });

  it('renders Add tracking at mobile viewport', async () => {
    const { withoutTracking } = await fixtures;

    const screen = await renderForVRT(
      <DialogHarness>
        <MarketplaceTrackingDialog order={withoutTracking} onChanged={() => {}} />
      </DialogHarness>,
      { viewport: VRT_VIEWPORT_MOBILE },
    );
    await openDialog(screen.getByRole('button', { name: 'Add tracking' }));
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('dialog-tracking-add-mobile');
  });
});
