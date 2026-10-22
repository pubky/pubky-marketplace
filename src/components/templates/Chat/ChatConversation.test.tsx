import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatConversation } from './ChatConversation';

const PEER = 's'.repeat(52);
const commerce = vi.hoisted(() => ({ mode: 'transaction-service' }));

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
    openState: 'ready',
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
vi.mock('@/organisms/Chat/ChatComposer', () => ({ ChatComposer: () => <div /> }));
vi.mock('@/organisms/Chat/ChatThread', () => ({ ChatThread: () => <div /> }));
vi.mock('@/organisms/Chat/ChatPrivacyNote', () => ({ ChatPrivacyNote: () => null }));
vi.mock('@/organisms/ContentLayout/ContentLayout', () => ({
  ContentLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

describe('ChatConversation', () => {
  afterEach(() => {
    commerce.mode = 'transaction-service';
  });

  it("links to the peer's storefront when commerce is on", () => {
    render(<ChatConversation peerPubky={PEER} />);

    expect(screen.getByRole('link', { name: /Storefront/ })).toBeInTheDocument();
  });

  it('leaves the storefront link out when commerce is unavailable', () => {
    commerce.mode = 'unavailable';
    render(<ChatConversation peerPubky={PEER} />);

    expect(screen.queryByRole('link', { name: /Storefront/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All messages' })).toBeInTheDocument();
  });
});
