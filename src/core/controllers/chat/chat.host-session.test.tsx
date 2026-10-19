import type { Session } from '@synonymdev/pubky';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApplication } from '@/application/auth/auth';
import { ChatApplication } from '@/application/chat/chat';
import { CAPABILITIES, CORE_CAPABILITIES } from '@/config/app';
import { AuthController } from '@/controllers/auth/auth';
import { resetGrantTest } from '@/controllers/auth/auth.grant-test-utils';
import type { HostSessionSnapshot } from '@/controllers/auth/auth.types';
import { ChatController } from '@/controllers/chat/chat';
import { chatPrivateKeyUrl, chatPublicKeyUrl } from '@/libs/chat/paths';
import { ChatIdentityNotice } from '@/organisms/Chat/ChatIdentityNotice';
import { InboxService } from '@/services/inbox/inbox';
import { LocalChatService } from '@/services/local/chat/chat';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useChatStore } from '@/stores/chat/chat.store';
import { type FakeHomeserver, installFakeHomeserver } from '@/test-utils/fake-homeserver';
import { asOpaque } from '@/test-utils/type-assertions';
import { installWebLocks, removeWebLocks } from '@/test-utils/web-locks';

vi.mock('@/database/franky/franky.helpers', () => ({ clearPrivateData: vi.fn(), clearDatabase: vi.fn() }));
vi.mock('@/libs/query-client/query-client.factory', async (original) => ({
  ...(await original<object>()),
  clearAllQueryClients: vi.fn(),
}));
vi.mock('@/libs/shop-session/bridge', () => ({ requestShopHostAction: vi.fn().mockReturnValue(true) }));
vi.mock('@/libs/utils/utils', async (original) => ({ ...(await original<object>()), clearCookies: vi.fn() }));
vi.mock('@/services/marketplace/marketplace-grant-client', async (original) => ({
  ...(await original<object>()),
  clearMarketplaceBffSessionConfirmed: vi.fn().mockResolvedValue(undefined),
}));
// The notice's Sign out button uses the app router; the host App owns sign-out anyway.
vi.mock('@/hooks/useSignOut/useSignOut', () => ({
  useSignOut: () => ({ handleSignOut: vi.fn(), isLoading: false }),
}));

const ALICE = 'a'.repeat(52);

/** What the App hands the embedded Shop once its own grant is restored. */
const hostSnapshot: HostSessionSnapshot = {
  status: 'ready',
  generation: '1',
  pubky: ALICE,
  clientId: 'pubky.app',
  grantId: 'grant-alice',
  sessionStoreId: `${ALICE}:grant-alice`,
};

/** The App's grant session as the Shop sees it: its capabilities decide what chat may do. */
function hostSession(capabilities: string): Session {
  const publicKey = { z32: () => ALICE };
  const list = capabilities.split(',');
  return asOpaque<Session>({
    info: { publicKey, capabilities: list },
    grant: {
      grantId: vi.fn().mockResolvedValue('grant-alice'),
      sessionInfo: vi
        .fn()
        .mockResolvedValue({ publicKey, capabilities: list, clientId: 'pubky.app', grantId: 'grant-alice' }),
    },
    signout: vi.fn().mockResolvedValue(undefined),
  });
}

/**
 * The embedded Shop (`/shop-embed`) never signs in on its own: the App owns the
 * grant and hands over a host session. Chat must follow that session's scopes.
 */
describe('chat on an App-owned host session', () => {
  let homeserver: FakeHomeserver;

  beforeEach(async () => {
    resetGrantTest();
    installWebLocks();
    homeserver = installFakeHomeserver();
    vi.spyOn(InboxService, 'isConfigured').mockReturnValue(false);
    useChatStore.getState().reset();
    await LocalChatService.clearAll();
  });

  afterEach(async () => {
    await LocalChatService.clearAll();
    AuthController.setHostSessionMode(false);
    removeWebLocks();
    vi.restoreAllMocks();
  });

  it('an App session approved without the chat scopes opens the Shop and Messages asks for re-approval', async () => {
    vi.spyOn(AuthApplication, 'restoreHostSession').mockResolvedValue(hostSession(CORE_CAPABILITIES));

    // The Shop opens: the core scopes are enough for the host session.
    await expect(AuthController.applyHostSession(hostSnapshot)).resolves.toBe('ready');
    expect(useAuthStore.getState()).toMatchObject({ currentUserPubky: ALICE, sessionOwner: 'host' });

    // Messages cannot provision a key without `/priv/chat/v0/` and `/pub/chat/v0/`
    // write access: no homeserver write, the store says so, and the notice renders.
    await expect(ChatController.getOrFetchIdentity()).resolves.toBe('needs_reauth');
    expect(useChatStore.getState().identityState).toBe('needs_reauth');
    expect(homeserver.log.filter((entry) => entry.startsWith('PUT'))).toEqual([]);
    expect(homeserver.files.has(chatPublicKeyUrl(ALICE))).toBe(false);

    render(<ChatIdentityNotice identityState={useChatStore.getState().identityState} onRetry={() => {}} />);
    expect(screen.getByTestId('chat-identity-notice')).toHaveTextContent('Messages need a newer sign-in approval');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('an App session approved with the chat scopes provisions the chat key and chats', async () => {
    vi.spyOn(AuthApplication, 'restoreHostSession').mockResolvedValue(hostSession(CAPABILITIES));

    await expect(AuthController.applyHostSession(hostSnapshot)).resolves.toBe('ready');
    expect(useAuthStore.getState()).toMatchObject({ currentUserPubky: ALICE, sessionOwner: 'host' });

    await expect(ChatController.getOrFetchIdentity()).resolves.toBe('ready');
    expect(useChatStore.getState().identityState).toBe('ready');
    const identity = await ChatApplication.getIdentity(ALICE);
    expect(identity?.published).toBe(true);
    expect(homeserver.files.get(chatPrivateKeyUrl(ALICE))).toMatchObject({ v: 0, alg: 'x25519', kid: identity?.kid });
    expect(homeserver.files.get(chatPublicKeyUrl(ALICE))).toMatchObject({ kid: identity?.kid });
    expect(homeserver.files.get(chatPublicKeyUrl(ALICE))).not.toHaveProperty('sk');

    const { container } = render(
      <ChatIdentityNotice identityState={useChatStore.getState().identityState} onRetry={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
