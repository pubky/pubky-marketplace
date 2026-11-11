// Intentional import order — vi.hoisted + vi.mock factories rely on stable
// Vitest `__vi_import_N__` aliases; reordering causes a TDZ crash in
// @vitest/browser. Do not let `eslint --fix` reorder these imports.
/* eslint-disable simple-import-sort/imports */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { preloadImages, renderForVRT, VRT_ROOT_TESTID } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';
import { createZustandLikeHook } from '@/test-utils/stores';
import { SignInContent } from '@/organisms/SignIn/SignIn';
import { Header } from '@/organisms/Header/Header';
import { SignInPage } from '@/templates/Auth/SignInPage/SignInPage';
import { expectGraphicContrast, expectTextContrast } from '@/test-utils/color-contrast';

const SIGN_IN_IMAGE_URLS = ['/images/keyring.webp', '/images/sign-in/cloud.webp'];

const deploy = vi.hoisted(() => ({ requestsKeys: false }));
const authState = vi.hoisted(() => ({ isLoading: false }));
const backupState = vi.hoisted(() => ({ saved: false }));

// The QR encodes the approval URL, which is minted from the network and changes every run.
// Pin it so QRCodeSVG draws the same matrix on every run and OS.
vi.mock('@/hooks/useMobileAuth/useMobileAuth', () => ({
  useMobileAuth: () => ({
    url: authState.isLoading
      ? ''
      : 'pubkyauth://signin_grant?caps=%2Fpub%2Fpubky.app%2F%3Arw&relay=https%3A%2F%2Fvrt.example%2Finbox&secret=vrt-fixed-secret&cid=shop.pubky.app&cpk=vrtfixedclientkey',
    isLoading: authState.isLoading,
    isExpired: false,
    fetchUrl: vi.fn(),
    copyAuthUrl: vi.fn(),
    isOpeningRing: false,
    openingSigner: null,
    onAuthorizeClick: vi.fn(),
    authorizeWith: vi.fn(),
  }),
}));

vi.mock('@/hooks/useGrantSignInAvailable/useGrantSignInAvailable', () => ({
  useGrantSignInAvailable: () => true,
}));

vi.mock('@/hooks/usePassportSignIn/usePassportSignIn', () => ({
  usePassportSignIn: () => ({ isAvailable: true, isPending: false, start: vi.fn() }),
}));

vi.mock('@/config/app', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config/app')>()),
  isPrivKeysRequested: () => deploy.requestsKeys,
}));

vi.mock('@/stores/signIn/signIn.store', () => ({
  useSignInStore: createZustandLikeHook({
    authUrlResolved: false,
    profileChecked: false,
    bootstrapFetched: false,
    dataPersisted: false,
    homeserverSynced: false,
    error: null,
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/sign-in',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));
vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: createZustandLikeHook({ currentUserPubky: null, session: null, hasHydrated: true }),
}));
vi.mock('@/hooks/usePublicRoute/usePublicRoute', () => ({
  usePublicRoute: () => ({ isCoreExploreRoute: false, isDynamicPublicRoute: false }),
}));

vi.mock('@/stores/onboarding/onboarding.store', () => ({
  useOnboardingStore: createZustandLikeHook({
    hasHydrated: true,
    selectHasSecretKey: () => backupState.saved,
    selectHasMnemonic: () => backupState.saved,
  }),
}));

describe('SignIn (one QR for Pubky Ring and Bitkit) — visual regression', () => {
  beforeEach(() => {
    deploy.requestsKeys = false;
    authState.isLoading = false;
    backupState.saved = false;
  });

  it('keeps the QR loading text and spinner visible in light mode', async () => {
    authState.isLoading = true;
    await preloadImages(SIGN_IN_IMAGE_URLS);
    const screen = await renderForVRT(<SignInContent />, {
      viewport: VRT_VIEWPORT_DESKTOP,
      theme: 'light',
      disableHover: true,
    });
    const qrButton = screen.getByRole('button', { name: 'Copy authentication link' });
    await expect(qrButton).toBeDisabled();
    await expect(screen.getByText('Generating QR Code...')).toBeVisible();
    expectTextContrast(screen.getByText('Generating QR Code...').element());
    const spinner = qrButton.element().querySelector('svg');
    expect(spinner).not.toBeNull();
    expectGraphicContrast(spinner!, qrButton.element());
  });

  it('renders the shared QR with both logos at desktop viewport', async () => {
    deploy.requestsKeys = false;
    await preloadImages(SIGN_IN_IMAGE_URLS);
    const screen = await renderForVRT(<SignInContent />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('sign-in-one-qr-desktop');
  });

  it('renders the sign-in without keys link beside the shared QR when keys are requested', async () => {
    deploy.requestsKeys = true;
    await preloadImages(SIGN_IN_IMAGE_URLS);
    const screen = await renderForVRT(<SignInContent />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('sign-in-one-qr-keys-desktop');
  });

  it('renders one Authorize button per signer at mobile viewport', async () => {
    deploy.requestsKeys = false;
    await preloadImages(SIGN_IN_IMAGE_URLS);
    const screen = await renderForVRT(<SignInContent />, { viewport: VRT_VIEWPORT_MOBILE, disableHover: true });
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('sign-in-one-qr-mobile');
  });
  it.each([
    ['desktop', VRT_VIEWPORT_DESKTOP],
    ['mobile', VRT_VIEWPORT_MOBILE],
  ] as const)('offers saved-key backup on %s', async (name, viewport) => {
    backupState.saved = true;
    await preloadImages(SIGN_IN_IMAGE_URLS);
    const screen = await renderForVRT(
      <>
        <Header />
        <SignInPage />
      </>,
      { viewport, disableHover: true },
    );
    await expect(screen.getByRole('link', { name: 'Back up saved keys' })).toHaveAttribute('href', '/backup');
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(`sign-in-saved-backup-${name}`);
  });
});
