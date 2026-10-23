import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPABILITIES } from '@/config/app';
import grantCapture from '@/test/fixtures/auth/marketplace-grant-priv-parity.staging.json';
import { SignInContent } from './SignIn';

type Shape = { scheme: string; host: string; params: string[]; caps: string };

function urlFrom(shape: Shape): string {
  return `${shape.scheme}//${shape.host}?${shape.params
    .map((name) => `${name}=${encodeURIComponent(name === 'caps' ? shape.caps : 'x')}`)
    .join('&')}`;
}

const SIGN_IN_URL = urlFrom({ ...grantCapture.shop_signin_request, caps: CAPABILITIES });

const view = vi.hoisted(() => ({
  grantSignIn: false,
}));

vi.mock('@/hooks/useGrantSignInAvailable/useGrantSignInAvailable', () => ({
  useGrantSignInAvailable: () => view.grantSignIn,
}));

vi.mock('next/image', () => ({
  __esModule: true,
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}));

vi.mock('@/hooks/useMobileAuth/useMobileAuth', () => ({
  useMobileAuth: () => ({
    url: SIGN_IN_URL,
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

describe('Sign-in page copy', () => {
  beforeEach(() => {
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

  it('never prints the capability string', () => {
    view.grantSignIn = true;
    render(<SignInContent />);
    expect(document.body.textContent).not.toContain(CAPABILITIES);
    expect(document.body.textContent).not.toMatch(/\/priv\/|\/pub\/|:rw/);
  });
});
