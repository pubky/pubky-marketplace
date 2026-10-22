import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Chat } from './Chat';

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
  useAuthStore: (selector: (state: { setShowSignInDialog: () => void }) => unknown) =>
    selector({ setShowSignInDialog: vi.fn() }),
}));
vi.mock('@/organisms/ContentLayout/ContentLayout', () => ({
  ContentLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
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
      expect(document.querySelector('[data-surface="chat-inbox"]')).not.toBeNull();
    } finally {
      commerce.mode = 'transaction-service';
    }
  });
});
