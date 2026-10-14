import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RING_COOKIE_CAPABILITIES } from '@/config/app';
import grantCapture from '@/test/fixtures/auth/marketplace-grant-priv-parity.staging.json';
import ringCapture from '@/test/fixtures/auth/ring-signin-url.sdk-0.8.0.json';
import { SignInContent } from './SignIn';

type Shape = { scheme: string; host: string; params: string[]; caps: string };

function urlFrom(shape: Shape): string {
  return `${shape.scheme}//${shape.host}?${shape.params
    .map((name) => `${name}=${encodeURIComponent(name === 'caps' ? shape.caps : 'x')}`)
    .join('&')}`;
}

const RING_SIGN_IN_URL = urlFrom({ ...ringCapture, caps: RING_COOKIE_CAPABILITIES });
const BITKIT_SIGN_IN_URL = urlFrom(grantCapture.shop_signin_request);

const view = vi.hoisted(() => ({
  singleApproval: true,
  mode: 'transaction-service' as string,
  grantSignIn: false,
}));

vi.mock('@/libs/runtime-config/runtime-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/libs/runtime-config/runtime-config')>()),
  getSingleApprovalSignIn: () => view.singleApproval,
  getCommerceAdapterMode: () => view.mode,
}));

vi.mock('@/hooks/useGrantSignInAvailable/useGrantSignInAvailable', () => ({
  useGrantSignInAvailable: () => view.grantSignIn,
}));

vi.mock('next/image', () => ({
  __esModule: true,
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}));

vi.mock('@/hooks/useMobileAuth/useMobileAuth', () => ({
  useMobileAuth: (options?: { type?: 'grant' }) => ({
    url: options?.type === 'grant' ? BITKIT_SIGN_IN_URL : RING_SIGN_IN_URL,
    isLoading: false,
    isExpired: false,
    fetchUrl: vi.fn(),
    copyAuthUrl: vi.fn(),
    isOpeningRing: false,
    onAuthorizeClick: vi.fn(),
  }),
}));

describe('Sign-in page copy', () => {
  beforeEach(() => {
    view.singleApproval = true;
    view.mode = 'transaction-service';
    view.grantSignIn = false;
  });

  it.each([
    ['Ring-only layout', false],
    ['combined Ring and Bitkit layout', true],
  ])('adds no marketplace approval paragraph beside the Ring QR in the %s', (_label, grantSignIn) => {
    view.grantSignIn = grantSignIn;
    render(<SignInContent />);

    expect(screen.queryByTestId('session-approval-disclosure')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Approving signs you in|private Shop data|social and Locks access/);
  });

  it('adds none after switching to Bitkit either', () => {
    view.grantSignIn = true;
    render(<SignInContent />);
    fireEvent.click(screen.getByRole('radio', { name: 'Bitkit' }));

    expect(screen.queryByTestId('session-approval-disclosure')).toBeNull();
  });

  it('never prints the capability string', () => {
    view.grantSignIn = true;
    render(<SignInContent />);
    expect(document.body.textContent).not.toContain(RING_COOKIE_CAPABILITIES);
    expect(document.body.textContent).not.toMatch(/\/priv\/|\/pub\/|:rw/);
  });
});
