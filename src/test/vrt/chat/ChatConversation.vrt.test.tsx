// Intentional import order — browser-mode mock factories rely on stable aliases.
/* eslint-disable simple-import-sort/imports */
import { createMarketplaceVrtAuthStore } from '@/test/mocks/marketplace-vrt';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatOpenResult } from '@/application/chat/chat.types';
import type { ChatConversationView, ChatMessageView } from '@/controllers/chat/chat.types';
import type { ChatStore } from '@/stores/chat/chat.types';
import { renderForVRT, VRT_ROOT_TESTID } from '@/test-utils/vrt';
import { HOUR_MS, MINUTE_MS, VRT_FROZEN_NOW_MS } from '@/test-utils/vrt.clock';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';
import { ChatConversation } from '@/templates/Chat/ChatConversation';

/**
 * `/messages/[pubky]`: one thread — day separators, received and sent bubbles
 * in every delivery state (sent, sending, waiting for the peer, not sent with
 * Retry), the listing context chip from `?listing=`, the composer, plus the
 * empty thread with a peer who has not opened Messages, and the re-approval
 * notice that disables the composer.
 */

const ME = vi.hoisted(() => 'm'.repeat(52));
const PEER = vi.hoisted(() => 's'.repeat(52));
const LISTING_ID = vi.hoisted(() => 'boots-1');

const scene = vi.hoisted(() => ({
  messages: [] as ChatMessageView[],
  conversation: null as ChatConversationView | null,
  openState: 'ready' as ChatOpenResult['state'] | 'opening',
  identityState: 'ready' as ChatStore['identityState'],
  isSignedIn: true,
  query: '',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => `/messages/${PEER}`,
  useSearchParams: () => new URLSearchParams(scene.query),
}));

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: createMarketplaceVrtAuthStore({ getCurrentUserPubky: () => (scene.isSignedIn ? ME : null) }),
}));

vi.mock('@/hooks/useChatConversation/useChatConversation', () => ({
  useChatConversation: () => ({
    conversation: scene.conversation,
    messages: scene.messages,
    hasMore: false,
    loadOlder: () => {},
    openState: scene.openState,
    reopen: async () => {},
    retryMessage: async () => {},
    isSelf: false,
  }),
}));

vi.mock('@/hooks/useChatIdentity/useChatIdentity', () => ({
  useChatIdentity: () => ({ identityState: scene.identityState, inboxStatus: 'ready', retry: async () => {} }),
}));

vi.mock('@/hooks/useUserDetails/useUserDetails', () => ({
  useUserDetails: () => ({ userDetails: null, isLoading: false }),
}));

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    getShop: async (pubky: string) => (pubky === PEER ? { record: { name: 'Boot Barn' } } : null),
    getOrFetchListing: async (_owner: string, id: string) =>
      id === LISTING_ID ? { title: 'Leather hiking boots, size 43' } : null,
  },
}));

// The composer form hook only talks to the controller on submit; the thread
// never submits in these captures, so the controller is a stub.
vi.mock('@/controllers/chat/chat', () => ({
  ChatController: { commitSendMessage: async () => 'id' },
}));

vi.mock('@/organisms/ContentLayout/ContentLayout', () => ({
  ContentLayout: ({ children }: { children: React.ReactNode }) => (
    <main className="h-[900px] w-full py-6">{children}</main>
  ),
}));

function message(overrides: Partial<ChatMessageView> & Pick<ChatMessageView, 'id' | 'body'>): ChatMessageView {
  const sentAt = overrides.sent_at ?? VRT_FROZEN_NOW_MS - 10 * MINUTE_MS;
  return {
    owner_id: ME,
    peer_pubky: PEER,
    direction: 'sent',
    file_name: `${sentAt}-00000000.json`,
    sent_at: sentAt,
    received_at: sentAt,
    context: null,
    status: 'sent',
    attempts: 0,
    next_attempt_at: null,
    last_error: null,
    clock_skewed: false,
    ...overrides,
  };
}

const thread = (): ChatMessageView[] => [
  message({
    id: 'm1',
    direction: 'received',
    body: 'Hi, are the boots still available? Would you ship to Lisbon?',
    sent_at: VRT_FROZEN_NOW_MS - 26 * HOUR_MS,
    context: { listingId: LISTING_ID },
  }),
  message({
    id: 'm2',
    body: 'Yes, still here. Shipping to Portugal is 12 EUR, about 4 days.',
    sent_at: VRT_FROZEN_NOW_MS - 25 * HOUR_MS,
  }),
  message({
    id: 'm3',
    direction: 'received',
    body: 'Great, I will take them.',
    sent_at: VRT_FROZEN_NOW_MS - 12 * MINUTE_MS,
  }),
  message({ id: 'm4', body: 'Order received, packing now.', sent_at: VRT_FROZEN_NOW_MS - 8 * MINUTE_MS }),
  message({
    id: 'm5',
    body: 'Tracking number follows tonight.',
    sent_at: VRT_FROZEN_NOW_MS - 2 * MINUTE_MS,
    status: 'queued',
  }),
  message({
    id: 'm6',
    body: 'One more photo of the soles attached to the listing.',
    sent_at: VRT_FROZEN_NOW_MS - MINUTE_MS,
    status: 'failed',
    attempts: 3,
    last_error: 'network',
  }),
];

const conversation = (): ChatConversationView => ({
  id: `${ME}:${PEER}`,
  owner_id: ME,
  peer_pubky: PEER,
  folder_id: 'f'.repeat(32),
  peer_key_id: 'k'.repeat(16),
  peer_public_key: null,
  my_key_id: 'm'.repeat(16),
  peer_state: 'ready',
  origin: 'local',
  last_message_at: VRT_FROZEN_NOW_MS - MINUTE_MS,
  last_message_preview: 'One more photo of the soles attached to the listing.',
  last_message_direction: 'sent',
  last_read_at: VRT_FROZEN_NOW_MS - 12 * MINUTE_MS,
  last_context: { listingId: LISTING_ID },
  priv_state_dirty: false,
  created_at: VRT_FROZEN_NOW_MS - 26 * HOUR_MS,
  updated_at: VRT_FROZEN_NOW_MS - MINUTE_MS,
  unreadCount: 0,
});

describe('Chat conversation — visual regression', () => {
  beforeEach(() => {
    scene.messages = [];
    scene.conversation = null;
    scene.openState = 'ready';
    scene.identityState = 'ready';
    scene.isSignedIn = true;
    scene.query = '';
  });

  it('renders a thread with every delivery state and a listing context at desktop viewport', async () => {
    scene.messages = thread();
    scene.conversation = conversation();
    scene.query = `listing=${LISTING_ID}`;

    const screen = await renderForVRT(<ChatConversation peerPubky={PEER} />, {
      viewport: VRT_VIEWPORT_DESKTOP,
      disableHover: true,
    });
    await expect.element(screen.getByText('Great, I will take them.')).toBeInTheDocument();
    await expect.element(screen.getByText('Not sent')).toBeInTheDocument();
    await expect.element(screen.getByText('Leather hiking boots, size 43').first()).toBeInTheDocument();
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('chat-conversation-desktop');
  });

  it('renders the thread at mobile viewport', async () => {
    scene.messages = thread();
    scene.conversation = conversation();
    scene.query = `listing=${LISTING_ID}`;

    const screen = await renderForVRT(<ChatConversation peerPubky={PEER} />, {
      viewport: VRT_VIEWPORT_MOBILE,
      disableHover: true,
    });
    await expect.element(screen.getByText('Not sent')).toBeInTheDocument();
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('chat-conversation-mobile');
  });

  it('renders an empty thread with a peer who has not opened Messages at desktop viewport', async () => {
    scene.openState = 'peer_not_enabled';

    const screen = await renderForVRT(<ChatConversation peerPubky={PEER} />, {
      viewport: VRT_VIEWPORT_DESKTOP,
      disableHover: true,
    });
    await expect.element(screen.getByText(/has not opened Messages yet/u)).toBeInTheDocument();
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('chat-conversation-peer-not-enabled-desktop');
  });

  it('renders the re-approval notice with a disabled composer at desktop viewport', async () => {
    scene.messages = thread().slice(0, 3);
    scene.conversation = conversation();
    scene.identityState = 'needs_reauth';

    const screen = await renderForVRT(<ChatConversation peerPubky={PEER} />, {
      viewport: VRT_VIEWPORT_DESKTOP,
      disableHover: true,
    });
    await expect.element(screen.getByTestId('chat-identity-notice')).toBeInTheDocument();
    await expect.element(screen.getByText('Sign in again to send messages.')).toBeInTheDocument();
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('chat-conversation-needs-reauth-desktop');
  });
});
