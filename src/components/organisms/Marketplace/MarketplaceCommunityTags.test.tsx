import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TagKind } from '@/application/tag/tag.types';
import { setStoreSeller } from '@/test-utils/store-mode';
import { MarketplaceCommunityTags } from './MarketplaceCommunityTags';

const useMarketplaceTags = vi.hoisted(() =>
  vi.fn(() => ({ tags: [], handleTagAdd: vi.fn(), handleTagToggle: vi.fn() })),
);

vi.mock('@/hooks/useMarketplaceTags/useMarketplaceTags', () => ({ useMarketplaceTags }));

vi.mock('@/organisms/ClickableTagsList/ClickableTagsList', () => ({
  ClickableTagsList: () => <div data-testid="clickable-tags-list" />,
}));

const SELLER = 's'.repeat(52);

describe('MarketplaceCommunityTags', () => {
  afterEach(() => {
    setStoreSeller(undefined);
    useMarketplaceTags.mockClear();
  });

  it('renders the community tag card in the full Market', () => {
    render(<MarketplaceCommunityTags target={{ kind: TagKind.SHOP, ownerPubky: SELLER }} variant="info-card" />);

    expect(screen.getByText('Community tags')).toBeInTheDocument();
    expect(useMarketplaceTags).toHaveBeenCalledWith({ kind: TagKind.SHOP, ownerPubky: SELLER });
  });

  it('renders nothing in a store and reads no tags', () => {
    setStoreSeller(SELLER);

    const { container } = render(
      <MarketplaceCommunityTags
        target={{ kind: TagKind.LISTING, sellerPubky: SELLER, listingId: 'boots_01' }}
        variant="info-card"
      />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(useMarketplaceTags).not.toHaveBeenCalled();
  });
});
