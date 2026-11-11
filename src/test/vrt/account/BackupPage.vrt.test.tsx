// Intentional import order: Vitest browser mock factories use the store helper.
/* eslint-disable simple-import-sort/imports */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { preloadImages, renderForVRT, VRT_ROOT_TESTID } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';
import { createZustandLikeHook } from '@/test-utils/stores';
import { Header } from '@/organisms/Header/Header';
import { BackupPage } from '@/templates/Account/BackupPage/BackupPage';

const legacy = vi.hoisted(() => ({ saved: true, hydrated: true }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/backup',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));
vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: createZustandLikeHook({ currentUserPubky: null, session: null, hasProfile: false, hasHydrated: false }),
}));
vi.mock('@/stores/onboarding/onboarding.store', () => ({
  useOnboardingStore: createZustandLikeHook({
    get hasHydrated() {
      return legacy.hydrated;
    },
    mnemonic: 'fictional visual fixture words',
    selectHasSecretKey: () => legacy.saved,
    selectHasMnemonic: () => legacy.saved,
    selectSecretKey: () => '00'.repeat(32),
    clearSecrets: vi.fn(),
  }),
}));
vi.mock('@/hooks/usePublicRoute/usePublicRoute', () => ({
  usePublicRoute: () => ({ isCoreExploreRoute: false, isDynamicPublicRoute: false }),
}));

function BackupWithHeader() {
  return (
    <>
      <Header />
      <BackupPage />
    </>
  );
}

describe('Saved legacy keys — visual regression', () => {
  beforeEach(() => {
    legacy.saved = true;
    legacy.hydrated = true;
  });
  for (const [name, viewport] of [
    ['desktop', VRT_VIEWPORT_DESKTOP],
    ['mobile', VRT_VIEWPORT_MOBILE],
  ] as const) {
    it(`renders backup methods on ${name} without an authenticated session`, async () => {
      await preloadImages(['/images/shield.webp']);
      const screen = await renderForVRT(<BackupWithHeader />, { viewport, disableHover: true });
      await expect(screen.getByRole('button', { name: 'Recovery phrase', exact: true })).toBeVisible();
      await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(`saved-backup-${name}`);
    });
    it(`renders the empty backup on ${name}`, async () => {
      legacy.saved = false;
      const screen = await renderForVRT(<BackupWithHeader />, { viewport, disableHover: true });
      await expect(screen.getByText('No saved keys in this browser')).toBeVisible();
      await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(`saved-backup-empty-${name}`);
    });
    it(`waits for local key hydration on ${name}`, async () => {
      legacy.hydrated = false;
      const screen = await renderForVRT(<BackupWithHeader />, { viewport, disableHover: true });
      await expect(screen.getByLabelText('Loading saved keys')).toBeVisible();
      await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(`saved-backup-loading-${name}`);
    });
  }
});
