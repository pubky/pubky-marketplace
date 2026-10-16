import { useEffect } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import type { MarketplaceSignerChoice } from '@/hooks/useMarketplaceApprovalSigner/useMarketplaceApprovalSigner';
import { marketplaceApprovalSigner } from '@/hooks/useMarketplaceApprovalSigner/useMarketplaceApprovalSigner';
import { beginMarketplaceBootstrapFlow } from '@/services/marketplace/marketplace-bootstrap-client';
import { beginMarketplaceGrantFlow, type MarketplaceGrantFlow } from '@/services/marketplace/marketplace-grant-client';
import { MarketplaceSessionService } from '@/services/marketplace/marketplace-session';
import { useAuthStore } from '@/stores/auth/auth.store';
import type { GrantSigner } from '@/stores/auth/auth.types';
import { asOpaque } from '@/test-utils/type-assertions';
import { navigatesWithinGesture } from '@/test-utils/user-gesture';
import { useMarketplaceSessionConnect } from './useMarketplaceSessionConnect';

const runtime = vi.hoisted(() => ({ grants: true, passport: true }));
const navigation = vi.hoisted(() => ({ navigateTop: vi.fn() }));
vi.mock('@/libs/navigation/navigate-top', () => ({ navigateTop: navigation.navigateTop }));
vi.mock('@/libs/runtime-config/runtime-config', async (original) => ({
  ...(await original<typeof import('@/libs/runtime-config/runtime-config')>()),
  getMarketplaceGrantFlowEnabled: () => runtime.grants,
  getPassportSignInEnabled: () => runtime.passport,
}));
vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: { writeMarketplaceSessionStore: vi.fn() },
}));
vi.mock('@/services/marketplace/marketplace-bootstrap-client', () => ({ beginMarketplaceBootstrapFlow: vi.fn() }));
vi.mock('@/services/marketplace/marketplace-grant-client', () => ({ beginMarketplaceGrantFlow: vi.fn() }));
vi.mock('@/libs/logger/logger', () => ({ Logger: { error: vi.fn(), warn: vi.fn() } }));

const PUBKY = 'y'.repeat(52);
const OTHER_PUBKY = 'z'.repeat(52);
const CAPS = '/pub/pubky.app/marketplace-service/v1/:rw,/priv/pubky.app/:rw';
const URL = `pubkyauth://signin_grant?caps=${encodeURIComponent(CAPS)}`;
const SESSION = {
  pubky: PUBKY,
  capabilities: CAPS,
  expiresAt: '2099-01-01T00:00:00.000Z',
  issuedAt: '2026-10-13T00:00:00.000Z',
};

type Result = Awaited<ReturnType<MarketplaceGrantFlow['awaitResult']>>;
function pendingFlow() {
  let resolve!: (result: Result) => void;
  let reject!: (error: unknown) => void;
  const result = new Promise<Result>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const flow: MarketplaceGrantFlow = {
    authorizationUrl: URL,
    awaitResult: vi.fn(() => result),
    cancel: vi.fn(async () => undefined),
  };
  return { flow, resolve, reject };
}
function signIn(signer: GrantSigner | null = 'ring', pubky = PUBKY) {
  useAuthStore.setState({
    currentUserPubky: pubky,
    grantSigner: signer,
    session: asOpaque({ grant: {}, info: { publicKey: { z32: () => pubky } } }),
  });
}
function popup() {
  const value = {
    closed: false,
    location: { replace: vi.fn() },
    focus: vi.fn(),
    postMessage: vi.fn(),
    close: vi.fn(() => {
      value.closed = true;
    }),
  };
  const open = vi.spyOn(window, 'open').mockReturnValue(asOpaque<Window>(value));
  return { value, open };
}

beforeEach(() => {
  vi.clearAllMocks();
  runtime.grants = true;
  runtime.passport = true;
  signIn();
  vi.spyOn(MarketplaceSessionService, 'getActiveSession').mockReturnValue(null);
  vi.spyOn(MarketplaceSessionService, 'establishClaimedGrantSession').mockReturnValue(asOpaque(SESSION));
});
afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ session: null, currentUserPubky: null, grantSigner: null });
});

describe('grant-only marketplace approval', () => {
  it.each([
    ['ring', 'Pubky Ring'],
    ['bitkit', 'Bitkit'],
  ] as const)('bootstraps %s with the recorded signer', async (signer, label) => {
    signIn(signer);
    const { flow } = pendingFlow();
    vi.mocked(beginMarketplaceBootstrapFlow).mockResolvedValue(flow);
    const { result } = renderHook(() => useMarketplaceSessionConnect());
    act(() => result.current.start());
    await waitFor(() => expect(result.current.status).toBe('awaiting'));
    expect(result.current.approvalSigner).toBe(label);
    expect(result.current.authorizationUrl).toBe(URL);
    expect(beginMarketplaceBootstrapFlow).toHaveBeenCalledWith({ pubky: PUBKY });
    expect(result.current.requestsFullGrant).toBe(false);
  });

  it.each(['local-key', 'host', null] as const)('requires an explicit signer for %s sessions', (signer) => {
    signIn(signer);
    const { result } = renderHook(() => useMarketplaceSessionConnect());
    act(() => result.current.start());
    expect(result.current.requiresSignerChoice).toBe(true);
    expect(result.current.approvalSigner).toBe('your signer');
    expect(beginMarketplaceBootstrapFlow).not.toHaveBeenCalled();
  });

  it('uses the explicit signer on a hosted grant', async () => {
    signIn('host');
    vi.mocked(beginMarketplaceBootstrapFlow).mockResolvedValue(pendingFlow().flow);
    const { result } = renderHook(() => useMarketplaceSessionConnect({ signer: 'ring' }));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.status).toBe('awaiting'));
    expect(result.current.approvalSigner).toBe('Pubky Ring');
  });

  it('fails closed when grant bootstrap is disabled', () => {
    runtime.grants = false;
    const { result } = renderHook(() => useMarketplaceSessionConnect());
    act(() => result.current.start());
    expect(result.current.status).toBe('error');
    expect(result.current.errorMessage).toContain('unavailable on this deployment');
    expect(beginMarketplaceBootstrapFlow).not.toHaveBeenCalled();
    expect(beginMarketplaceGrantFlow).not.toHaveBeenCalled();
  });

  it('refuses legacy cookie-only sessions', () => {
    useAuthStore.setState({ session: asOpaque({ info: { publicKey: { z32: () => PUBKY } } }) });
    const { result } = renderHook(() => useMarketplaceSessionConnect({ signer: 'ring' }));
    act(() => result.current.start());
    expect(result.current.errorMessage).toContain('Sign in again');
    expect(beginMarketplaceBootstrapFlow).not.toHaveBeenCalled();
  });

  it('connects a verified result only for the initiating identity', async () => {
    const { flow, resolve } = pendingFlow();
    vi.mocked(beginMarketplaceBootstrapFlow).mockResolvedValue(flow);
    const connected = vi.fn();
    const { result } = renderHook(() => useMarketplaceSessionConnect({ onConnected: connected }));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.status).toBe('awaiting'));
    resolve({
      status: 'connected',
      token: 'service-bearer',
      pubky: PUBKY,
      capabilities: CAPS,
      expires_at: SESSION.expiresAt,
    });
    await waitFor(() => expect(result.current.status).toBe('connected'));
    expect(CommerceController.writeMarketplaceSessionStore).toHaveBeenCalledWith(SESSION);
    expect(connected).toHaveBeenCalledWith(SESSION);
  });

  it('rejects another signer identity', async () => {
    const { flow, resolve } = pendingFlow();
    vi.mocked(beginMarketplaceBootstrapFlow).mockResolvedValue(flow);
    const { result } = renderHook(() => useMarketplaceSessionConnect());
    act(() => result.current.start());
    await waitFor(() => expect(result.current.status).toBe('awaiting'));
    resolve({
      status: 'connected',
      token: 'service-bearer',
      pubky: OTHER_PUBKY,
      capabilities: CAPS,
      expires_at: SESSION.expiresAt,
    });
    await waitFor(() => expect(result.current.status).toBe('mismatch'));
    expect(MarketplaceSessionService.establishClaimedGrantSession).not.toHaveBeenCalled();
  });

  it('drops a late approval when the account switches', async () => {
    const { flow, resolve } = pendingFlow();
    vi.mocked(beginMarketplaceBootstrapFlow).mockResolvedValue(flow);
    const { result } = renderHook(() => useMarketplaceSessionConnect());
    act(() => result.current.start());
    await waitFor(() => expect(result.current.status).toBe('awaiting'));
    act(() => signIn('ring', OTHER_PUBKY));
    resolve({
      status: 'connected',
      token: 'service-bearer',
      pubky: PUBKY,
      capabilities: CAPS,
      expires_at: SESSION.expiresAt,
    });
    await act(async () => undefined);
    expect(flow.cancel).toHaveBeenCalled();
    expect(CommerceController.writeMarketplaceSessionStore).not.toHaveBeenCalled();
  });

  it('cancels a flow that finishes creating after the dialog closes', async () => {
    const { flow } = pendingFlow();
    let created!: (flow: MarketplaceGrantFlow) => void;
    vi.mocked(beginMarketplaceBootstrapFlow).mockReturnValue(
      new Promise((resolve) => {
        created = resolve;
      }),
    );
    const { result } = renderHook(() => useMarketplaceSessionConnect());
    act(() => result.current.start());
    act(() => result.current.cancel());
    await act(async () => created(flow));
    expect(flow.cancel).toHaveBeenCalled();
    expect(result.current.authorizationUrl).toBe('');
  });

  it('opens the prepared grant in the top window within the phone tap gesture', async () => {
    vi.mocked(beginMarketplaceBootstrapFlow).mockResolvedValue(pendingFlow().flow);
    const { result } = renderHook(() => useMarketplaceSessionConnect());
    act(() => result.current.start());
    await waitFor(() => expect(result.current.status).toBe('awaiting'));

    expect(navigatesWithinGesture(navigation.navigateTop, URL, () => result.current.openInRing())).toBe(true);
  });

  describe('Bitkit on iOS', () => {
    const BITKIT_IOS_URL = `bitkit://pubky-auth/signin?caps=${encodeURIComponent(CAPS)}`;
    const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15';
    const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
    const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140.0 Mobile';

    async function awaitingWith(
      userAgent: string,
      maxTouchPoints: number,
      options: { signer?: MarketplaceSignerChoice } = {},
    ) {
      vi.stubGlobal('navigator', { userAgent, maxTouchPoints });
      vi.mocked(beginMarketplaceBootstrapFlow).mockResolvedValue(pendingFlow().flow);
      const { result } = renderHook(() => useMarketplaceSessionConnect(options));
      act(() => result.current.start());
      await waitFor(() => expect(result.current.status).toBe('awaiting'));
      return result;
    }

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it.each([
      ['iPhone', IPHONE, 5],
      ['iPadOS reporting Macintosh with touch', MAC, 5],
    ])('opens the bitkit:// link on %s and keeps the QR and copy on pubkyauth://', async (_, userAgent, touch) => {
      signIn('bitkit');
      const result = await awaitingWith(userAgent, touch);

      expect(navigatesWithinGesture(navigation.navigateTop, BITKIT_IOS_URL, () => result.current.openInRing())).toBe(
        true,
      );
      expect(result.current.authorizationUrl).toBe(URL);
    });

    it('follows the Bitkit choice from the signer toggle', async () => {
      signIn('ring');
      const result = await awaitingWith(IPHONE, 5, { signer: 'bitkit' });

      act(() => result.current.openInRing());
      expect(navigation.navigateTop).toHaveBeenCalledWith(BITKIT_IOS_URL);
    });

    it.each([
      ['Android', ANDROID, 5],
      ['desktop Mac', MAC, 0],
    ])('keeps the pubkyauth:// link on %s', async (_, userAgent, touch) => {
      signIn('bitkit');
      const result = await awaitingWith(userAgent, touch);

      act(() => result.current.openInRing());
      expect(navigation.navigateTop).toHaveBeenCalledWith(URL);
    });

    it('keeps the Pubky Ring link on iPhone', async () => {
      signIn('ring');
      const result = await awaitingWith(IPHONE, 5);

      act(() => result.current.openInRing());
      expect(navigation.navigateTop).toHaveBeenCalledWith(URL);
    });
  });

  it('does not commit an approval that arrives after the dialog unmounts', async () => {
    const { flow, resolve } = pendingFlow();
    vi.mocked(beginMarketplaceBootstrapFlow).mockResolvedValue(flow);
    const connected = vi.fn();
    const { result, unmount } = renderHook(() => useMarketplaceSessionConnect({ onConnected: connected }));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.status).toBe('awaiting'));
    unmount();
    await act(async () => {
      resolve({
        status: 'connected',
        token: 'late-token',
        pubky: PUBKY,
        capabilities: CAPS,
        expires_at: SESSION.expiresAt,
      });
    });

    expect(flow.cancel).toHaveBeenCalledOnce();
    expect(MarketplaceSessionService.establishClaimedGrantSession).not.toHaveBeenCalled();
    expect(CommerceController.writeMarketplaceSessionStore).not.toHaveBeenCalled();
    expect(connected).not.toHaveBeenCalled();
  });

  it('retries an expired approval with a fresh flow and cannot accept the old result', async () => {
    const first = pendingFlow();
    const second = pendingFlow();
    vi.mocked(beginMarketplaceBootstrapFlow).mockResolvedValueOnce(first.flow).mockResolvedValueOnce(second.flow);
    const { result } = renderHook(() => useMarketplaceSessionConnect());
    act(() => result.current.start());
    await waitFor(() => expect(result.current.status).toBe('awaiting'));
    first.resolve({ status: 'expired' });
    await waitFor(() => expect(result.current.status).toBe('expired'));
    expect(result.current.authorizationUrl).toBe('');

    act(() => result.current.start());
    await waitFor(() => expect(second.flow.awaitResult).toHaveBeenCalledOnce());
    expect(beginMarketplaceBootstrapFlow).toHaveBeenCalledTimes(2);
    expect(MarketplaceSessionService.establishClaimedGrantSession).not.toHaveBeenCalled();
  });

  it('reconnects through a grant and bootstraps if the BFF pairing expired', async () => {
    vi.mocked(MarketplaceSessionService.getActiveSession).mockReturnValue(asOpaque(SESSION));
    vi.mocked(beginMarketplaceGrantFlow).mockRejectedValue(new Error('shop_session_missing'));
    vi.mocked(beginMarketplaceBootstrapFlow).mockResolvedValue(pendingFlow().flow);
    const { result } = renderHook(() => useMarketplaceSessionConnect());
    act(() => result.current.start());
    await waitFor(() => expect(result.current.status).toBe('awaiting'));
    expect(beginMarketplaceGrantFlow).toHaveBeenCalledOnce();
    expect(beginMarketplaceBootstrapFlow).toHaveBeenCalledWith({ pubky: PUBKY });
  });

  it('reports an expired homeserver session instead of starting an AuthToken flow', async () => {
    vi.mocked(beginMarketplaceBootstrapFlow).mockRejectedValue(new Error('shop_session_expired'));
    const { result } = renderHook(() => useMarketplaceSessionConnect());
    act(() => result.current.start());
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.errorMessage).toBe('Your Shop session ended. Sign in again.');
  });

  it.each(['passport', 'host'] as const)(
    'opens Passport synchronously for a %s session only after a click',
    async (signer) => {
      signIn(signer);
      const { flow, resolve } = pendingFlow();
      vi.mocked(beginMarketplaceBootstrapFlow).mockResolvedValue(flow);
      const { open, value } = popup();
      const choice: MarketplaceSignerChoice = 'passport';
      const { result } = renderHook(() => useMarketplaceSessionConnect({ signer: choice }));
      act(() => result.current.start());
      expect(open).not.toHaveBeenCalled();
      expect(beginMarketplaceBootstrapFlow).not.toHaveBeenCalled();
      act(() => result.current.startPassport());
      expect(open).toHaveBeenCalledOnce();
      await waitFor(() => expect(value.location.replace).toHaveBeenCalled());
      resolve({ status: 'cancelled' });
      await waitFor(() => expect(result.current.status).toBe('cancelled'));
    },
  );

  it('a blocked popup never creates a service flow', async () => {
    signIn('passport');
    vi.spyOn(window, 'open').mockReturnValue(null);
    const { result } = renderHook(() => useMarketplaceSessionConnect());
    act(() => result.current.start());
    act(() => result.current.startPassport());
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.errorMessage).toContain('blocked');
    expect(beginMarketplaceBootstrapFlow).not.toHaveBeenCalled();
  });

  it('keeps recorded signer names when Passport is disabled', () => {
    runtime.passport = false;
    expect(marketplaceApprovalSigner('passport')).toBe('Pubky Passport');
    expect(marketplaceApprovalSigner('ring')).toBe('Pubky Ring');
  });
});

it('offers another signer when Passport is disabled for a Passport-created session', () => {
  signIn('passport');
  runtime.passport = false;
  const { result } = renderHook(() => useMarketplaceSessionConnect());
  act(() => result.current.start());
  expect(result.current.requiresSignerChoice).toBe(true);
  expect(result.current.requestsPassport).toBe(false);
  expect(beginMarketplaceBootstrapFlow).not.toHaveBeenCalled();
});

it('changes the start callback when restored authority arrives so an open dialog restarts', async () => {
  useAuthStore.setState({ session: null });
  vi.mocked(beginMarketplaceBootstrapFlow).mockResolvedValue(pendingFlow().flow);
  const { result } = renderHook(() => useMarketplaceSessionConnect());
  const beforeRestore = result.current.start;
  act(() => result.current.start());
  expect(result.current.requiresSignIn).toBe(true);
  act(() => signIn());
  expect(result.current.start).not.toBe(beforeRestore);
  expect(result.current.requiresSignIn).toBe(false);
  act(() => result.current.start());
  await waitFor(() => expect(result.current.status).toBe('awaiting'));
});

it('restarts an already open approval when restore supplies the session', async () => {
  useAuthStore.setState({ session: null });
  vi.mocked(beginMarketplaceBootstrapFlow).mockResolvedValue(pendingFlow().flow);
  const { result } = renderHook(() => {
    const session = useMarketplaceSessionConnect();
    const { start, requiresSignIn } = session;
    useEffect(() => {
      if (!requiresSignIn) start();
    }, [start, requiresSignIn]);
    return session;
  });
  expect(beginMarketplaceBootstrapFlow).not.toHaveBeenCalled();
  act(() => signIn());
  await waitFor(() => expect(result.current.status).toBe('awaiting'));
  expect(result.current.authorizationUrl).toBe(URL);
});
