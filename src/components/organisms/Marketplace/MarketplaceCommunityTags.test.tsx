import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TagKind } from '@/application/tag/tag.types';
import { useMarketplaceTags } from '@/hooks/useMarketplaceTags/useMarketplaceTags';
import { ClickableTagsList } from '@/organisms/ClickableTagsList/ClickableTagsList';
import { MarketplaceCommunityTags } from './MarketplaceCommunityTags';

vi.mock('@/hooks/useMarketplaceTags/useMarketplaceTags', () => ({ useMarketplaceTags: vi.fn() }));
vi.mock('@/organisms/ClickableTagsList/ClickableTagsList', () => ({ ClickableTagsList: vi.fn(() => null) }));

describe('Marketplace community tag access', () => {
  it('links to the same item in the App from standalone and explains unavailable writes in the embedded Shop', () => {
    const props = {
      tags: [],
      normalizeLabel: (s: string) => s,
      handleTagAdd: vi.fn(),
      handleTagToggle: vi.fn(),
      readOnly: true,
      embeddedTaggingUnavailable: false,
      socialHandoffUrl: 'https://pubky.app/shop/marketplace/shop/owner',
    };
    vi.mocked(useMarketplaceTags).mockReturnValue(props);
    const target = { kind: TagKind.SHOP, ownerPubky: 'owner' } as const;
    const { rerender } = render(<MarketplaceCommunityTags target={target} />);
    const link = screen.getByRole('link', { name: 'Open in Pubky App to tag' });
    expect(link).toHaveAttribute('href', props.socialHandoffUrl);
    expect(link).toHaveAttribute('target', '_top');
    expect(vi.mocked(ClickableTagsList).mock.lastCall?.[0].readOnly).toBe(true);
    vi.mocked(useMarketplaceTags).mockReturnValue({
      ...props,
      embeddedTaggingUnavailable: true,
      socialHandoffUrl: undefined,
    });
    rerender(<MarketplaceCommunityTags target={target} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Tagging is currently unavailable for this account in Shop.')).toBeVisible();
  });
});
