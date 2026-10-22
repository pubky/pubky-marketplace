import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TagController } from '@/controllers/tag/tag';
import { MarketplaceReviewTagPicker } from './MarketplaceReviewTagPicker';

const VIEWER = 'v'.repeat(52);

function renderPicker(labels: string[] = [], onApply = vi.fn()) {
  render(<MarketplaceReviewTagPicker viewerPubky={VIEWER} labels={labels} onApply={onApply} />);
  return onApply;
}

const selected = () => screen.queryAllByTestId('marketplace-review-tag-selected').map((badge) => badge.textContent);

async function type(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(screen.getByRole('textbox', { name: 'Add a tag' }), `${text}{Enter}`);
}

describe('MarketplaceReviewTagPicker', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts from the applied labels and applies the draft once', async () => {
    vi.spyOn(TagController, 'getViewerUserTagLabels').mockResolvedValue([]);
    const user = userEvent.setup();
    const onApply = renderPicker(['trusted']);
    expect(selected()).toEqual(['trusted']);

    await type(user, 'fast');
    await user.click(screen.getByTestId('marketplace-review-tag-apply'));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(['trusted', 'fast']);
  });

  it('trims, lowercases and de-duplicates what is typed', async () => {
    vi.spyOn(TagController, 'getViewerUserTagLabels').mockResolvedValue([]);
    const user = userEvent.setup();
    renderPicker();

    await type(user, 'Fast');
    await type(user, 'FAST');
    await type(user, 'slow');

    expect(selected()).toEqual(['fast', 'slow']);
  });

  it('adds nothing for an empty entry and clears the field after an add', async () => {
    vi.spyOn(TagController, 'getViewerUserTagLabels').mockResolvedValue([]);
    const user = userEvent.setup();
    renderPicker();
    const input = screen.getByRole('textbox', { name: 'Add a tag' });

    await user.type(input, '{Enter}');
    expect(selected()).toEqual([]);
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();

    await user.type(input, 'fast{Enter}');
    expect(input).toHaveValue('');
  });

  it('stops at five labels and disables the field', async () => {
    vi.spyOn(TagController, 'getViewerUserTagLabels').mockResolvedValue([]);
    const user = userEvent.setup();
    renderPicker();

    for (const label of ['a', 'b', 'c', 'd', 'e']) await type(user, label);

    expect(selected()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(screen.getByRole('textbox', { name: 'Add a tag' })).toBeDisabled();
  });

  it('removes a label from the draft', async () => {
    vi.spyOn(TagController, 'getViewerUserTagLabels').mockResolvedValue([]);
    const user = userEvent.setup();
    renderPicker(['a', 'b']);

    await user.click(screen.getByRole('button', { name: 'Remove a' }));

    expect(selected()).toEqual(['b']);
  });

  it('offers the labels the viewer uses, toggles them, and locks the rest at five', async () => {
    vi.spyOn(TagController, 'getViewerUserTagLabels').mockResolvedValue(['one', 'two', 'three', 'four', 'five', 'six']);
    const user = userEvent.setup();
    renderPicker();
    await waitFor(() => expect(screen.getAllByTestId('marketplace-review-tag-suggestion')).toHaveLength(6));
    const suggestion = (name: string) => screen.getByRole('button', { name, pressed: undefined });

    for (const label of ['one', 'two', 'three', 'four', 'five']) await user.click(suggestion(label));

    expect(selected()).toEqual(['one', 'two', 'three', 'four', 'five']);
    expect(suggestion('six')).toBeDisabled();
    expect(suggestion('one')).toHaveAttribute('aria-pressed', 'true');

    await user.click(suggestion('one'));
    expect(selected()).toEqual(['two', 'three', 'four', 'five']);
    expect(suggestion('six')).toBeEnabled();
  });

  it('shows no suggestions heading when the device holds none', async () => {
    const read = vi.spyOn(TagController, 'getViewerUserTagLabels').mockResolvedValue([]);
    renderPicker();

    await waitFor(() => expect(read).toHaveBeenCalled());
    expect(screen.queryByText('Tags you use')).not.toBeInTheDocument();
  });

  it('applies no labels on Clear, whatever the draft holds', async () => {
    vi.spyOn(TagController, 'getViewerUserTagLabels').mockResolvedValue([]);
    const user = userEvent.setup();
    const onApply = renderPicker(['trusted']);

    await user.click(screen.getByRole('button', { name: 'Clear' }));

    expect(onApply).toHaveBeenCalledWith([]);
  });

  it('keeps a separator character out of a typed label', async () => {
    vi.spyOn(TagController, 'getViewerUserTagLabels').mockResolvedValue([]);
    const user = userEvent.setup();
    renderPicker();

    await type(user, 'two words');

    const badges = selected();
    expect(badges).toHaveLength(1);
    expect(badges[0]).not.toMatch(/[\s,:]/);
  });
});
