// Intentional import order — browser-mode mock factories rely on stable aliases.
/* eslint-disable simple-import-sort/imports */
import { createMarketplaceVrtAuthStore } from '@/test/mocks/marketplace-vrt';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderForVRT, VRT_ROOT_TESTID } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';
import { CommerceBlockedNotice } from '@/molecules/Marketplace/CommerceBlockedNotice';
import { COMMERCE_BLOCKED_INFO, COMMERCE_BLOCKED_MESSAGE } from '@/libs/commerce/region-modes';
import { useBuyerCountryStore } from '@/stores/buyer-country/buyer-country.store';

const BUYER = 'y'.repeat(52);

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: createMarketplaceVrtAuthStore({ currentUserPubky: 'y'.repeat(52) }),
}));

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    setBuyerCountry: (countryCode: string | null) =>
      useBuyerCountryStore.getState().setCountry(countryCode, 'y'.repeat(52)),
  },
}));

describe('Marketplace blocked-region buyer notice — visual regression', () => {
  beforeEach(() => {
    useBuyerCountryStore.setState({ country: 'GB', owner: BUYER });
  });

  it.each([
    { name: 'desktop', viewport: VRT_VIEWPORT_DESKTOP },
    { name: 'mobile', viewport: VRT_VIEWPORT_MOBILE },
  ])(
    'renders the blocked line with the saved country and its Change action at $name viewport',
    async ({ name, viewport }) => {
      const screen = await renderForVRT(
        <div className="w-full p-6">
          <CommerceBlockedNotice
            message={COMMERCE_BLOCKED_MESSAGE}
            info={COMMERCE_BLOCKED_INFO}
            source="declared"
            testId="blocked-notice"
          />
        </div>,
        { viewport, disableHover: true },
      );
      await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(`blocked-notice-change-${name}`);
    },
  );

  it('renders the saved country editor with Clear and Cancel at desktop viewport', async () => {
    const screen = await renderForVRT(
      <div className="w-full p-6">
        <CommerceBlockedNotice
          message={COMMERCE_BLOCKED_MESSAGE}
          info={COMMERCE_BLOCKED_INFO}
          source="declared"
          testId="blocked-notice"
        />
      </div>,
      { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true },
    );
    (screen.getByRole('button', { name: 'Change' }).element() as HTMLElement).click();
    await vi.waitFor(() => {
      if (!screen.container.textContent?.includes('Clear my country'))
        throw new Error('The editor has not opened yet.');
    });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('blocked-notice-editor-desktop');
  });
});
