// Intentional import order — vi.hoisted + vi.mock factories rely on stable
// Vitest `__vi_import_N__` aliases; reordering causes a TDZ crash in
// @vitest/browser. Do not let `eslint --fix` reorder these imports.
/* eslint-disable simple-import-sort/imports */
import { describe, expect, it, vi } from 'vitest';
import { renderForVRT, VRT_DENSE_CHROME_SCREENSHOT, VRT_ROOT_TESTID } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';
import { createZustandLikeHook } from '@/test-utils/stores';
import { Header } from '@/organisms/Header/Header';
import { CompleteProfile } from '@/templates/Account/CompleteProfile/CompleteProfile';

// Include the production account-maintenance header.
function ProfileWithHeader() {
  return (
    <>
      <Header />
      <CompleteProfile />
    </>
  );
}

vi.mock('next/navigation', () => {
  const router = {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  };
  return {
    useRouter: () => router,
    usePathname: () => '/complete-profile',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({}),
  };
});

vi.mock('@/molecules/Toaster/toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/stores/auth/auth.store', async () => {
  const { mockGrantSession } = await import('@/test-utils/pubky');
  const pubky = 'vrt000000000000000000000000000000000000000000alice01';
  const session = mockGrantSession(pubky);
  return {
    useAuthStore: createZustandLikeHook({
      currentUserPubky: pubky,
      session,
      hasProfile: false,
      selectCurrentUserPubky: () => pubky,
      selectSession: () => session,
      hasHydrated: true,
    }),
  };
});

// Header reads public-route state (auth store is mocked above).
vi.mock('@/hooks/usePublicRoute/usePublicRoute', () => ({
  usePublicRoute: () => ({ isCoreExploreRoute: false, isDynamicPublicRoute: false }),
}));

describe('Complete profile — visual regression', () => {
  it('renders the Pubky App profile handoff at desktop viewport', async () => {
    const screen = await renderForVRT(<ProfileWithHeader />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(
      'complete-profile-desktop',
      VRT_DENSE_CHROME_SCREENSHOT,
    );
  });

  it('renders the Pubky App profile handoff at mobile viewport', async () => {
    const screen = await renderForVRT(<ProfileWithHeader />, { viewport: VRT_VIEWPORT_MOBILE, disableHover: true });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('complete-profile-mobile');
  });
});
