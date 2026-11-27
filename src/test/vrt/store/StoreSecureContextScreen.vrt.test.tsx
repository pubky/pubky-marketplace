import { describe, expect, it } from 'vitest';
import { StoreSecureContextScreen } from '@/molecules/StoreSecureContextScreen/StoreSecureContextScreen';
import { renderForVRT, VRT_ROOT_TESTID } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';

describe('Store secure context screen — visual regression', () => {
  it('renders the open-over-HTTPS screen at desktop viewport', async () => {
    const screen = await renderForVRT(<StoreSecureContextScreen />, {
      viewport: VRT_VIEWPORT_DESKTOP,
      disableHover: true,
    });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('store-secure-context-desktop');
  });

  it('renders the open-over-HTTPS screen at mobile viewport', async () => {
    const screen = await renderForVRT(<StoreSecureContextScreen />, {
      viewport: VRT_VIEWPORT_MOBILE,
      disableHover: true,
    });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('store-secure-context-mobile');
  });
});
