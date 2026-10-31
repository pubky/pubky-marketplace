// Intentional import order — vi.hoisted + vi.mock factories rely on stable
// Vitest `__vi_import_N__` aliases; reordering causes a TDZ crash in
// @vitest/browser. Do not let `eslint --fix` reorder these imports.
/* eslint-disable simple-import-sort/imports */
import { describe, expect, it, vi } from 'vitest';
import { preloadImages, renderForVRT, VRT_ROOT_TESTID } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';
import { createZustandLikeHook } from '@/test-utils/stores';
import { SignInContent } from '@/organisms/SignIn/SignIn';

const SIGN_IN_IMAGE_URLS = ['/images/keyring.webp', '/images/sign-in/cloud.webp'];

const deploy = vi.hoisted(() => ({ requestsKeys: false }));

// The QR encodes the approval URL, which is minted from the network and changes every run.
// Pin it so QRCodeSVG draws the same matrix on every run and OS.
vi.mock('@/hooks/useMobileAuth/useMobileAuth', () => ({
  useMobileAuth: () => ({
    url: 'pubkyauth://signin_grant?caps=%2Fpub%2Fpubky.app%2F%3Arw&relay=https%3A%2F%2Fvrt.example%2Finbox&secret=vrt-fixed-secret&cid=shop.pubky.app&cpk=vrtfixedclientkey',
    isLoading: false,
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

vi.mock('@/stores/onboarding/onboarding.store', () => ({
  useOnboardingStore: Object.assign(createZustandLikeHook({ reset: vi.fn() }), {
    getState: () => ({ reset: vi.fn() }),
  }),
}));

describe('SignIn (one QR for Pubky Ring and Bitkit) — visual regression', () => {
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
});
