import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TagController } from '@/controllers/tag/tag';
import type { MarketplaceReviewFilter } from '@/libs/commerce/review-filter';
import { MarketplaceReviewFilterChips } from './MarketplaceReviewFilterChips';

const VIEWER = 'v'.repeat(52);

function renderChips(filter: MarketplaceReviewFilter = { kind: 'all' }) {
  const onFilterChange = vi.fn();
  render(<MarketplaceReviewFilterChips viewerPubky={VIEWER} filter={filter} onFilterChange={onFilterChange} />);
  return onFilterChange;
}

describe('MarketplaceReviewFilterChips', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.setPointerCapture = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('offers All, People I follow, My network and Tagged by me, with no Established accounts chip', () => {
    vi.spyOn(TagController, 'getViewerUserTagLabels').mockResolvedValue([]);
    renderChips();

    expect(screen.getAllByRole('radio').map((chip) => chip.textContent)).toEqual([
      'All',
      'People I follow',
      'My network',
    ]);
    expect(screen.getByRole('button', { name: /Tagged by me/ })).toBeInTheDocument();
    expect(screen.queryByText(/Established/i)).not.toBeInTheDocument();
  });

  it.each([
    ['People I follow', { kind: 'following' }],
    ['My network', { kind: 'wot' }],
  ] as const)('chooses %s', async (name, expected) => {
    const user = userEvent.setup();
    const onFilterChange = renderChips();

    await user.click(screen.getByRole('radio', { name }));

    expect(onFilterChange).toHaveBeenCalledWith(expected);
  });

  it('returns to All when the active chip is chosen again', async () => {
    const user = userEvent.setup();
    const onFilterChange = renderChips({ kind: 'following' });

    await user.click(screen.getByRole('radio', { name: 'People I follow' }));

    expect(onFilterChange).toHaveBeenCalledWith({ kind: 'all' });
  });

  it('marks the tagged chip active, with its label count, and none of the others', () => {
    vi.spyOn(TagController, 'getViewerUserTagLabels').mockResolvedValue([]);
    renderChips({ kind: 'tagged', labels: ['a', 'b'] });

    const tagged = screen.getByRole('button', { name: /Tagged by me/ });
    expect(tagged).toHaveAttribute('aria-pressed', 'true');
    expect(tagged).toHaveTextContent('· 2');
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();
  });

  it('opens the picker, applies its labels as one choice and closes', async () => {
    vi.spyOn(TagController, 'getViewerUserTagLabels').mockResolvedValue(['trusted']);
    const user = userEvent.setup();
    const onFilterChange = renderChips();

    await user.click(screen.getByRole('button', { name: /Tagged by me/ }));
    await user.click(await screen.findByRole('button', { name: 'trusted' }));
    await user.click(screen.getByTestId('marketplace-review-tag-apply'));

    expect(onFilterChange).toHaveBeenCalledTimes(1);
    expect(onFilterChange).toHaveBeenCalledWith({ kind: 'tagged', labels: ['trusted'] });
    await waitFor(() => expect(screen.queryByTestId('marketplace-review-tag-picker')).not.toBeInTheDocument());
  });

  it('hands an empty selection on Clear, which the list reads as All', async () => {
    vi.spyOn(TagController, 'getViewerUserTagLabels').mockResolvedValue([]);
    const user = userEvent.setup();
    const onFilterChange = renderChips({ kind: 'tagged', labels: ['trusted'] });

    await user.click(screen.getByRole('button', { name: /Tagged by me/ }));
    await user.click(await screen.findByRole('button', { name: 'Clear' }));

    expect(onFilterChange).toHaveBeenCalledWith({ kind: 'tagged', labels: [] });
  });
});
