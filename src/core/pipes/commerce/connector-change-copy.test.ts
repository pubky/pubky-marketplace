import { describe, expect, it } from 'vitest';
import { describeConflict, describeFieldChange, newVariantsCopy, unsupportedCopy } from './connector-change-copy';

const usd = (amountMinor: number) => ({ amountMinor, currency: 'USD', exponent: 2 });
const name = (id: string) => (id === 'v1' ? 'Size 42' : '');

describe('describeFieldChange', () => {
  it('names the listing variant a price belongs to, and omits it for a single variant', () => {
    expect(describeFieldChange({ kind: 'price', variantId: 'v1', from: usd(12500), to: usd(13000) }, name)).toBe(
      'Price (Size 42): $125.00 to $130.00',
    );
    expect(describeFieldChange({ kind: 'price', variantId: 'only', from: usd(12500), to: usd(13000) }, name)).toBe(
      'Price: $125.00 to $130.00',
    );
  });

  it('shortens long text so a description never fills the review', () => {
    const line = describeFieldChange({ kind: 'text', field: 'description', from: 'a'.repeat(300), to: 'short' }, name);

    expect(line.length).toBeLessThan(120);
    expect(line).toContain('…');
  });

  it('says what happens to photos, status and variants', () => {
    expect(describeFieldChange({ kind: 'photos', added: 2, removed: 1, notAdded: 0 }, name)).toBe(
      'Photos: 2 added, 1 removed',
    );
    expect(describeFieldChange({ kind: 'photos', added: 0, removed: 1, notAdded: 0 }, name)).toBe('Photos: 1 removed');
    expect(describeFieldChange({ kind: 'photos', added: 0, removed: 0, notAdded: 2 }, name)).toBe(
      'Photos: 2 not added, the listing holds as many photos as it can',
    );
    expect(describeFieldChange({ kind: 'status', from: 'active', to: 'paused' }, name)).toBe(
      'Pause this listing so it stops selling',
    );
    expect(describeFieldChange({ kind: 'status', from: 'paused', to: 'active' }, name)).toBe(
      'Make this listing active again',
    );
    expect(describeFieldChange({ kind: 'variant_off', variantId: 'v1' }, name)).toBe(
      'Turn off Size 42, which your store no longer sells',
    );
    expect(
      describeFieldChange({ kind: 'variant_options', variantId: 'v1', from: { size: '42' }, to: { size: '43' } }, name),
    ).toBe('Options (Size 42): size 42 to size 43');
    expect(describeFieldChange({ kind: 'variant_sku', variantId: 'v1', from: '', to: 'A-1' }, name)).toBe(
      'SKU (Size 42): none to A-1',
    );
  });
});

describe('describeConflict', () => {
  it('gives each side as the seller reads it', () => {
    expect(describeConflict({ kind: 'price', variantId: 'v1', yours: usd(11000), store: usd(13000) }, name)).toEqual({
      label: 'Price (Size 42)',
      yours: '$110.00',
      store: '$130.00',
    });
    expect(describeConflict({ kind: 'text', field: 'title', yours: 'Mine', store: 'Theirs' }, name)).toEqual({
      label: 'Title',
      yours: 'Mine',
      store: 'Theirs',
    });
  });
});

describe('unsupported and new variants', () => {
  it('explains each refusal with what to do next', () => {
    expect(unsupportedCopy('currency_differs')).toContain('different currency');
    expect(unsupportedCopy('no_stock')).toContain('Inventory');
  });

  it('lists the new store variants by title, falling back to the store id', () => {
    expect(
      newVariantsCopy([
        { providerVariantId: 'gid://1', title: 'Large' },
        { providerVariantId: 'gid://2', title: null },
      ]),
    ).toBe('Large, gid://2');
  });
});
