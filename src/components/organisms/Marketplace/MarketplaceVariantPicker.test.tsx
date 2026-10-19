import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createCommerceListingFixture } from '@/test/fixtures/commerce/commerce';
import { MarketplaceVariantPicker } from './MarketplaceVariantPicker';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.setPointerCapture = vi.fn();
});

const record = createCommerceListingFixture({
  variants: [
    { id: 'size_s', options: { size: 'S' }, quantity: 3, mediaIds: [], enabled: true },
    { id: 'size_m', options: { size: 'M' }, quantity: 4, mediaIds: [], enabled: true },
    { id: 'size_l', options: { size: 'L' }, quantity: 0, mediaIds: [], enabled: true },
    { id: 'size_xl', options: { size: 'XL' }, quantity: 2, mediaIds: [], enabled: false },
  ],
});

async function openPicker(soldOut: string[], onSelect = vi.fn()) {
  render(
    <MarketplaceVariantPicker
      record={record}
      selectedVariantId="size_m"
      onSelect={onSelect}
      soldOutVariantIds={new Set(soldOut)}
    />,
  );
  await userEvent.click(screen.getByRole('combobox', { name: 'Choose listing variant' }));
  return { listbox: await screen.findByRole('listbox'), onSelect };
}

describe('MarketplaceVariantPicker', () => {
  it('keeps a sold-out size visible, disabled and labelled', async () => {
    const { listbox } = await openPicker(['size_s']);

    const sold = within(listbox).getByRole('option', { name: 'S · Sold out' });
    expect(sold).toHaveAttribute('aria-disabled', 'true');
    expect(within(listbox).getByRole('option', { name: 'M · 4 left' })).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('labels a size with no record stock as sold out too', async () => {
    const { listbox } = await openPicker([]);

    expect(within(listbox).getByRole('option', { name: 'L · Sold out' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('keeps a withdrawn size listed and disabled', async () => {
    const { listbox } = await openPicker([]);

    expect(within(listbox).getByRole('option', { name: 'XL · 2 left' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('does not select a sold-out size', async () => {
    const { listbox, onSelect } = await openPicker(['size_s']);

    fireEvent.click(within(listbox).getByRole('option', { name: 'S · Sold out' }));

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('selects a size that has stock', async () => {
    const { listbox, onSelect } = await openPicker(['size_m']);

    await userEvent.click(within(listbox).getByRole('option', { name: 'S · 3 left' }));

    expect(onSelect).toHaveBeenCalledWith('size_s');
  });

  it('shows a made-to-order size without a count and never sold out, even at zero in the record', async () => {
    render(
      <MarketplaceVariantPicker
        record={record}
        selectedVariantId="size_m"
        onSelect={vi.fn()}
        soldOutVariantIds={new Set()}
        madeToOrderVariantIds={new Set(['size_l'])}
      />,
    );
    await userEvent.click(screen.getByRole('combobox', { name: 'Choose listing variant' }));
    const listbox = await screen.findByRole('listbox');
    const made = within(listbox).getByRole('option', { name: 'L · Made to order' });
    expect(made).not.toHaveAttribute('aria-disabled', 'true');
    expect(within(listbox).getByRole('option', { name: 'S · 3 left' })).toBeInTheDocument();
  });
});
