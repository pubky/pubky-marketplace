// Intentional import order — browser-mode mock factories rely on stable aliases.
/* eslint-disable simple-import-sort/imports */
import { createMarketplaceVrtCommerceController } from '@/test/mocks/marketplace-vrt';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { preloadImages, renderForVRT, VRT_ROOT_TESTID } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';
import { MarketplaceSessionConnectDialog } from '@/organisms/Marketplace/MarketplaceSessionConnectDialog';
import { MarketplaceSessionRequiredCard } from '@/organisms/Marketplace/MarketplaceSessionRequiredCard';
import { BOOTSTRAP_APPROVAL_EXPIRED } from '@/libs/commerce/failure-messages';

// The QR encodes the authorization URL verbatim, so it must be a FIXED fake
// for a byte-stable matrix across runs and OSes. It is never dereferenced.
const VRT_AUTH_URL =
  'pubkyauth://signin_grant?caps=%2Fpub%2Fpubky.app%2Fmarketplace-service%2Fv1%2F%3Arw&relay=https%3A%2F%2Fvrt.invalid%2Finbox&secret=vrt-fixed-secret&cid=vrt.invalid&cpk=vrt-fixed-cpk';

const QR_LOGO_URLS = ['/images/ring-logo.svg'];

// The session-connect dialog in its three real states: awaiting approval
// (QR + deeplink affordances), the failure state with the transport's actual
// error and a fresh-flow retry, and the session-required card that durable
// surfaces render in place of the old dead end.
const view = vi.hoisted(() => ({
  status: 'awaiting' as
    | 'idle'
    | 'creating'
    | 'awaiting'
    | 'verifying'
    | 'claiming'
    | 'connected'
    | 'mismatch'
    | 'expired'
    | 'cancelled'
    | 'error',
  authorizationUrl: '',
  errorMessage: null as string | null,
  isOpeningRing: false,
  grantEnabled: false,
  bootstrap: false,
  requiresSignIn: false,
  passportEnabled: true,
  hosted: false,
  approvalSigner: 'Pubky Ring' as 'Bitkit' | 'Pubky Ring' | 'Pubky Passport' | 'your signer',
}));

const VRT_BOOTSTRAP_URL =
  'pubkyauth://signin_grant?caps=%2Fpub%2Fpubky.app%2Fmarketplace-service%2Fv1%2F%3Arw&relay=https%3A%2F%2Fvrt.invalid%2Finbox&secret=vrt-fixed-secret&cid=vrt.invalid&cpk=vrt-fixed-cpk';

vi.mock('@/providers/ShopHostSessionProvider/ShopHostSessionProvider', () => ({
  useIsShopHosted: () => view.hosted,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/marketplace/orders',
}));

// Shop's homeserver grant is already present. This dialog obtains the separate
// marketplace service approval for the same identity.
vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    ...createMarketplaceVrtCommerceController(),
    hasFullHomeserverGrant: () => true,
  },
}));

vi.mock('@/hooks/useMarketplaceApprovalSigner/useMarketplaceApprovalSigner', () => ({
  useMarketplaceApprovalSigner: () => view.approvalSigner,
}));

vi.mock('@/hooks/useMarketplaceSessionConnect/useMarketplaceSessionConnect', () => ({
  useMarketplaceSessionConnect: () => ({
    status: view.status,
    authorizationUrl: view.authorizationUrl,
    errorMessage: view.errorMessage,
    requestsFullGrant: false,
    requestsGrantReconnect: view.grantEnabled && !view.bootstrap,
    requestsGrantBootstrap: view.bootstrap,
    requestsPassport: view.approvalSigner === 'Pubky Passport' && view.passportEnabled,
    requiresSignIn: view.requiresSignIn,
    approvalSigner: view.approvalSigner,
    start: vi.fn(),
    startPassport: vi.fn(),
    cancel: vi.fn(),
    copyAuthUrl: vi.fn(async () => {}),
    openInRing: vi.fn(),
    isOpeningRing: view.isOpeningRing,
  }),
}));

vi.mock('@/libs/runtime-config/runtime-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/libs/runtime-config/runtime-config')>()),
  getMarketplaceGrantFlowEnabled: () => view.grantEnabled,
  getPassportSignInEnabled: () => view.passportEnabled,
}));

async function openDialog(trigger: { click: () => Promise<void> }) {
  await trigger.click();
  await vi.waitFor(() => {
    if (!document.querySelector('[role="dialog"]')) throw new Error('Dialog has not opened yet.');
  });
}

function Harness({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-10">{children}</main>;
}

describe('Marketplace session connect — visual regression', () => {
  beforeEach(() => {
    view.status = 'awaiting';
    view.authorizationUrl = '';
    view.errorMessage = null;
    view.isOpeningRing = false;
    view.grantEnabled = true;
    view.bootstrap = false;
    view.requiresSignIn = false;
    view.passportEnabled = true;
    view.hosted = false;
    view.approvalSigner = 'Pubky Ring';
  });

  it.each([
    ['desktop', VRT_VIEWPORT_DESKTOP],
    ['mobile', VRT_VIEWPORT_MOBILE],
  ] as const)('asks hosted and recovery-key users to choose their signer at %s viewport', async (name, viewport) => {
    view.approvalSigner = 'your signer';
    view.status = 'idle';
    view.bootstrap = true;
    const screen = await renderForVRT(
      <Harness>
        <MarketplaceSessionConnectDialog triggerLabel="Approve purchases" />
      </Harness>,
      { viewport },
    );
    await openDialog(screen.getByRole('button', { name: 'Approve purchases' }));
    await expect(screen.getByRole('button', { name: 'Pubky Ring', exact: true })).toBeVisible();
    await expect(screen.getByRole('button', { name: 'Pubky Passport', exact: true })).toBeVisible();
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(`session-connect-signer-choice-${name}`);
  });

  it.each([
    ['standalone-desktop', false, VRT_VIEWPORT_DESKTOP],
    ['standalone-mobile', false, VRT_VIEWPORT_MOBILE],
    ['hosted-desktop', true, VRT_VIEWPORT_DESKTOP],
    ['hosted-mobile', true, VRT_VIEWPORT_MOBILE],
  ] as const)('offers sign-in for a remembered identity without authority (%s)', async (name, hosted, viewport) => {
    view.requiresSignIn = true;
    view.hosted = hosted;
    view.status = 'idle';
    const screen = await renderForVRT(
      <Harness>
        <MarketplaceSessionConnectDialog triggerLabel="Approve purchases" />
      </Harness>,
      { viewport },
    );
    await openDialog(screen.getByRole('button', { name: 'Approve purchases' }));
    await expect(
      screen.getByRole('button', { name: hosted ? 'Continue in Pubky App' : 'Sign in', exact: true }),
    ).toBeVisible();
    expect(document.querySelector('[aria-label="Copy authorization link"]')).toBeNull();
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(`session-connect-sign-in-${name}`);
  });

  it.each([
    ['desktop', VRT_VIEWPORT_DESKTOP],
    ['mobile', VRT_VIEWPORT_MOBILE],
  ] as const)('offers another signer when Passport is disabled at %s viewport', async (name, viewport) => {
    view.approvalSigner = 'Pubky Passport';
    view.passportEnabled = false;
    view.status = 'idle';
    view.bootstrap = true;
    const screen = await renderForVRT(
      <Harness>
        <MarketplaceSessionConnectDialog triggerLabel="Approve purchases" />
      </Harness>,
      { viewport },
    );
    await openDialog(screen.getByRole('button', { name: 'Approve purchases' }));
    await expect(screen.getByRole('button', { name: 'Pubky Ring', exact: true })).toBeVisible();
    await expect(screen.getByRole('button', { name: 'Bitkit', exact: true })).toBeVisible();
    expect(document.querySelector('[data-testid="marketplace-passport-approval"]')).toBeNull();
    expect(document.querySelector('[aria-label="Copy authorization link"]')).toBeNull();
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot(`session-connect-passport-disabled-${name}`);
  });

  it('offers an explicit Passport popup action at desktop viewport', async () => {
    view.approvalSigner = 'Pubky Passport';
    view.status = 'idle';
    view.bootstrap = true;
    const screen = await renderForVRT(
      <Harness>
        <MarketplaceSessionConnectDialog triggerLabel="Approve purchases" />
      </Harness>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await openDialog(screen.getByRole('button', { name: 'Approve purchases' }));
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('session-connect-passport-desktop');
  });

  it('explains when the deployment has not enabled marketplace grant approvals', async () => {
    view.grantEnabled = false;
    const screen = await renderForVRT(
      <Harness>
        <MarketplaceSessionConnectDialog triggerLabel="Approve purchases" />
      </Harness>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await openDialog(screen.getByRole('button', { name: 'Approve purchases' }));
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('session-connect-unavailable-desktop');
  });

  it('renders the Bitkit purchase bootstrap approval at desktop viewport', async () => {
    view.approvalSigner = 'Bitkit';
    view.grantEnabled = true;
    view.bootstrap = true;
    view.authorizationUrl = VRT_BOOTSTRAP_URL;

    const screen = await renderForVRT(
      <Harness>
        <MarketplaceSessionConnectDialog triggerLabel="Approve purchases" />
      </Harness>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await openDialog(screen.getByRole('button', { name: 'Approve purchases' }));
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('session-connect-bitkit-bootstrap-desktop');
  });

  it('renders the Pubky Ring grant sign-in purchase bootstrap approval at desktop viewport', async () => {
    view.grantEnabled = true;
    view.bootstrap = true;
    view.approvalSigner = 'Pubky Ring';
    view.authorizationUrl = VRT_BOOTSTRAP_URL;

    const screen = await renderForVRT(
      <Harness>
        <MarketplaceSessionConnectDialog triggerLabel="Approve in Pubky Ring or Bitkit" />
      </Harness>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await openDialog(screen.getByRole('button', { name: 'Approve in Pubky Ring or Bitkit' }));
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('session-connect-ring-bootstrap-desktop');
  });

  it('renders a lapsed grant approval with the signers that can approve it at desktop viewport', async () => {
    view.grantEnabled = true;
    view.bootstrap = true;
    view.approvalSigner = 'Pubky Ring';
    view.status = 'error';
    view.errorMessage = BOOTSTRAP_APPROVAL_EXPIRED;

    const screen = await renderForVRT(
      <Harness>
        <MarketplaceSessionConnectDialog triggerLabel="Approve in Pubky Ring or Bitkit" />
      </Harness>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await openDialog(screen.getByRole('button', { name: 'Approve in Pubky Ring or Bitkit' }));
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('session-connect-grant-lapsed-desktop');
  });

  it('renders the awaiting-approval QR state at desktop viewport', async () => {
    view.authorizationUrl = VRT_AUTH_URL;

    await preloadImages(QR_LOGO_URLS);
    const screen = await renderForVRT(
      <Harness>
        <MarketplaceSessionConnectDialog triggerLabel="Approve in Pubky Ring" />
      </Harness>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await openDialog(screen.getByRole('button', { name: 'Approve in Pubky Ring' }));
    await expect(screen.getByRole('button', { name: 'Copy authorization link' })).toBeVisible();
    await expect(
      screen.getByRole('button', { name: 'Authorize with Pubky Ring', includeHidden: true }),
    ).not.toBeVisible();
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('session-connect-awaiting-desktop');
  });

  it('renders the awaiting-approval app button without a QR at mobile viewport', async () => {
    view.authorizationUrl = VRT_AUTH_URL;

    await preloadImages(QR_LOGO_URLS);
    const screen = await renderForVRT(
      <Harness>
        <MarketplaceSessionConnectDialog triggerLabel="Approve in Pubky Ring" />
      </Harness>,
      { viewport: VRT_VIEWPORT_MOBILE },
    );
    await openDialog(screen.getByRole('button', { name: 'Approve in Pubky Ring' }));
    await expect(
      screen.getByRole('button', { name: 'Copy authorization link', includeHidden: true }),
    ).not.toBeVisible();
    await expect(screen.getByRole('button', { name: 'Authorize with Pubky Ring' })).toBeVisible();
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('session-connect-awaiting-mobile');
  });

  it('renders the generating state before a URL exists at desktop viewport', async () => {
    view.status = 'idle';

    const screen = await renderForVRT(
      <Harness>
        <MarketplaceSessionConnectDialog triggerLabel="Approve in Pubky Ring" />
      </Harness>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await openDialog(screen.getByRole('button', { name: 'Approve in Pubky Ring' }));
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('session-connect-generating-desktop');
  });

  it('renders the failure state with the real error and retry at desktop viewport', async () => {
    view.status = 'error';
    view.errorMessage = 'The authorization request expired before it was approved. Start a new connection attempt.';

    const screen = await renderForVRT(
      <Harness>
        <MarketplaceSessionConnectDialog triggerLabel="Approve in Pubky Ring" />
      </Harness>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await openDialog(screen.getByRole('button', { name: 'Approve in Pubky Ring' }));
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('session-connect-error-desktop');
  });

  it('renders the signer-neutral BFF creating state at desktop viewport', async () => {
    view.grantEnabled = true;
    view.status = 'creating';
    const screen = await renderForVRT(
      <Harness>
        <MarketplaceSessionConnectDialog triggerLabel="Approve purchases" />
      </Harness>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await openDialog(screen.getByRole('button', { name: 'Approve purchases' }));
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('session-connect-bff-creating-desktop');
  });

  it('renders the signer-neutral identity mismatch at desktop viewport', async () => {
    view.grantEnabled = true;
    view.status = 'mismatch';
    const screen = await renderForVRT(
      <Harness>
        <MarketplaceSessionConnectDialog triggerLabel="Approve purchases" />
      </Harness>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await openDialog(screen.getByRole('button', { name: 'Approve purchases' }));
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('session-connect-bff-mismatch-desktop');
  });

  it('renders the session-required card that replaces durable-mode dead ends at desktop viewport', async () => {
    const screen = await renderForVRT(
      <Harness>
        <MarketplaceSessionRequiredCard />
      </Harness>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('session-required-card-desktop');
  });

  it('renders the session-required card for a Pubky Ring sign-in with the grant flow on at desktop viewport', async () => {
    view.grantEnabled = true;
    const screen = await renderForVRT(
      <Harness>
        <MarketplaceSessionRequiredCard />
      </Harness>,
      { viewport: VRT_VIEWPORT_DESKTOP },
    );
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('session-required-card-ring-or-bitkit-desktop');
  });

  it('renders the session-required card at mobile viewport', async () => {
    const screen = await renderForVRT(
      <Harness>
        <MarketplaceSessionRequiredCard />
      </Harness>,
      { viewport: VRT_VIEWPORT_MOBILE },
    );
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('session-required-card-mobile');
  });
});
