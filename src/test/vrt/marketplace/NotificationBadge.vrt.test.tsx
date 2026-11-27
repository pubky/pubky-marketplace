// Intentional import order — browser-mode mock factories rely on stable aliases.
/* eslint-disable simple-import-sort/imports */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderForVRT, VRT_ROOT_TESTID } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP } from '@/test-utils/vrt.viewports';
import { HeaderSignIn } from '@/molecules/HeaderSignIn/HeaderSignIn';
import { useNotificationStore } from '@/stores/notification/notification.store';

// Exercise the header badge with the persisted Market unread counter.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/marketplace',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/hooks/useCurrentUserProfile/useCurrentUserProfile', () => ({
  useCurrentUserProfile: () => ({
    userDetails: { name: 'Satoshi', image: null, indexed_at: 0 },
    currentUserPubky: 'v'.repeat(52),
  }),
}));

describe('Notification badge with marketplace unread — visual regression', () => {
  afterEach(() => {
    useNotificationStore.getState().reset();
  });

  it('shows the Market unread badge at desktop viewport', async () => {
    useNotificationStore.getState().setMarketplaceUnread(3);

    const screen = await renderForVRT(<HeaderSignIn />, { viewport: VRT_VIEWPORT_DESKTOP });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('notification-badge-combined-desktop');
  });

  it('shows no badge when the Market unread count is zero', async () => {
    useNotificationStore.getState().setMarketplaceUnread(0);

    const screen = await renderForVRT(<HeaderSignIn />, { viewport: VRT_VIEWPORT_DESKTOP });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('notification-badge-empty-desktop');
  });
});
