import type { ConnectorSyncGroup } from '@/libs/commerce/connectors';
import { formatCommerceMoney } from '@/libs/commerce/format';
import type { ChangeConflict, FieldChange, UnsupportedReason } from './connector-change-apply';

/**
 * The words the review uses for a store change: what it does to a listing, where the seller and the
 * store disagree, and why a change cannot be applied as it stands. Pure.
 */

export const SYNC_GROUP_LABELS: Readonly<Record<ConnectorSyncGroup, string>> = {
  content: 'Title, description and photos',
  price: 'Price',
  variants: 'Variants',
};

export const SYNC_GROUP_HELP: Readonly<Record<ConnectorSyncGroup, string>> = {
  content: 'Applied as soon as you open the Shop.',
  price: 'Waits for your approval.',
  variants: 'Waits for your approval.',
};

export const CHANGE_HEADLINES: Readonly<Record<'content' | 'price' | 'variants' | 'status', string>> = {
  content: 'Changed in your store: title, description or photos',
  price: 'Price changed in your store',
  variants: 'Variants changed in your store',
  status: 'Your store no longer sells this product, or sells it again',
};

const PREVIEW_CHARS = 80;

function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= PREVIEW_CHARS ? flat : `${flat.slice(0, PREVIEW_CHARS - 1).trimEnd()}…`;
}

function options(values: Readonly<Record<string, string>>): string {
  const text = Object.entries(values)
    .map(([name, value]) => `${name} ${value}`)
    .join(', ');
  return text === '' ? 'no options' : text;
}

function forVariant(label: string): string {
  return label === '' ? '' : ` (${label})`;
}

/** One line of what applying a change does. `variantName` is the listing variant's own label, or empty for a single variant. */
export function describeFieldChange(change: FieldChange, variantName: (variantId: string) => string): string {
  switch (change.kind) {
    case 'text':
      return change.field === 'title'
        ? `Title: "${preview(change.from)}" to "${preview(change.to)}"`
        : `Description: "${preview(change.from)}" to "${preview(change.to)}"`;
    case 'photos': {
      const parts = [
        change.added > 0 ? `${change.added} added` : null,
        change.removed > 0 ? `${change.removed} removed` : null,
        change.notAdded > 0 ? `${change.notAdded} not added, the listing holds as many photos as it can` : null,
      ].filter((part): part is string => part !== null);
      return `Photos: ${parts.join(', ')}`;
    }
    case 'price':
      return `Price${forVariant(variantName(change.variantId))}: ${formatCommerceMoney(change.from)} to ${formatCommerceMoney(change.to)}`;
    case 'status':
      return change.to === 'paused' ? 'Pause this listing so it stops selling' : 'Make this listing active again';
    case 'variant_off':
      return `Turn off ${variantName(change.variantId) || 'a variant'}, which your store no longer sells`;
    case 'variant_options':
      return `Options${forVariant(variantName(change.variantId))}: ${options(change.from)} to ${options(change.to)}`;
    case 'variant_sku':
      return `SKU${forVariant(variantName(change.variantId))}: ${change.from || 'none'} to ${change.to || 'none'}`;
  }
}

/** A field the seller and the store both changed, as two values to choose between. */
export function describeConflict(
  conflict: ChangeConflict,
  variantName: (variantId: string) => string,
): { readonly label: string; readonly yours: string; readonly store: string } {
  switch (conflict.kind) {
    case 'text':
      return {
        label: conflict.field === 'title' ? 'Title' : 'Description',
        yours: preview(conflict.yours),
        store: preview(conflict.store),
      };
    case 'price':
      return {
        label: `Price${forVariant(variantName(conflict.variantId))}`,
        yours: formatCommerceMoney(conflict.yours),
        store: formatCommerceMoney(conflict.store),
      };
    case 'variant_options':
      return {
        label: `Options${forVariant(variantName(conflict.variantId))}`,
        yours: options(conflict.yours),
        store: options(conflict.store),
      };
    case 'variant_sku':
      return {
        label: `SKU${forVariant(variantName(conflict.variantId))}`,
        yours: conflict.yours || 'none',
        store: conflict.store || 'none',
      };
  }
}

const UNSUPPORTED_COPY: Readonly<Record<UnsupportedReason, string>> = {
  title_invalid: 'The store title is too short for a listing. Dismiss this change.',
  no_photos: 'The store has no usable photo for this product, and a listing needs at least one. Dismiss this change.',
  photos_full:
    'The listing already holds as many photos as it can, so the new photos from your store were not added. Remove a photo in the editor, or dismiss this change.',
  auction_price: 'Auction prices are fixed once the auction is published, so the store price cannot be applied.',
  currency_differs:
    'The store prices this product in a different currency than the listing. Pubky does not convert prices, so change it by hand or dismiss this change.',
  price_scale:
    'The store price has more decimal places than the listing currency allows. Change it by hand or dismiss this change.',
  price_zero: 'The store price is zero, and a listing price must be above zero. Dismiss this change.',
  link_incomplete:
    'This listing is not fully linked to the store variants. Open Choose products to link it again, then try once more.',
  no_stock:
    'No variant has stock, so the listing cannot be made active. Add stock in Inventory first, or dismiss this change.',
  record_invalid: 'The listing cannot hold this change. Dismiss it, or change the listing by hand.',
};

export function unsupportedCopy(reason: UnsupportedReason): string {
  return UNSUPPORTED_COPY[reason];
}

/** The new store variants, as "Large, Medium". */
export function newVariantsCopy(
  variants: readonly { readonly providerVariantId: string; readonly title: string | null }[],
): string {
  return variants.map(({ title, providerVariantId }) => title?.trim() || providerVariantId).join(', ');
}
