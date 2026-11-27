import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHAT_COPY } from '@/libs/chat/copy';
import { ChatConversation } from './ChatConversation';

const PEER = 's'.repeat(52);
const commerce = vi.hoisted(() => ({ mode: 'transaction-service' }));
const conversation = vi.hoisted(() => ({ openState: 'ready' }));

vi.mock('@/config/commerce', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config/commerce')>()),
  getCommerceAdapterMode: () => commerce.mode,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => `/messages/${PEER}`,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: { currentUserPubky: string; setShowSignInDialog: () => void }) => unknown) =>
    selector({ currentUserPubky: 'm'.repeat(52), setShowSignInDialog: vi.fn() }),
}));
vi.mock('@/hooks/useChatConversation/useChatConversation', () => ({
  useChatConversation: () => ({
    conversation: null,
    messages: [],
    hasMore: false,
    loadOlder: () => {},
    openState: conversation.openState,
    reopen: async () => {},
    retryMessage: async () => {},
    isSelf: false,
  }),
}));
vi.mock('@/hooks/useChatIdentity/useChatIdentity', () => ({
  useChatIdentity: () => ({ identityState: 'ready', inboxStatus: 'ready', retry: async () => {} }),
}));
vi.mock('@/organisms/Chat/ChatPeerIdentity', () => ({
  ChatPeerIdentity: () => <span>Boot Barn</span>,
  useChatPeerName: () => ({ name: 'Boot Barn' }),
}));
vi.mock('@/organisms/Chat/ChatComposer', () => ({
  ChatComposer: ({ disabled, disabledReason }: { disabled?: boolean; disabledReason?: string }) => (
    <div data-testid="chat-composer" data-disabled={disabled ? 'true' : 'false'}>
      {disabledReason}
    </div>
  ),
}));
vi.mock('@/organisms/Chat/ChatThread', () => ({ ChatThread: () => <div data-testid="chat-thread" /> }));
vi.mock('@/organisms/Chat/ChatPrivacyNote', () => ({ ChatPrivacyNote: () => null }));
vi.mock('@/organisms/Marketplace/MarketplaceContentLayout', () => ({
  MarketplaceContentLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

describe('ChatConversation', () => {
  afterEach(() => {
    commerce.mode = 'transaction-service';
    conversation.openState = 'ready';
  });

  it("links to the peer's storefront when commerce is on", () => {
    render(<ChatConversation peerPubky={PEER} />);

    expect(screen.getByRole('link', { name: /Storefront/ })).toBeInTheDocument();
  });

  it('explains a store restriction and disables the composer', () => {
    conversation.openState = 'store_restricted';
    render(<ChatConversation peerPubky={PEER} />);

    expect(screen.getByText('Boot Barn')).toBeInTheDocument();
    expect(screen.getByTestId('chat-store-restricted')).toHaveTextContent(CHAT_COPY.storeRestrictedTitle);
    expect(screen.getByTestId('chat-store-restricted')).toHaveTextContent(CHAT_COPY.storeRestrictedBody);
    expect(screen.queryByTestId('chat-thread')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-composer')).toHaveAttribute('data-disabled', 'true');
    expect(screen.getByTestId('chat-composer')).toHaveTextContent(CHAT_COPY.storeRestrictedReason);
  });

  it('leaves the storefront link out when commerce is unavailable', () => {
    commerce.mode = 'unavailable';
    render(<ChatConversation peerPubky={PEER} />);

    expect(screen.queryByRole('link', { name: /Storefront/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All messages' })).toBeInTheDocument();
  });
});
