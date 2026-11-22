import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setStoreSeller } from '@/test-utils/store-mode';
import { Chat } from './Chat';

const auth = vi.hoisted(() => ({ currentUserPubky: null as string | null }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/messages',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/hooks/useChatConversations/useChatConversations', () => ({
  useChatConversations: () => ({ conversations: [], isLoading: false, isSignedIn: true }),
}));
vi.mock('@/hooks/useChatIdentity/useChatIdentity', () => ({
  useChatIdentity: () => ({ identityState: 'ready', retry: vi.fn() }),
}));
vi.mock('@/hooks/useIsEmbedded/useIsEmbedded', () => ({ useIsEmbedded: () => false }));
vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: { currentUserPubky: string | null; setShowSignInDialog: () => void }) => unknown) =>
    selector({ currentUserPubky: auth.currentUserPubky, setShowSignInDialog: vi.fn() }),
}));
vi.mock('@/organisms/Marketplace/MarketplaceContentLayout', () => ({
  MarketplaceContentLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
const commerce = vi.hoisted(() => ({ mode: 'transaction-service' }));
vi.mock('@/config/commerce', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config/commerce')>()),
  getCommerceAdapterMode: () => commerce.mode,
}));
vi.mock('@/organisms/Marketplace/MarketplaceSectionNav', () => ({
  MarketplaceSectionNav: () => <nav aria-label="Market sections" />,
}));

describe('Chat inbox', () => {
  it('shows the Market tab bar above the inbox, since Messages is one of its tabs', () => {
    render(<Chat />);

    const nav = screen.getByRole('navigation', { name: 'Market sections' });
    expect(screen.getByRole('link', { name: 'Browse market' })).toBeInTheDocument();
    const inbox = document.querySelector('[data-surface="chat-inbox"]');
    expect(inbox).not.toBeNull();
    // The bar comes before the inbox heading, as on every other Market tab.
    expect(nav.compareDocumentPosition(inbox as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('leaves the Market tab bar out when commerce is unavailable, as the header and footer do', () => {
    commerce.mode = 'unavailable';
    try {
      render(<Chat />);

      expect(screen.queryByRole('navigation', { name: 'Market sections' })).not.toBeInTheDocument();
      // The empty inbox's Browse market link would lead to the same unavailable page.
      expect(screen.queryByRole('link', { name: 'Browse market' })).not.toBeInTheDocument();
      expect(document.querySelector('[data-surface="chat-inbox"]')).not.toBeNull();
    } finally {
      commerce.mode = 'transaction-service';
    }
  });

  describe('store mode', () => {
    const STORE_SELLER = 's'.repeat(52);

    afterEach(() => {
      setStoreSeller(undefined);
      auth.currentUserPubky = null;
    });

    it("offers a buyer's empty inbox a message to the store seller instead of a market to browse", () => {
      setStoreSeller(STORE_SELLER);
      auth.currentUserPubky = 'b'.repeat(52);
      render(<Chat />);

      expect(screen.getByText('Your conversation with this shop.')).toBeInTheDocument();
      expect(screen.getByTestId('chat-inbox-message-seller')).toHaveTextContent('Message seller');
      expect(screen.queryByRole('link', { name: 'Browse market' })).not.toBeInTheDocument();
    });

    it("gives the store seller's empty inbox neither", () => {
      setStoreSeller(STORE_SELLER);
      auth.currentUserPubky = STORE_SELLER;
      render(<Chat />);

      expect(screen.getByText('Your conversations with buyers and sellers.')).toBeInTheDocument();
      expect(screen.queryByTestId('chat-inbox-message-seller')).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Browse market' })).not.toBeInTheDocument();
    });
  });
});
