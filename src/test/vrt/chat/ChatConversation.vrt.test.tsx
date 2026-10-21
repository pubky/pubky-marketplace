// Intentional import order — browser-mode mock factories rely on stable aliases.
/* eslint-disable simple-import-sort/imports */
import { createMarketplaceVrtAuthStore } from '@/test/mocks/marketplace-vrt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatOpenResult } from '@/application/chat/chat.types';
import type { ChatConversationView, ChatMessageView } from '@/controllers/chat/chat.types';
import type { ChatStore } from '@/stores/chat/chat.types';
import { renderForVRT, VRT_ROOT_TESTID } from '@/test-utils/vrt';
import { HOUR_MS, MINUTE_MS, VRT_FROZEN_NOW_MS } from '@/test-utils/vrt.clock';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';
import { setEmbedded } from '@/test-utils/embedded';
import { EmbeddedLegalFooter } from '@/molecules/EmbeddedLegalFooter/EmbeddedLegalFooter';
import { ChatConversation } from '@/templates/Chat/ChatConversation';

/**
 * `/messages/[pubky]`: one thread — day separators, received and sent bubbles
 * in every delivery state (sent, sending, waiting for the peer, not sent with
 * Retry), the listing context chip from `?listing=`, the composer and the
 * privacy note; an older thread about an order with the note dismissed, a
 * lagging-clock row and "Load older"; the empty thread with a peer who has not
 * set up messages; the signed-out thread; and the re-approval notice that
 * disables the composer.
 */

const ME = vi.hoisted(() => 'm'.repeat(52));
const PEER = vi.hoisted(() => 's'.repeat(52));
const LISTING_ID = vi.hoisted(() => 'boots-1');
const ORDER_ID = vi.hoisted(() => 'ord_8f2c1a9e7b3d');

const scene = vi.hoisted(() => ({
  messages: [] as ChatMessageView[],
  conversation: null as ChatConversationView | null,
  openState: 'ready' as ChatOpenResult['state'] | 'opening',
  identityState: 'ready' as ChatStore['identityState'],
  isSignedIn: true,
  query: '',
  hasMore: false,
  showNote: true,
  inboxStatus: 'ready' as 'ready' | 'disabled',
  // The phone keyboard: browsers here have none, so the scene sets what the visual viewport reports.
  keyboardHeight: 0,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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
    hasMore: scene.hasMore,
    loadOlder: () => {},
    openState: scene.openState,
    reopen: async () => {},
    retryMessage: async () => {},
    isSelf: false,
  }),
}));

vi.mock('@/hooks/useChatIdentity/useChatIdentity', () => ({
  useChatIdentity: () => ({
    identityState: scene.identityState,
    inboxStatus: scene.inboxStatus,
    retry: async () => {},
  }),
}));

vi.mock('@/hooks/useKeyboardViewport/useKeyboardViewport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useKeyboardViewport/useKeyboardViewport')>()),
  useKeyboardViewport: () => ({
    isKeyboardVisible: scene.keyboardHeight > 0,
    keyboardHeight: scene.keyboardHeight,
    keyboardTop: window.innerHeight - scene.keyboardHeight,
    viewportHeight: window.innerHeight - scene.keyboardHeight,
    viewportOffsetTop: 0,
  }),
}));

vi.mock('@/hooks/useSignOut/useSignOut', () => ({
  useSignOut: () => ({ handleSignOut: async () => {}, isLoading: false }),
}));

// Dismissal lives in localStorage per account; the scene decides instead.
vi.mock('@/hooks/useChatPrivacyNote/useChatPrivacyNote', () => ({
  useChatPrivacyNote: () => ({ showNote: scene.showNote, dismissNote: () => {} }),
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

// The real shell renders the app header above the page (96px on phones, 144px
// from lg); the conversation header sticks at that offset, so the frame keeps
// the same room above the content.
vi.mock('@/organisms/ContentLayout/ContentLayout', () => ({
  ContentLayout: ({ children }: { children: React.ReactNode }) => (
    <main className="h-[900px] w-full pt-24 pb-6 lg:pt-36">{children}</main>
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
  // Same listing as m1: the thread shows the chip once for the run.
  message({
    id: 'm2',
    body: 'Yes, still here. Shipping to Portugal is 12 EUR, about 4 days.',
    sent_at: VRT_FROZEN_NOW_MS - 25 * HOUR_MS,
    context: { listingId: LISTING_ID },
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
  own_folder_id: 'e'.repeat(32),
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
  afterEach(() => setEmbedded(false));

  beforeEach(() => {
    scene.messages = [];
    scene.conversation = null;
    scene.openState = 'ready';
    scene.identityState = 'ready';
    scene.isSignedIn = true;
    scene.query = '';
    scene.hasMore = false;
    scene.showNote = true;
    scene.inboxStatus = 'ready';
    scene.keyboardHeight = 0;
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

  it('renders the thread embedded in the App at desktop viewport, fitting the frame with the legal strip', async () => {
    setEmbedded(true);
    scene.messages = thread();
    scene.conversation = conversation();

    const screen = await renderForVRT(
      <>
        <ChatConversation peerPubky={PEER} />
        <EmbeddedLegalFooter />
      </>,
      { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true },
    );
    await expect.element(screen.getByText('Great, I will take them.')).toBeInTheDocument();
    const root = screen.getByTestId(VRT_ROOT_TESTID).element() as HTMLElement;
    expect(root.querySelector('[data-testid="embedded-legal-footer"]'), 'the legal strip').not.toBeNull();
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('chat-conversation-embedded-desktop');
  });

  it('renders the thread embedded in the App at mobile viewport, fitting the frame with the legal strip', async () => {
    setEmbedded(true);
    scene.messages = thread();
    scene.conversation = conversation();

    const screen = await renderForVRT(
      <>
        <ChatConversation peerPubky={PEER} />
        <EmbeddedLegalFooter />
      </>,
      { viewport: VRT_VIEWPORT_MOBILE, disableHover: true },
    );
    await expect.element(screen.getByText('Great, I will take them.')).toBeInTheDocument();
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('chat-conversation-embedded-mobile');
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

  it('renders an order thread pinned above the open keyboard at mobile viewport', async () => {
    scene.messages = [
      message({
        id: 'k1',
        direction: 'received',
        body: 'Hello from latent space, this is a test message.',
        sent_at: VRT_FROZEN_NOW_MS - 3 * MINUTE_MS,
      }),
    ];
    scene.conversation = { ...conversation(), last_context: { orderId: ORDER_ID } };
    scene.query = `order=${ORDER_ID}`;
    scene.inboxStatus = 'disabled';
    scene.keyboardHeight = 320;

    const screen = await renderForVRT(<ChatConversation peerPubky={PEER} />, {
      viewport: VRT_VIEWPORT_MOBILE,
      disableHover: true,
    });
    await expect.element(screen.getByText('Hello from latent space, this is a test message.')).toBeInTheDocument();
    const root = screen.getByTestId(VRT_ROOT_TESTID).element() as HTMLElement;
    const frame = root.querySelector<HTMLElement>('[data-surface="chat-conversation"]');
    expect(frame?.getBoundingClientRect().bottom, 'the frame ends at the keyboard').toBe(window.innerHeight - 320);
    expect(root.querySelector('[data-testid="chat-no-inbox-note"]'), 'notes under the composer wait').toBeNull();
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('chat-conversation-keyboard-mobile');
  });

  it('renders an order thread with older history, a lagging clock and the note dismissed at desktop viewport', async () => {
    scene.messages = [
      message({
        id: 'o1',
        direction: 'received',
        body: 'Paid. When does it ship?',
        sent_at: VRT_FROZEN_NOW_MS - 3 * HOUR_MS,
        context: { orderId: ORDER_ID },
      }),
      message({ id: 'o2', body: 'Tomorrow morning, tracking follows.', sent_at: VRT_FROZEN_NOW_MS - 2 * HOUR_MS }),
      message({
        id: 'o3',
        direction: 'received',
        body: 'Thanks! My clock is a bit off, by the way.',
        sent_at: VRT_FROZEN_NOW_MS + 40 * MINUTE_MS,
        received_at: VRT_FROZEN_NOW_MS - 5 * MINUTE_MS,
        clock_skewed: true,
      }),
    ];
    scene.conversation = { ...conversation(), last_context: { orderId: ORDER_ID } };
    scene.query = `order=${ORDER_ID}`;
    scene.hasMore = true;
    scene.showNote = false;

    const screen = await renderForVRT(<ChatConversation peerPubky={PEER} />, {
      viewport: VRT_VIEWPORT_DESKTOP,
      disableHover: true,
    });
    await expect.element(screen.getByText('Load older messages')).toBeInTheDocument();
    await expect.element(screen.getByText(`Order ${ORDER_ID.slice(0, 8)}`).first()).toBeInTheDocument();
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('chat-conversation-order-desktop');
  });

  it('renders an empty thread with a peer who has not set up messages at desktop viewport', async () => {
    scene.openState = 'peer_not_enabled';

    const screen = await renderForVRT(<ChatConversation peerPubky={PEER} />, {
      viewport: VRT_VIEWPORT_DESKTOP,
      disableHover: true,
    });
    await expect.element(screen.getByText(/hasn't set up messages yet/u)).toBeInTheDocument();
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('chat-conversation-peer-not-enabled-desktop');
  });

  it('renders an empty thread with a peer who has not set up messages at mobile viewport', async () => {
    scene.openState = 'peer_not_enabled';

    const screen = await renderForVRT(<ChatConversation peerPubky={PEER} />, {
      viewport: VRT_VIEWPORT_MOBILE,
      disableHover: true,
    });
    await expect.element(screen.getByText(/hasn't set up messages yet/u)).toBeInTheDocument();
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('chat-conversation-peer-not-enabled-mobile');
  });

  it('renders the no-inbox note under the composer before the peer has replied at desktop viewport', async () => {
    scene.messages = [
      message({ id: 'n1', body: 'Hi, is this still available?', sent_at: VRT_FROZEN_NOW_MS - 3 * MINUTE_MS }),
    ];
    scene.conversation = conversation();
    scene.inboxStatus = 'disabled';
    scene.showNote = false;

    const screen = await renderForVRT(<ChatConversation peerPubky={PEER} />, {
      viewport: VRT_VIEWPORT_DESKTOP,
      disableHover: true,
    });
    await expect.element(screen.getByTestId('chat-no-inbox-note')).toBeInTheDocument();
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('chat-conversation-no-inbox-desktop');
  });

  it('renders the signed-out thread at desktop viewport', async () => {
    scene.isSignedIn = false;

    const screen = await renderForVRT(<ChatConversation peerPubky={PEER} />, {
      viewport: VRT_VIEWPORT_DESKTOP,
      disableHover: true,
    });
    await expect.element(screen.getByText('Sign in to see your messages.')).toBeInTheDocument();
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('chat-conversation-signed-out-desktop');
  });

  // Without the chat scopes no key exists, so the thread cannot have loaded: notice plus a disabled composer.
  it('renders the re-approval notice with a disabled composer at desktop viewport', async () => {
    scene.identityState = 'needs_reauth';

    const screen = await renderForVRT(<ChatConversation peerPubky={PEER} />, {
      viewport: VRT_VIEWPORT_DESKTOP,
      disableHover: true,
    });
    await expect.element(screen.getByTestId('chat-identity-notice')).toBeInTheDocument();
    await expect.element(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    await expect.element(screen.getByText('Sign in again to send messages.')).toBeInTheDocument();
    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('chat-conversation-needs-reauth-desktop');
  });
});
