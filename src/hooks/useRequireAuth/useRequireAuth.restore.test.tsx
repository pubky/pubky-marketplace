import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogSignIn } from '@/organisms/DialogSignIn/DialogSignIn';
import { createAuthStore, useAuthStore } from '@/stores/auth/auth.store';
import { authInitialState, type AuthState } from '@/stores/auth/auth.types';
import { AUTH_PERSIST_KEY } from '@/stores/persistedKeys';
import { asOpaque } from '@/test-utils/type-assertions';
import { REQUIRE_AUTH_RESTORE_TIMEOUT_MS, useRequireAuth } from './useRequireAuth';

const host = vi.hoisted(() => ({ request: vi.fn(() => false) }));
vi.mock('@/libs/shop-session/bridge', () => ({ requestShopHostAction: host.request }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('@/atoms/BasePathImage/BasePathImage', () => ({ BasePathImage: () => null }));
vi.mock('@/providers/ShopHostSessionProvider/ShopHostSessionProvider', () => ({ useIsShopHosted: () => false }));

const PUBKY = 'restoring-user-pubky';
const liveSession = asOpaque<AuthState['session']>({ grant: { id: 'grant' } });

/** The store right after a full page load with a saved grant: identity known, live session not yet restored. */
const restoringState: Partial<AuthState> = {
  currentUserPubky: PUBKY,
  grantSessionRecordId: 'record-1',
  session: null,
  hasProfile: true,
  hasHydrated: true,
  isRestoringSession: true,
  sessionRestoreDeferred: false,
  isLoggingOut: false,
  showSignInDialog: false,
};

const finishRestoreSignedIn = () =>
  useAuthStore.setState({ session: liveSession, isRestoringSession: false, hasProfile: true });

beforeEach(() => {
  useAuthStore.setState({ ...authInitialState, ...restoringState });
  host.request.mockReset();
  host.request.mockReturnValue(false);
});

afterEach(() => {
  vi.useRealTimers();
  useAuthStore.setState({ ...authInitialState });
});

describe('requireAuth while a saved grant is restoring', () => {
  it('queues the click and runs it once the restore finishes, without ever prompting to sign in', () => {
    const action = vi.fn(() => 'done');
    const { result } = renderHook(() => useRequireAuth());

    let returned: string | undefined;
    act(() => {
      returned = result.current.requireAuth(action);
    });

    expect(returned).toBeUndefined();
    expect(action).not.toHaveBeenCalled();
    expect(useAuthStore.getState().showSignInDialog).toBe(false);
    expect(host.request).not.toHaveBeenCalled();

    act(() => finishRestoreSignedIn());

    expect(action).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().showSignInDialog).toBe(false);
    expect(host.request).not.toHaveBeenCalled();
  });

  it('runs a queued click once even when later store updates keep arriving', () => {
    const action = vi.fn();
    const { result } = renderHook(() => useRequireAuth());
    act(() => result.current.requireAuth(action));

    act(() => finishRestoreSignedIn());
    act(() => useAuthStore.setState({ hasProfile: true }));
    act(() => useAuthStore.setState({ isRestoringSession: false }));

    expect(action).toHaveBeenCalledTimes(1);
  });

  it('keeps waiting through the restored-session-without-profile step', () => {
    const action = vi.fn();
    const { result } = renderHook(() => useRequireAuth());
    act(() => result.current.requireAuth(action));

    act(() => useAuthStore.setState({ session: liveSession, hasProfile: null }));
    expect(action).not.toHaveBeenCalled();
    expect(useAuthStore.getState().showSignInDialog).toBe(false);

    act(() => useAuthStore.setState({ hasProfile: true, isRestoringSession: false }));
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('prompts to sign in only when the restore settles without a session', () => {
    const action = vi.fn();
    const { result } = renderHook(() => useRequireAuth());
    act(() => result.current.requireAuth(action));
    expect(useAuthStore.getState().showSignInDialog).toBe(false);

    act(() => useAuthStore.setState({ isRestoringSession: false, grantSessionRecordId: null, currentUserPubky: null }));

    expect(action).not.toHaveBeenCalled();
    expect(useAuthStore.getState().showSignInDialog).toBe(true);
  });

  it('prompts when the restore is deferred', () => {
    const action = vi.fn();
    const { result } = renderHook(() => useRequireAuth());
    act(() => result.current.requireAuth(action));

    act(() => useAuthStore.setState({ isRestoringSession: false, sessionRestoreDeferred: true }));

    expect(action).not.toHaveBeenCalled();
    expect(useAuthStore.getState().showSignInDialog).toBe(true);
  });

  it('asks the host App to sign in instead of opening the Shop dialog when hosted', () => {
    host.request.mockReturnValue(true);
    const { result } = renderHook(() => useRequireAuth());
    act(() => result.current.requireAuth(vi.fn()));
    act(() => useAuthStore.setState({ isRestoringSession: false, grantSessionRecordId: null }));

    expect(host.request).toHaveBeenCalledWith('request-login');
    expect(useAuthStore.getState().showSignInDialog).toBe(false);
  });

  it('drops the click when the user signs out during the restore', () => {
    const action = vi.fn();
    const { result } = renderHook(() => useRequireAuth());
    act(() => result.current.requireAuth(action));

    act(() => useAuthStore.setState({ isLoggingOut: true, isRestoringSession: false }));
    act(() => useAuthStore.setState({ isLoggingOut: false, session: liveSession }));

    expect(action).not.toHaveBeenCalled();
    expect(useAuthStore.getState().showSignInDialog).toBe(false);
  });

  it('drops the click when the component unmounts before the restore finishes', () => {
    const action = vi.fn();
    const { result, unmount } = renderHook(() => useRequireAuth());
    act(() => result.current.requireAuth(action));

    unmount();
    act(() => finishRestoreSignedIn());

    expect(action).not.toHaveBeenCalled();
  });

  it('falls back to the sign-in prompt if a restore never reports back', () => {
    vi.useFakeTimers();
    const action = vi.fn();
    const { result } = renderHook(() => useRequireAuth());
    act(() => result.current.requireAuth(action));

    act(() => vi.advanceTimersByTime(REQUIRE_AUTH_RESTORE_TIMEOUT_MS - 1));
    expect(useAuthStore.getState().showSignInDialog).toBe(false);

    act(() => vi.advanceTimersByTime(1));
    expect(useAuthStore.getState().showSignInDialog).toBe(true);
    expect(action).not.toHaveBeenCalled();
  });

  it('does not treat a restore that is not pending as a reason to wait', () => {
    useAuthStore.setState({
      currentUserPubky: null,
      grantSessionRecordId: null,
      isRestoringSession: false,
    });
    const action = vi.fn();
    const { result } = renderHook(() => useRequireAuth());
    act(() => result.current.requireAuth(action));

    expect(action).not.toHaveBeenCalled();
    expect(useAuthStore.getState().showSignInDialog).toBe(true);
  });

  it('queues the click when the store starts from the persisted state of a full page load', () => {
    localStorage.setItem(
      AUTH_PERSIST_KEY,
      JSON.stringify({
        state: { currentUserPubky: PUBKY, grantSessionRecordId: 'record-1', grantSigner: 'bitkit', hasProfile: true },
        version: 0,
      }),
    );
    const loaded = createAuthStore();
    localStorage.removeItem(AUTH_PERSIST_KEY);

    expect(loaded.getState().hasHydrated).toBe(true);
    expect(loaded.getState().isRestoringSession).toBe(true);
    expect(loaded.getState().session).toBeNull();
  });
});

describe('Buy click right after a full page load', () => {
  it('never shows the Join Pubky dialog to a signed-in user while the saved grant restores', async () => {
    const user = userEvent.setup();
    const purchase = vi.fn();
    const Buy = () => {
      const { requireAuth } = useRequireAuth();
      return (
        <>
          <button type="button" onClick={() => requireAuth(purchase)}>
            Buy
          </button>
          <DialogSignIn />
        </>
      );
    };
    render(<Buy />);

    await user.click(screen.getByRole('button', { name: 'Buy' }));
    expect(screen.queryByText('Join Pubky')).not.toBeInTheDocument();
    expect(purchase).not.toHaveBeenCalled();

    act(() => finishRestoreSignedIn());

    expect(purchase).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Join Pubky')).not.toBeInTheDocument();
  });

  it('still shows the Join Pubky dialog to a signed-out visitor', async () => {
    useAuthStore.setState({
      ...authInitialState,
      hasHydrated: true,
    });
    const user = userEvent.setup();
    const Buy = () => {
      const { requireAuth } = useRequireAuth();
      return (
        <>
          <button type="button" onClick={() => requireAuth(vi.fn())}>
            Buy
          </button>
          <DialogSignIn />
        </>
      );
    };
    render(<Buy />);

    await user.click(screen.getByRole('button', { name: 'Buy' }));

    expect(await screen.findByText('Already have a pubky?')).toBeInTheDocument();
  });
});
