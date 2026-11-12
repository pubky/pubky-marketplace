import type { CommerceListingRecord } from '@/libs/commerce/marketplace-records';

/**
 * Which parts of a listing follow a connected store. A part that follows is read-only in the editor, and
 * the saved record takes it from the published record, whatever the form holds.
 */
export type FollowedGroups = { readonly content: boolean; readonly price: boolean; readonly variants: boolean };

export const NO_FOLLOWED_GROUPS: FollowedGroups = { content: false, price: false, variants: false };

/** The fields the editor rebuilds from its form on every save. */
export type EditedListingFields = {
  readonly title: string;
  readonly description: string;
  readonly media: readonly unknown[];
  readonly variants: readonly Record<string, unknown>[];
  readonly sale: CommerceListingRecord['sale'];
};

function mediaIdsOf(media: readonly unknown[]): Set<unknown> {
  return new Set(media.map((entry) => (entry as { id?: unknown }).id));
}

/**
 * The edited fields with every followed part put back as the published record has it. The editor writes
 * its variants by position with new ids and every variant enabled; a listing whose variants follow the
 * store keeps its own variants (ids, options, SKU, which are enabled) and takes from the form only what
 * stays editable: stock, and the price override while price does not follow. A listing whose price follows
 * keeps its own price and price overrides, and the ids of its variants: a price is the store's price for one
 * store variant, which the connector links to a variant id, so the ids cannot be replaced while it follows.
 */
export function keepFollowedFields(
  record: CommerceListingRecord,
  edited: EditedListingFields,
  follows: FollowedGroups,
): EditedListingFields {
  const media = follows.content ? record.media : edited.media;
  const mediaIds = mediaIdsOf(media);

  let variants: readonly Record<string, unknown>[] = edited.variants;
  if (follows.variants) {
    variants = record.variants.map((own, index) => {
      const form = edited.variants[index];
      const next: Record<string, unknown> = { ...own, quantity: form?.quantity ?? own.quantity };
      if (!follows.price) {
        if (form?.priceOverride) next.priceOverride = form.priceOverride;
        else delete next.priceOverride;
      }
      next.mediaIds = own.mediaIds.filter((id) => mediaIds.has(id));
      return next;
    });
  } else {
    variants = edited.variants.map((form, index) => {
      const next: Record<string, unknown> = { ...form };
      const own = record.variants[index];
      if (follows.price) {
        if (own) next.id = own.id;
        if (own?.priceOverride) next.priceOverride = own.priceOverride;
        else delete next.priceOverride;
      }
      if (follows.content) next.mediaIds = [...mediaIds];
      return next;
    });
  }

  return {
    title: follows.content ? record.title : edited.title,
    description: follows.content ? record.description : edited.description,
    media,
    variants,
    sale: follows.price && record.sale.format === 'fixed_price' ? record.sale : edited.sale,
  };
}
