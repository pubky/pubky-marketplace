import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/atoms/Tooltip/Tooltip';
import type { MarketplaceFeedNotification } from '@/pipes/marketplaceNotification/marketplaceNotification.types';
import { setStoreSeller } from '@/test-utils/store-mode';
import { MarketplaceNotificationItem } from './MarketplaceNotificationItem';

const ACTOR = 'a'.repeat(52);

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/marketplace/watchlist',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/hooks/useUserProfile/useUserProfile', () => ({
  useUserProfile: () => ({ profile: { name: 'Alice Example', avatarUrl: undefined }, isLoading: false }),
}));

const notification: MarketplaceFeedNotification = {
  id: 'marketplace:00000000-0000-4000-8000-000000000001',
  source: 'marketplace',
  type: 'outbid',
  actorPubky: ACTOR,
  aggregateId: 'listing:boots_01',
  timestamp: Date.parse('2026-08-19T20:00:00.000Z'),
  isUnread: false,
  href: '/marketplace/watchlist',
};

function renderRow() {
  render(
    <TooltipProvider>
      <MarketplaceNotificationItem notification={notification} />
    </TooltipProvider>,
  );
}

function profileLinks(): HTMLElement[] {
  return screen.queryAllByRole('link').filter((link) => link.getAttribute('href') === `/profile/${ACTOR}`);
}

describe('MarketplaceNotificationItem', () => {
  afterEach(() => {
    setStoreSeller(undefined);
  });

  it("links the actor's name and avatar to their profile", () => {
    renderRow();

    expect(screen.getByText('Alice Example')).toBeInTheDocument();
    expect(profileLinks().length).toBeGreaterThan(0);
  });

  it('names the actor without a profile link in a store, which serves no profiles', () => {
    setStoreSeller('s'.repeat(52));

    renderRow();

    expect(screen.getByText('Alice Example')).toBeInTheDocument();
    expect(profileLinks()).toHaveLength(0);
    expect(screen.getAllByRole('link').some((link) => link.getAttribute('href') === notification.href)).toBe(true);
  });
});
