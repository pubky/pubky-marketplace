import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/libs/error/error';
import { ServerErrorCode } from '@/libs/error/error.codes';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import { groupPubky } from '@/libs/store-claim/format-pubky';
import { STORE_CLAIM_CODE_SESSION_KEY } from '@/libs/store-claim/store-claim-code';
import { navigateToClaimedStudio } from '@/libs/store-claim/store-claim-navigation';
import { StoreClaimFlow } from './StoreClaimFlow';

const PUBKY = 'o'.repeat(52);
const OTHER = 'y'.repeat(52);
const CODE = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const mocks = vi.hoisted(() => ({
  ensure: vi.fn(),
  clear: vi.fn(),
  claim: vi.fn(),
  state: vi.fn(),
  logout: vi.fn(),
  navigate: vi.fn(),
  mark: vi.fn(),
}));
const runtime = vi.hoisted(() => ({ pubky: 'o'.repeat(52) as string | null, session: true, insecure: false }));

vi.mock('@/controllers/auth/auth', () => ({ AuthController: { logout: mocks.logout } }));
vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    ensureMarketplaceSessionFromGrant: mocks.ensure,
    clearMarketplaceSession: mocks.clear,
  },
}));
vi.mock('@/controllers/store-claim/store-claim', () => ({
  StoreClaimController: { claim: mocks.claim, fetchStoreState: mocks.state },
}));
vi.mock('@/config/store-mode', () => ({ isStoreModeInsecureContext: () => runtime.insecure }));
vi.mock('@/hooks/useUserDetails/useUserDetails', () => ({
  useUserDetails: () => ({ userDetails: { name: 'Example Merchant', image: null }, isLoading: false }),
}));
vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: { currentUserPubky: string | null; session: object | null }) => unknown) =>
    selector({ currentUserPubky: runtime.pubky, session: runtime.session && runtime.pubky ? {} : null }),
}));
vi.mock('@/organisms/SignIn/SignIn', () => ({
  SignInContent: ({ showPassport = true }: { showPassport?: boolean }) => (
    <div data-testid="grant-sign-in-qr" data-show-passport={showPassport} />
  ),
}));
vi.mock('@/organisms/AvatarWithFallback/AvatarWithFallback', () => ({
  AvatarWithFallback: () => <div data-testid="claim-avatar" />,
}));
vi.mock('@/libs/store-claim/store-claim-navigation', () => ({
  markStoreClaimNavigation: mocks.mark,
  navigateToClaimedStudio: mocks.navigate,
}));
vi.mock('@/molecules/Toaster/toast', () => ({ toast: vi.fn() }));
vi.mock('@/libs/utils/utils', async () => ({
  ...(await vi.importActual<typeof import('@/libs/utils/utils')>('@/libs/utils/utils')),
  copyToClipboard: vi.fn(),
}));

function mintError(status: number, retryAfter?: number): AppError {
  return new AppError({
    category: ErrorCategory.Server,
    code: ServerErrorCode.SERVICE_UNAVAILABLE,
    message: status === 403 ? 'grant_sessions_disabled' : 'grant_session_unavailable',
    service: ErrorService.Marketplace,
    operation: 'marketplaceGrantSession',
    context: { statusCode: status, retryAfter },
  });
}

async function flushPromises() {
  for (let turn = 0; turn < 6; turn += 1) {
    await act(async () => Promise.resolve());
  }
}

async function renderSignedIn() {
  render(<StoreClaimFlow />);
  await waitFor(() => expect(mocks.ensure).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Claim this shop' })).toBeEnabled());
}

describe('StoreClaimFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    window.sessionStorage.setItem(STORE_CLAIM_CODE_SESSION_KEY, CODE);
    runtime.pubky = PUBKY;
    runtime.session = true;
    runtime.insecure = false;
    mocks.ensure.mockResolvedValue({});
    mocks.claim.mockResolvedValue({ kind: 'success' });
    mocks.state.mockResolvedValue({ kind: 'claimed', seller: PUBKY, source: 'claim' });
    mocks.logout.mockResolvedValue(undefined);
  });

  afterEach(() => vi.useRealTimers());

  it('renders the secure-context screen over an insecure connection', () => {
    runtime.insecure = true;
    render(<StoreClaimFlow />);
    expect(screen.getByTestId('store-secure-context-screen')).toBeInTheDocument();
    expect(screen.queryByLabelText('Setup code')).not.toBeInTheDocument();
  });

  it('shows the paste prompt and sign-in QR without a stored code', () => {
    window.sessionStorage.clear();
    runtime.pubky = null;
    runtime.session = false;
    render(<StoreClaimFlow />);

    expect(screen.getByLabelText('Setup code')).toHaveValue('');
    expect(screen.getByTestId('grant-sign-in-qr')).toHaveAttribute('data-show-passport', 'false');
    expect(screen.getByText('Where to find the code')).toBeInTheDocument();
  });

  it('shows the identity confirmation and disables claiming without a valid code', async () => {
    window.sessionStorage.clear();
    render(<StoreClaimFlow />);
    await screen.findByRole('button', { name: 'Claim this shop' });

    expect(screen.getByTestId('grouped-identity')).toHaveTextContent(groupPubky(PUBKY));
    expect(screen.getByText(/Claim this shop as/)).toHaveTextContent('Example Merchant');
    expect(screen.getByRole('button', { name: 'Claim this shop' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Setup code'), { target: { value: CODE.toLowerCase() } });
    expect(window.sessionStorage.getItem(STORE_CLAIM_CODE_SESSION_KEY)).toBe(CODE);
    expect(screen.getByRole('button', { name: 'Claim this shop' })).toBeEnabled();
  });

  it('keeps the field after an invalid code response', async () => {
    mocks.claim.mockResolvedValue({ kind: 'invalid-code' });
    await renderSignedIn();
    fireEvent.click(screen.getByRole('button', { name: 'Claim this shop' }));

    expect(await screen.findByText('That setup code is not right. Check it and try again.')).toBeInTheDocument();
    expect(screen.getByLabelText('Setup code')).toHaveValue(CODE);
  });

  it('signs out for a stale session and clears the code for a fresh paste', async () => {
    mocks.claim.mockResolvedValue({ kind: 'stale-session' });
    await renderSignedIn();
    fireEvent.click(screen.getByRole('button', { name: 'Claim this shop' }));

    expect(await screen.findByText('For safety, sign in again to confirm.')).toBeInTheDocument();
    expect(mocks.logout).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(STORE_CLAIM_CODE_SESSION_KEY)).toBeNull();
    expect(screen.getByLabelText('Setup code')).toHaveValue('');
  });

  it('clears a rejected bearer, mints once and retries the claim', async () => {
    mocks.claim.mockResolvedValueOnce({ kind: 'session-rejected' }).mockResolvedValueOnce({ kind: 'invalid-code' });
    await renderSignedIn();
    fireEvent.click(screen.getByRole('button', { name: 'Claim this shop' }));

    expect(await screen.findByText('That setup code is not right. Check it and try again.')).toBeInTheDocument();
    expect(mocks.clear).toHaveBeenCalledTimes(1);
    expect(mocks.ensure).toHaveBeenCalledTimes(2);
    expect(mocks.claim).toHaveBeenCalledTimes(2);
    expect(mocks.logout).not.toHaveBeenCalled();
  });

  it('signs out with an expired sign-in prompt after a repeated bearer rejection', async () => {
    mocks.claim.mockResolvedValue({ kind: 'session-rejected' });
    await renderSignedIn();
    fireEvent.click(screen.getByRole('button', { name: 'Claim this shop' }));

    expect(await screen.findByText('Your sign-in expired. Sign in again to claim this shop.')).toBeInTheDocument();
    expect(mocks.claim).toHaveBeenCalledTimes(2);
    expect(mocks.logout).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(STORE_CLAIM_CODE_SESSION_KEY)).toBeNull();
    expect(screen.getByLabelText('Setup code')).toHaveValue('');
  });

  it('signs out with an expired sign-in prompt when the replacement mint fails', async () => {
    mocks.claim.mockResolvedValue({ kind: 'session-rejected' });
    mocks.ensure.mockResolvedValueOnce({}).mockRejectedValueOnce(mintError(503));
    await renderSignedIn();
    fireEvent.click(screen.getByRole('button', { name: 'Claim this shop' }));

    expect(await screen.findByText('Your sign-in expired. Sign in again to claim this shop.')).toBeInTheDocument();
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    expect(mocks.logout).toHaveBeenCalledTimes(1);
  });

  it('shows the capability message and operator hint', async () => {
    mocks.claim.mockResolvedValue({ kind: 'session-capability' });
    await renderSignedIn();
    fireEvent.click(screen.getByRole('button', { name: 'Claim this shop' }));

    expect(
      await screen.findByText('This sign-in cannot claim the shop. Sign in again with Pubky Ring.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/grant sessions must be enabled/)).toBeInTheDocument();
  });

  it('clears the bearer and retries a source refusal exactly once', async () => {
    mocks.claim.mockResolvedValue({ kind: 'session-source' });
    await renderSignedIn();
    fireEvent.click(screen.getByRole('button', { name: 'Claim this shop' }));

    expect(await screen.findByText('This shop is not set up to sign in.')).toBeInTheDocument();
    expect(mocks.clear).toHaveBeenCalledTimes(1);
    expect(mocks.claim).toHaveBeenCalledTimes(2);
    expect(mocks.ensure).toHaveBeenCalledTimes(2);
    expect(mocks.ensure).toHaveBeenLastCalledWith({
      retryAfterFailure: true,
      throwOnFailure: true,
      forceFresh: true,
    });
  });

  it('maps a source retry mint failure without another claim', async () => {
    mocks.claim.mockResolvedValue({ kind: 'session-source' });
    mocks.ensure.mockResolvedValueOnce({}).mockRejectedValueOnce(mintError(503, 2));
    await renderSignedIn();
    fireEvent.click(screen.getByRole('button', { name: 'Claim this shop' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Your homeserver could not be reached');
    expect(mocks.claim).toHaveBeenCalledTimes(1);
  });

  it('shows the other seller on a conflict and clears the code', async () => {
    mocks.claim.mockResolvedValue({ kind: 'already-claimed', seller: null });
    mocks.state.mockResolvedValue({ kind: 'claimed', seller: OTHER, source: 'claim' });
    await renderSignedIn();
    fireEvent.click(screen.getByRole('button', { name: 'Claim this shop' }));

    expect((await screen.findByRole('alert')).textContent).toContain(groupPubky(OTHER));
    expect(mocks.state).toHaveBeenCalledWith(true);
    expect(screen.getByRole('alert').textContent).toContain('./solo claim-release');
    expect(window.sessionStorage.getItem(STORE_CLAIM_CODE_SESSION_KEY)).toBeNull();
  });

  it.each([
    [429, 'The order service is busy'],
    [503, 'Your homeserver could not be reached'],
  ])('honors Retry-After after grant mint status %s', async (status, copy) => {
    vi.useFakeTimers();
    mocks.ensure.mockRejectedValue(mintError(status, 2));
    render(<StoreClaimFlow />);
    await flushPromises();

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(copy);
    expect(alert.textContent).toContain('2 seconds');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDisabled();
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  it('treats a definitive mint refusal as a setup refusal', async () => {
    mocks.ensure.mockRejectedValue(mintError(403));
    render(<StoreClaimFlow />);
    expect((await screen.findByRole('alert')).textContent).toContain('This shop is not set up to sign in');
    expect(screen.getByRole('button', { name: 'Use a different identity' })).toBeInTheDocument();
  });

  it('disables claim retries until a claim Retry-After delay passes', async () => {
    vi.useFakeTimers();
    mocks.claim.mockResolvedValue({ kind: 'retry-later', retryAfterSeconds: 2 });
    render(<StoreClaimFlow />);
    await flushPromises();
    fireEvent.click(screen.getByRole('button', { name: 'Claim this shop' }));
    await flushPromises();

    expect(screen.getByRole('alert').textContent).toContain('2 seconds');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDisabled();
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  it('offers a retry with the same code after a network failure', async () => {
    mocks.claim.mockRejectedValue(new TypeError('Failed to fetch'));
    await renderSignedIn();
    fireEvent.click(screen.getByRole('button', { name: 'Claim this shop' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Try again with the same setup code');
    expect(screen.getByLabelText('Setup code')).toHaveValue(CODE);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  it('clears the code when using a different identity', async () => {
    await renderSignedIn();
    fireEvent.click(screen.getByRole('button', { name: 'Use a different identity' }));
    await waitFor(() => expect(mocks.logout).toHaveBeenCalled());
    expect(window.sessionStorage.getItem(STORE_CLAIM_CODE_SESSION_KEY)).toBeNull();
  });

  it('polls fresh once and then until claimed twice before Studio navigation', async () => {
    vi.useFakeTimers();
    render(<StoreClaimFlow />);
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByRole('button', { name: 'Claim this shop' }));
    await act(async () => Promise.resolve());
    expect(mocks.state).toHaveBeenCalledWith(true);

    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    await act(async () => vi.advanceTimersByTimeAsync(1_000));

    expect(mocks.state.mock.calls).toEqual([[true], [], []]);
    expect(mocks.mark).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(STORE_CLAIM_CODE_SESSION_KEY)).toBeNull();
  });

  it('treats a conflict won by this identity as success despite a cached unclaimed answer', async () => {
    mocks.claim.mockResolvedValue({ kind: 'already-claimed', seller: PUBKY });
    mocks.state.mockResolvedValue({ kind: 'unclaimed', seller: null, source: null });
    await renderSignedIn();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Claim this shop' }));
    await flushPromises();

    expect(screen.getByText('The shop is claimed.')).toBeInTheDocument();
    expect(mocks.state).toHaveBeenCalledWith(true);
    expect(window.sessionStorage.getItem(STORE_CLAIM_CODE_SESSION_KEY)).toBeNull();
  });

  it('stops after eight polls and offers Continue', async () => {
    vi.useFakeTimers();
    mocks.state.mockResolvedValue({ kind: 'unclaimed', seller: null, source: null });
    render(<StoreClaimFlow />);
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByRole('button', { name: 'Claim this shop' }));
    await act(async () => Promise.resolve());

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await act(async () => vi.advanceTimersByTimeAsync(1_000));
    }

    expect(mocks.state).toHaveBeenCalledTimes(9);
    expect(screen.getByText('The shop is claimed. It may take a moment to appear.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(navigateToClaimedStudio).toHaveBeenCalledTimes(1);
  });
});
