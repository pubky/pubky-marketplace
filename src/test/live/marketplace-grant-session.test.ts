import { AuthFlowKind, GrantAuthFlow, Pubky, type Session } from '@synonymdev/pubky';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as network from '@/config/network';
import { MarketplaceGrantSessionService } from '@/services/marketplace/marketplace-grant-session';
import { INVENTORY_GRANT, INVENTORY_SESSION_STORAGE_KEY } from '@/services/marketplace/marketplace-inventory-grant';
import { MarketplaceInventorySessionService } from '@/services/marketplace/marketplace-inventory-session';
import { MarketplaceSessionService } from '@/services/marketplace/marketplace-session';
import { MARKETPLACE_SESSION_GRANT } from '@/services/marketplace/marketplace-session-grant';
import { useAuthStore } from '@/stores/auth/auth.store';
import { mockGrantSession, mockKeypair, mockSession } from '@/test-utils/pubky';
import { asOpaque } from '@/test-utils/type-assertions';
import { mintMarketplaceGrantSession } from '../../../scripts/lib/marketplace-grant-session.mjs';
import {
  createPublicOnlyGrantSession,
  establishMarketplaceGrantSession,
  mintInventoryOnlyGrantSession,
  restoreInventoryGrantSession,
  revokeOwnedHomeserverGrant,
} from './marketplace-grant-session';

vi.mock('@/config/commerce', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config/commerce')>()),
  getCommerceAdapterMode: () => 'transaction-service',
  getMarketplaceUrl: () => 'https://marketplace.example.test',
}));
vi.mock('../../../scripts/lib/marketplace-grant-session.mjs', () => ({ mintMarketplaceGrantSession: vi.fn() }));

const PUBKY = 'y'.repeat(52);
const OTHER = 'o'.repeat(52);
const minted = (capabilities: string = MARKETPLACE_SESSION_GRANT, token = 'A'.repeat(43)) => ({
  token,
  sessionId: '11111111-1111-4111-8111-111111111111',
  pubky: PUBKY,
  capabilities,
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
});

beforeEach(() => {
  MarketplaceSessionService.clearSession();
  MarketplaceInventorySessionService.clearSession();
  useAuthStore.setState({ session: null, currentUserPubky: null });
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  MarketplaceSessionService.clearSession();
  MarketplaceInventorySessionService.clearSession();
});

/** Unlike a plain spy, this double rejects SDK use-after-free and free-during-poll. */
function strictGrantFlow(poll: () => Promise<Session | undefined>) {
  let busy = false;
  let freed = false;
  const violations: string[] = [];
  return {
    authorizationUrl: `pubkyauth:///?caps=${encodeURIComponent('/pub/pubky.app/:rw')}`,
    tryPollOnce: vi.fn(async () => {
      if (freed || busy) {
        violations.push('poll used an unavailable SDK flow');
        throw new Error(violations.at(-1));
      }
      busy = true;
      try {
        return await poll();
      } finally {
        busy = false;
      }
    }),
    awaitApproval: vi.fn(() => {
      violations.push('consuming SDK awaitApproval was called');
      throw new Error(violations.at(-1));
    }),
    free: vi.fn(() => {
      if (busy || freed) {
        violations.push('SDK flow freed while borrowed or already freed');
        throw new Error(violations.at(-1));
      }
      freed = true;
    }),
    violations,
  };
}

function installGrantFlow(
  flow: Pick<GrantAuthFlow, 'authorizationUrl' | 'tryPollOnce' | 'free'>,
  signerApproval = Promise.resolve(),
) {
  const startGrantAuthFlow = vi.fn().mockResolvedValue(flow);
  vi.spyOn(network, 'getTestnet').mockReturnValue(true);
  vi.spyOn(Pubky, 'testnet').mockReturnValue(
    asOpaque({
      startGrantAuthFlow,
      signer: () => ({ approveAuthRequest: vi.fn(() => signerApproval) }),
    }),
  );
  const keypair = mockKeypair({ publicKey: asOpaque({ z32: () => PUBKY }) });
  return { keypair, startGrantAuthFlow };
}

describe('live marketplace grant fixtures (offline)', () => {
  it('defers SDK flow disposal until a canceled poll settles and revokes its late grant', async () => {
    vi.useFakeTimers();
    const poll = Promise.withResolvers<Session | undefined>();
    const flow = strictGrantFlow(() => poll.promise);
    const { keypair } = installGrantFlow(flow);
    const pending = createPublicOnlyGrantSession(keypair);
    const timedOut = expect(pending).rejects.toThrow('approval timed out');
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(0);
    expect(flow.tryPollOnce).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(60_000);
    await timedOut;
    expect(flow.free).not.toHaveBeenCalled();

    const signout = vi.fn().mockResolvedValue(undefined);
    const dispose = vi.fn();
    poll.resolve(mockSession({ signout, free: dispose }));
    await vi.runAllTimersAsync();
    expect(signout).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    expect(flow.free).toHaveBeenCalledOnce();
    expect(flow.violations).toEqual([]);
  });

  it('never uses a disposed flow when the signer finishes after the approval deadline', async () => {
    vi.useFakeTimers();
    const signer = Promise.withResolvers<void>();
    const flow = strictGrantFlow(async () => undefined);
    const { keypair } = installGrantFlow(flow, signer.promise);
    const pending = createPublicOnlyGrantSession(keypair);
    const timedOut = expect(pending).rejects.toThrow('approval timed out');
    await vi.dynamicImportSettled();

    await vi.advanceTimersByTimeAsync(60_000);
    await timedOut;
    expect(flow.free).toHaveBeenCalledOnce();
    const callsAtTimeout = flow.tryPollOnce.mock.calls.length;
    signer.resolve();
    await vi.runAllTimersAsync();

    expect(flow.tryPollOnce).toHaveBeenCalledTimes(callsAtTimeout);
    expect(flow.awaitApproval).not.toHaveBeenCalled();
    expect(flow.violations).toEqual([]);
  });

  it('revokes a grant already obtained when the signer has not finished by the deadline', async () => {
    vi.useFakeTimers();
    const signer = Promise.withResolvers<void>();
    const signout = vi.fn().mockResolvedValue(undefined);
    const dispose = vi.fn();
    const flow = strictGrantFlow(async () => mockSession({ signout, free: dispose }));
    const { keypair } = installGrantFlow(flow, signer.promise);
    const pending = createPublicOnlyGrantSession(keypair);
    const timedOut = expect(pending).rejects.toThrow('approval timed out');
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(0);
    expect(flow.free).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(60_000);
    await timedOut;
    signer.resolve();
    await vi.runAllTimersAsync();

    expect(signout).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    expect(flow.violations).toEqual([]);
  });

  it('cancels safely when the signer fails during a pending SDK poll', async () => {
    vi.useFakeTimers();
    const signer = Promise.withResolvers<void>();
    const poll = Promise.withResolvers<Session | undefined>();
    const flow = strictGrantFlow(() => poll.promise);
    const { keypair } = installGrantFlow(flow, signer.promise);
    const pending = createPublicOnlyGrantSession(keypair);
    const failed = expect(pending).rejects.toThrow('signer rejected');
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(0);
    signer.reject(new Error('signer rejected'));
    await failed;
    expect(flow.free).not.toHaveBeenCalled();

    poll.resolve(undefined);
    await vi.runAllTimersAsync();
    expect(flow.free).toHaveBeenCalledOnce();
    expect(flow.violations).toEqual([]);
  });

  it('returns the approved grant while disposing only its completed flow', async () => {
    vi.useFakeTimers();
    const session = mockGrantSession(PUBKY);
    const flow = strictGrantFlow(async () => session);
    const { keypair, startGrantAuthFlow } = installGrantFlow(flow);
    const pending = createPublicOnlyGrantSession(keypair);
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(0);

    await expect(pending).resolves.toBe(session);
    expect(startGrantAuthFlow).toHaveBeenCalledWith(
      '/pub/pubky.app/:rw',
      expect.anything(),
      expect.objectContaining({
        approvalFormat: 'bareGrant',
      }),
    );
    expect(flow.free).toHaveBeenCalledOnce();
    expect(flow.awaitApproval).not.toHaveBeenCalled();
    expect(flow.violations).toEqual([]);
  });

  it('uses real SDK polling safely when a signer completes after cancellation (offline)', async () => {
    vi.useFakeTimers();
    let openRelayRequests = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        openRelayRequests += 1;
        const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
        return new Promise<Response>((_resolve, reject) => {
          const abort = () => {
            openRelayRequests -= 1;
            reject(new DOMException('Offline fixture relay canceled', 'AbortError'));
          };
          if (signal?.aborted) abort();
          else signal?.addEventListener('abort', abort, { once: true });
        });
      }),
    );
    const flow = GrantAuthFlow.start('/pub/pubky.app/:rw', AuthFlowKind.signin(), {
      clientId: 'offline-fixture.test',
      approvalFormat: 'bareGrant',
      relay: 'https://relay.example.test/inbox/',
    });
    const tryPollOnce = vi.spyOn(flow, 'tryPollOnce');
    const free = vi.spyOn(flow, 'free');
    const signer = Promise.withResolvers<void>();
    const { keypair } = installGrantFlow(flow, signer.promise);
    const pending = createPublicOnlyGrantSession(keypair);
    const timedOut = expect(pending).rejects.toThrow('approval timed out');
    await vi.dynamicImportSettled();

    await vi.advanceTimersByTimeAsync(60_000);
    await timedOut;
    expect(tryPollOnce).toHaveBeenCalled();
    expect(free).toHaveBeenCalledOnce();
    expect(free.mock.results[0].type).toBe('return');
    const callsAtTimeout = tryPollOnce.mock.calls.length;
    signer.resolve();
    await vi.runAllTimersAsync();

    expect(tryPollOnce).toHaveBeenCalledTimes(callsAtTimeout);
    expect(openRelayRequests).toBe(0);
  });

  it('disposes only the explicitly owned grant even when its revocation fails', async () => {
    const borrowed = mockGrantSession(PUBKY);
    useAuthStore.setState({ session: borrowed, currentUserPubky: PUBKY });
    const free = vi.fn();
    const owned = mockSession({ signout: vi.fn().mockRejectedValue(new Error('unavailable')), free });

    await expect(revokeOwnedHomeserverGrant(owned)).rejects.toThrow('unavailable');

    expect(free).toHaveBeenCalledOnce();
    expect(useAuthStore.getState().selectSession()).toBe(borrowed);
  });

  it('refuses a cookie-only or wrong-account homeserver session before minting or changing the active account', async () => {
    const original = mockGrantSession(OTHER);
    useAuthStore.setState({ session: original, currentUserPubky: OTHER });
    const mint = vi.spyOn(MarketplaceGrantSessionService, 'mint');

    await expect(establishMarketplaceGrantSession({ session: mockSession(), pubky: PUBKY })).rejects.toThrow(
      'A live homeserver grant is required',
    );
    await expect(
      establishMarketplaceGrantSession({ session: mockGrantSession(OTHER), pubky: PUBKY }),
    ).rejects.toThrow();
    expect(mint).not.toHaveBeenCalled();
    expect(useAuthStore.getState().selectSession()).toBe(original);
    expect(MarketplaceSessionService.getActiveSession()).toBeNull();
  });

  it('installs a verified purchase bearer that also covers inventory for only its owner', async () => {
    const session = mockGrantSession(PUBKY);
    vi.spyOn(MarketplaceGrantSessionService, 'mint').mockResolvedValue(minted());

    const info = await establishMarketplaceGrantSession({ session, pubky: PUBKY });

    expect(info.capabilities).toBe(MARKETPLACE_SESSION_GRANT);
    expect(info).not.toHaveProperty('token');
    expect(useAuthStore.getState().selectSession()).toBe(session);
    expect(MarketplaceInventorySessionService.getCoveringBearer(PUBKY)).toEqual({
      token: minted().token,
      source: 'purchase',
    });
    expect(MarketplaceInventorySessionService.getCoveringBearer(OTHER)).toBeNull();
  });

  it('mints the narrow fixture without replacing the full homeserver grant', async () => {
    const fullSession = mockGrantSession(PUBKY);
    const narrowSession = mockGrantSession(PUBKY);
    useAuthStore.setState({ session: fullSession, currentUserPubky: PUBKY });
    vi.mocked(mintMarketplaceGrantSession).mockResolvedValue(minted(INVENTORY_GRANT));

    await mintInventoryOnlyGrantSession(narrowSession, PUBKY);

    expect(useAuthStore.getState().selectSession()).toBe(fullSession);
    expect(mintMarketplaceGrantSession).toHaveBeenCalledWith({
      session: narrowSession,
      expectedPubky: PUBKY,
      serviceUrl: 'https://marketplace.example.test',
      acceptedCapabilities: [INVENTORY_GRANT],
    });
  });

  it('restores an independent narrow bearer without replacing purchase authority or touching browser storage', async () => {
    MarketplaceSessionService.establishClaimedGrantSession(minted(), PUBKY);
    window.localStorage.setItem(INVENTORY_SESSION_STORAGE_KEY, 'another-tab-record');
    const browserWindow = window;
    const before = Object.entries(window.localStorage);
    const inventory = minted(INVENTORY_GRANT, 'I'.repeat(43));

    await restoreInventoryGrantSession(inventory);

    expect(window).toBe(browserWindow);
    expect(Object.entries(window.localStorage)).toEqual(before);
    expect(MarketplaceSessionService.getActiveSession()?.token).toBe(minted().token);
    expect(MarketplaceInventorySessionService.getCoveringBearer(PUBKY)).toEqual({
      token: inventory.token,
      source: 'inventory',
    });
    MarketplaceInventorySessionService.clearSession();
    expect(MarketplaceInventorySessionService.getCoveringBearer(PUBKY)?.source).toBe('purchase');
    expect(window.localStorage.getItem(INVENTORY_SESSION_STORAGE_KEY)).toBe('another-tab-record');
  });

  it('rejects a broadened inventory fixture and restores the browser window after failure', async () => {
    const browserWindow = window;
    window.localStorage.setItem('untouched', 'value');

    await expect(restoreInventoryGrantSession(minted())).rejects.toThrow();

    expect(window).toBe(browserWindow);
    expect(window.localStorage.getItem('untouched')).toBe('value');
    expect(MarketplaceInventorySessionService.getActiveSession()).toBeNull();
  });
});
