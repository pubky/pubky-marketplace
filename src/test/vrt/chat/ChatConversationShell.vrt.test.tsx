// Intentional import order — browser-mode mock factories rely on stable aliases.
/* eslint-disable simple-import-sort/imports */
import { createMarketplaceVrtAuthStore, createMarketplaceVrtCommerceController } from '@/test/mocks/marketplace-vrt';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessageView } from '@/controllers/chat/chat.types';
import { renderForVRT, VRT_ROOT_TESTID } from '@/test-utils/vrt';
import { MINUTE_MS, VRT_FROZEN_NOW_MS } from '@/test-utils/vrt.clock';
import { VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';
import { ChatConversation } from '@/templates/Chat/ChatConversation';

/**
 * `/messages/[pubky]` inside the real page shell on a phone: the sticky Pubky
 * header and the bottom tab bar. The thread exactly fills the screen, so when
 * the phone keyboard opens the page scrolls; the conversation header must stay
 * below the logo instead of sliding under its fading background.
 */

const ME = vi.hoisted(() => 'm'.repeat(52));
const PEER = vi.hoisted(() => 's'.repeat(52));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => `/messages/${PEER}`,
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: createMarketplaceVrtAuthStore({ getCurrentUserPubky: () => ME }),
}));

vi.mock('@/hooks/usePublicRoute/usePublicRoute', () => ({
  usePublicRoute: () => ({ isPublicExploreRoute: false, isCoreExploreRoute: false, isDynamicPublicRoute: false }),
}));

const messages = vi.hoisted(() => [] as ChatMessageView[]);

vi.mock('@/hooks/useChatConversation/useChatConversation', () => ({
  useChatConversation: () => ({
    conversation: null,
    messages,
    hasMore: false,
    loadOlder: () => {},
    openState: 'ready',
    reopen: async () => {},
    retryMessage: async () => {},
    isSelf: false,
  }),
}));

vi.mock('@/hooks/useChatIdentity/useChatIdentity', () => ({
  useChatIdentity: () => ({ identityState: 'ready', inboxStatus: 'ready', retry: async () => {} }),
}));

vi.mock('@/hooks/useChatPrivacyNote/useChatPrivacyNote', () => ({
  useChatPrivacyNote: () => ({ showNote: true, dismissNote: () => {} }),
}));

vi.mock('@/hooks/useUserDetails/useUserDetails', () => ({
  useUserDetails: () => ({ userDetails: null, isLoading: false }),
}));

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    ...createMarketplaceVrtCommerceController(),
    getShop: async (pubky: string) => (pubky === PEER ? { record: { name: 'Boot Barn' } } : null),
  },
}));

vi.mock('@/controllers/chat/chat', () => ({
  ChatController: { commitSendMessage: async () => 'id', getUnreadConversationCount: () => 0 },
}));

function message(id: string, body: string, minutesAgo: number, direction: 'sent' | 'received'): ChatMessageView {
  const sentAt = VRT_FROZEN_NOW_MS - minutesAgo * MINUTE_MS;
  return {
    id,
    body,
    owner_id: ME,
    peer_pubky: PEER,
    direction,
    file_name: `${sentAt}-00000000.json`,
    sent_at: sentAt,
    received_at: sentAt,
    context: null,
    status: 'sent',
    attempts: 0,
    next_attempt_at: null,
    last_error: null,
    clock_skewed: false,
  };
}

messages.push(
  message('m1', 'Hi, are the boots still available? Would you ship to Lisbon?', 30, 'received'),
  message('m2', 'Yes, still here. Shipping to Portugal is 12 EUR, about 4 days.', 25, 'sent'),
  message('m3', 'Great, I will take them.', 12, 'received'),
  message('m4', 'Order received, packing now.', 8, 'sent'),
);

/** The page scroll a phone keyboard causes: the thread keeps its height while the visible area shrinks. */
async function openKeyboard(visibleHeight: number, scrollBy: number) {
  const root = document.querySelector(`[data-testid="${VRT_ROOT_TESTID}"]`);
  const thread = document.querySelector('[data-surface="chat-conversation"]');
  if (!(root instanceof HTMLElement) || !(thread instanceof HTMLElement)) {
    throw new Error('VRT geometry rejected: the VRT root or the conversation surface is missing');
  }
  thread.style.height = `${thread.getBoundingClientRect().height}px`;
  root.style.height = `${visibleHeight}px`;
  root.style.overflowY = 'auto';
  root.scrollTop = scrollBy;
  await new Promise((resolve) => requestAnimationFrame(resolve));
  return root;
}

function headerGeometry(root: HTMLElement) {
  const mobileHeader = root.querySelector('.sticky.top-0');
  const chatHeader = root.querySelector('[data-surface="chat-conversation"] > :first-child');
  if (!(mobileHeader instanceof HTMLElement) || !(chatHeader instanceof HTMLElement)) {
    throw new Error('VRT geometry rejected: the Pubky header or the conversation header is missing');
  }
  const top = root.getBoundingClientRect().top;
  return {
    logoBottom: mobileHeader.getBoundingClientRect().bottom - top,
    chatHeaderTop: chatHeader.getBoundingClientRect().top - top,
  };
}

describe('Chat conversation in the phone shell — visual regression', () => {
  it.each([24, 60, 200])(
    'keeps the conversation header below the Pubky logo when the page scrolls %ipx',
    async (by) => {
      await renderForVRT(<ChatConversation peerPubky={PEER} />, { viewport: VRT_VIEWPORT_MOBILE, disableHover: true });
      const root = await openKeyboard(480, by);

      const { logoBottom, chatHeaderTop } = headerGeometry(root);
      expect(logoBottom).toBe(96);
      expect(chatHeaderTop).toBeGreaterThanOrEqual(logoBottom);
    },
  );

  it('renders the conversation with the keyboard open at mobile viewport', async () => {
    const screen = await renderForVRT(<ChatConversation peerPubky={PEER} />, {
      viewport: VRT_VIEWPORT_MOBILE,
      disableHover: true,
    });
    await openKeyboard(480, 60);

    await expect(screen.getByTestId(VRT_ROOT_TESTID)).toMatchScreenshot('chat-conversation-keyboard-open-mobile');
  });
});
