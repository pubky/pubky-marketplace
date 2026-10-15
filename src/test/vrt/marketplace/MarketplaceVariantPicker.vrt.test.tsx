import { describe, expect, it, vi } from 'vitest';
import { MarketplaceVariantPicker } from '@/organisms/Marketplace/MarketplaceVariantPicker';
import { createCommerceListingFixture } from '@/test/fixtures/commerce/commerce';
import { renderForVRT, VRT_ROOT_TESTID } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';

const record = createCommerceListingFixture({
  variants: [
    { id: 'size_s', options: { size: 'S' }, quantity: 3, mediaIds: [], enabled: true },
    { id: 'size_m', options: { size: 'M' }, quantity: 4, mediaIds: [], enabled: true },
    { id: 'size_l', options: { size: 'L' }, quantity: 2, mediaIds: [], enabled: true },
  ],
});

function Harness() {
  return (
    <main className="marketplace-surface mx-auto w-full max-w-sm px-6 py-10 font-medium">
      <MarketplaceVariantPicker
        record={record}
        selectedVariantId="size_m"
        onSelect={() => {}}
        soldOutVariantIds={new Set(['size_s'])}
      />
    </main>
  );
}

async function openPicker(screen: Awaited<ReturnType<typeof renderForVRT>>) {
  await screen.getByRole('combobox', { name: 'Choose listing variant' }).click();
  await vi.waitFor(() => {
    if (!document.querySelector('[role="listbox"]')) throw new Error('The size picker has not opened yet.');
  });
}

describe('Marketplace size picker — visual regression', () => {
  it('lists a sold-out size as disabled and labelled at desktop viewport', async () => {
    const screen = await renderForVRT(<Harness />, { viewport: VRT_VIEWPORT_DESKTOP });
    await openPicker(screen);
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('variant-picker-sold-out-desktop');
  });

  it('lists a sold-out size as disabled and labelled at mobile viewport', async () => {
    const screen = await renderForVRT(<Harness />, { viewport: VRT_VIEWPORT_MOBILE });
    await openPicker(screen);
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('variant-picker-sold-out-mobile');
  });
});
