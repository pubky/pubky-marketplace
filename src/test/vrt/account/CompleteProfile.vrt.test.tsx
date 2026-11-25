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
import { CreateProfileForm } from '@/organisms/CreateProfileForm/CreateProfileForm';
import { userEvent } from 'vitest/browser';
import { expectTextContrast } from '@/test-utils/color-contrast';
import { mockPubky } from '@/test-utils/pubky';
import { useCurrentUserProfile } from '@/hooks/useCurrentUserProfile/useCurrentUserProfile';
import { EditProfileForm } from '@/organisms/Settings/EditProfileForm/EditProfileForm';

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

vi.mock('@/hooks/useCurrentUserProfile/useCurrentUserProfile', { spy: true });

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

describe.each([
  ['create', CreateProfileForm],
  ['edit', EditProfileForm],
] as const)('%s profile avatar validation', (_mode, Profile) => {
  it.each(['dark', 'light'] as const)('shows a readable image error in %s mode', async (theme) => {
    const pubky = mockPubky('vrt000000000000000000000000000000000000000000alice01');
    const profile = {
      currentUserPubky: pubky,
      userDetails: { id: pubky, name: 'Alice', bio: '', status: null, links: [], image: null, indexed_at: 0 },
    };
    await vi.mocked(useCurrentUserProfile).withImplementation(
      () => profile,
      async () => {
        const screen = await renderForVRT(<Profile />, { viewport: VRT_VIEWPORT_DESKTOP, theme });
        const input = screen
          .getByTestId(VRT_ROOT_TESTID)
          .element()
          .querySelector<HTMLInputElement>('input[type="file"]')!;
        await userEvent.upload(input, new File(['text'], 'note.txt', { type: 'text/plain' }));
        const error = screen.getByText('Avatar must be an image file');
        await expect.element(error).toBeVisible();
        expectTextContrast(error.element());
      },
    );
  });
});
