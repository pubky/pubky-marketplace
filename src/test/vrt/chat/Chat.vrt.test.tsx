// Intentional import order — browser-mode mock factories rely on stable aliases.
/* eslint-disable simple-import-sort/imports */
import { createMarketplaceVrtAuthStore } from '@/test/mocks/marketplace-vrt';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatConversationView } from '@/controllers/chat/chat.types';
import type { ChatStore } from '@/stores/chat/chat.types';
import { renderForVRT, VRT_ROOT_TESTID } from '@/test-utils/vrt';
import { formatStableRelative, HOUR_MS, MINUTE_MS, VRT_FROZEN_NOW_MS } from '@/test-utils/vrt.clock';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';
import { Chat } from '@/templates/Chat/Chat';

/**
 * `/messages`: the inbox list in its five states — conversations (unread,
 * read, and a peer who has not set up messages yet), loading, empty, signed
 * out, and a sign-in that lacks the chat scopes. The hooks are the units under their
 * own tests; VRT pins their output so the capture is deterministic.
 */

const ME = vi.hoisted(() => 'm'.repeat(52));
const SELLER = vi.hoisted(() => 's'.repeat(52));
const BUYER = vi.hoisted(() => 'b'.repeat(52));
const STRANGER = vi.hoisted(() => 'x'.repeat(52));

const scene = vi.hoisted(() => ({
  conversations: [] as ChatConversationView[],
  isLoading: false,
  isSignedIn: true,
  identityState: 'ready' as ChatStore['identityState'],
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/messages',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: createMarketplaceVrtAuthStore({ getCurrentUserPubky: () => (scene.isSignedIn ? ME : null) }),
}));

vi.mock('@/hooks/useChatConversations/useChatConversations', () => ({
  useChatConversations: () => ({
    conversations: scene.conversations,
    isLoading: scene.isLoading,
    isSignedIn: scene.isSignedIn,
  }),
}));

vi.mock('@/hooks/useChatIdentity/useChatIdentity', () => ({
  useChatIdentity: () => ({ identityState: scene.identityState, inboxStatus: 'ready', retry: async () => {} }),
}));

vi.mock('@/hooks/useSignOut/useSignOut', () => ({
  useSignOut: () => ({ handleSignOut: async () => {}, isLoading: false }),
}));

// Peer names come from the shop (seller) or the profile (buyer); a stranger has neither.
vi.mock('@/hooks/useUserDetails/useUserDetails', () => ({
  useUserDetails: (pubky: string) => ({
    userDetails: pubky === BUYER ? { name: 'Bob Buyer' } : null,
    isLoading: false,
  }),
}));

// The Market tab bar above the inbox: its badges read the cart, activity and orders; none are shown here.
vi.mock('@/hooks/useMarketplaceCartCount/useMarketplaceCartCount', () => ({ useMarketplaceCartCount: () => 0 }));
vi.mock('@/hooks/useMarketplaceActivityUnread/useMarketplaceActivityUnread', () => ({
  useMarketplaceActivityUnread: () => 0,
}));
vi.mock('@/hooks/useMarketplaceOrdersAttention/useMarketplaceOrdersAttention', () => ({
  useMarketplaceOrdersAttention: () => 0,
}));
vi.mock('@/hooks/useChatUnread/useChatUnread', () => ({ useChatUnread: () => 0 }));

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    getShop: async (pubky: string) => (pubky === SELLER ? { record: { name: 'Boot Barn' } } : null),
    getOrFetchListing: async () => null,
  },
}));

vi.mock('@/hooks/useRelativeTime/useRelativeTime', () => {
  const result = { formatRelativeTime: (date: Date) => formatStableRelative(date.getTime()) };
  return { useRelativeTime: () => result };
});

vi.mock('@/organisms/ContentLayout/ContentLayout', () => ({
  ContentLayout: ({ children }: { children: React.ReactNode }) => <main className="w-full py-6">{children}</main>,
}));

function conversation(peer: string, overrides: Partial<ChatConversationView> = {}): ChatConversationView {
  return {
    id: `${ME}:${peer}`,
    owner_id: ME,
    peer_pubky: peer,
    folder_id: 'f'.repeat(32),
    own_folder_id: 'e'.repeat(32),
    peer_key_id: 'k'.repeat(16),
    peer_public_key: null,
    my_key_id: 'm'.repeat(16),
    peer_state: 'ready',
    origin: 'local',
    last_message_at: VRT_FROZEN_NOW_MS - 5 * MINUTE_MS,
    last_message_preview: 'Hi, are the boots still available?',
    last_message_direction: 'received',
    last_read_at: 0,
    last_context: null,
    priv_state_dirty: false,
    created_at: VRT_FROZEN_NOW_MS - 2 * HOUR_MS,
    updated_at: VRT_FROZEN_NOW_MS - 5 * MINUTE_MS,
    unreadCount: 0,
    ...overrides,
  };
}

const populated = (): ChatConversationView[] => [
  conversation(SELLER, { unreadCount: 2 }),
  conversation(BUYER, {
    last_message_at: VRT_FROZEN_NOW_MS - 3 * HOUR_MS,
    last_message_preview: 'Shipped this morning, tracking follows.',
    last_message_direction: 'sent',
    last_read_at: VRT_FROZEN_NOW_MS - 3 * HOUR_MS,
  }),
  conversation(STRANGER, {
    peer_state: 'no_key',
    folder_id: null,
    own_folder_id: null,
    peer_key_id: null,
    last_message_at: null,
    last_message_preview: null,
    last_message_direction: null,
  }),
];

describe('Chat inbox — visual regression', () => {
  beforeEach(() => {
    scene.conversations = [];
    scene.isLoading = false;
    scene.isSignedIn = true;
    scene.identityState = 'ready';
  });

  it('renders conversations with unread, read and waiting peers at desktop viewport', async () => {
    scene.conversations = populated();

    const screen = await renderForVRT(<Chat />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });
    await expect.element(screen.getByText('Boot Barn')).toBeInTheDocument();
    await expect.element(screen.getByLabelText('2 unread')).toBeInTheDocument();
    await expect.element(screen.getByText('Waiting for them to set up messages')).toBeInTheDocument();
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('chat-inbox-desktop');
  });

  it('renders conversations at mobile viewport', async () => {
    scene.conversations = populated();

    const screen = await renderForVRT(<Chat />, { viewport: VRT_VIEWPORT_MOBILE, disableHover: true });
    await expect.element(screen.getByText('Boot Barn')).toBeInTheDocument();
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('chat-inbox-mobile');
  });

  it('renders the loading skeletons at desktop viewport', async () => {
    scene.isLoading = true;

    const screen = await renderForVRT(<Chat />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });
    await expect.element(screen.getByTestId('chat-inbox-loading')).toBeInTheDocument();
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('chat-inbox-loading-desktop');
  });

  it('renders the empty state at desktop viewport', async () => {
    const screen = await renderForVRT(<Chat />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });
    await expect.element(screen.getByText('No messages yet.')).toBeInTheDocument();
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('chat-inbox-empty-desktop');
  });

  it('renders the signed-out state at desktop viewport', async () => {
    scene.isSignedIn = false;

    const screen = await renderForVRT(<Chat />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });
    await expect.element(screen.getByText('Sign in to see your messages.')).toBeInTheDocument();
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('chat-inbox-signed-out-desktop');
  });

  // Without the chat scopes no key can be provisioned, so nothing can be listed: the notice stands alone.
  it('renders the re-approval notice when the sign-in lacks the chat scopes at desktop viewport', async () => {
    scene.identityState = 'needs_reauth';

    const screen = await renderForVRT(<Chat />, { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true });
    await expect.element(screen.getByTestId('chat-identity-notice')).toBeInTheDocument();
    await expect.element(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    await expect.element(screen.getByTestId('chat-inbox-empty')).not.toBeInTheDocument();
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('chat-inbox-needs-reauth-desktop');
  });
});
