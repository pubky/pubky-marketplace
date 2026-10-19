import type {
  ConnectorCatalogProduct,
  ConnectorCatalogVariant,
  ConnectorMapping,
  VariantMode,
} from '@/libs/commerce/connectors';
import { commerceListingFulfillmentMethods, type CommerceListingRecord } from '@/libs/commerce/marketplace-records';

/**
 * Which of the seller's own listings (made by hand, or imported from a CSV)
 * belong to a product of their connected store, so the store's stock reaches
 * them and their orders reach the store. Pure: no IO, no clock.
 *
 * A listing links when it can be linked without guessing:
 *
 * - **SKU**: every offered variant's SKU names exactly one variant in the
 *   store, and no other unlinked listing uses the same SKU;
 * - otherwise **handle**: the listing id is a store product's handle (a
 *   Shopify product CSV import uses the handle as the listing id) and each
 *   offered variant matches exactly one of that product's variants, by SKU,
 *   by its option values or by its title, or both sides sell one variant.
 *
 * A store variant another listing is already linked to is never offered
 * again. Anything else is left for the seller to match by hand.
 */

export type LinkableListingVariant = {
  readonly id: string;
  readonly sku?: string | null;
  readonly options: Readonly<Record<string, string>>;
  readonly enabled: boolean;
};

export type LinkableListing = {
  readonly listingId: string;
  readonly title: string;
  readonly variants: readonly LinkableListingVariant[];
};

export type ListingLinkBasis = 'sku' | 'handle' | 'manual';

export type ListingLinkSuggestion = {
  readonly listingId: string;
  readonly title: string;
  readonly basis: ListingLinkBasis;
  readonly providerProductId: string;
  readonly productTitle: string;
  readonly mappings: readonly ConnectorMapping[];
};

export type UnlinkedReason =
  /** No store product matches by SKU or handle. */
  | 'no_match'
  /** A SKU names several store variants, or several listings use it. */
  | 'ambiguous'
  /** Some variants match a store product and others do not. */
  | 'partial'
  /** One listing per variant (`split`) cannot take a listing with several sizes. */
  | 'split_multi_variant';

export type UnlinkedListing = {
  readonly listingId: string;
  readonly title: string;
  readonly reason: UnlinkedReason;
};

export type ListingLinkPlan = {
  /** Listings that link without guessing, with the mappings to write. */
  readonly suggestions: readonly ListingLinkSuggestion[];
  /** Listings the seller links by hand (or leaves Pubky-only). */
  readonly unlinked: readonly UnlinkedListing[];
};

export type ListingLinkInput = {
  readonly listings: readonly LinkableListing[];
  readonly products: readonly ConnectorCatalogProduct[];
  /** The connection's current mappings: their listings are linked and their store variants are taken. */
  readonly mappings: readonly ConnectorMapping[];
  readonly variantMode?: VariantMode;
};

type StoreVariant = { readonly product: ConnectorCatalogProduct; readonly variant: ConnectorCatalogVariant };

function normalizedSku(sku: string | null | undefined): string | null {
  const trimmed = sku?.trim().toLowerCase() ?? '';
  return trimmed === '' ? null : trimmed;
}

function normalizedValues(values: readonly string[]): string {
  return values
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value !== '')
    .sort()
    .join('\u0000');
}

/** A store variant's choice: its option values, else its title split on " / ", ignoring Shopify's "Default Title". */
function storeChoice(variant: ConnectorCatalogVariant): string {
  const values = variant.optionValues
    .filter(({ name, value }) => !(name === 'Title' && value === 'Default Title'))
    .map(({ value }) => value);
  if (values.length > 0) return normalizedValues(values);
  const title = variant.title?.trim() ?? '';
  return title === '' || title === 'Default Title' ? '' : normalizedValues(title.split(' / '));
}

function variantKey(product: ConnectorCatalogProduct, variant: ConnectorCatalogVariant): string {
  return `${product.providerProductId}\u0000${variant.providerVariantId}`;
}

function mappingFor(listingId: string, listingVariant: LinkableListingVariant, store: StoreVariant): ConnectorMapping {
  const sku = store.variant.sku?.trim() || listingVariant.sku?.trim() || '';
  return {
    listingId,
    variantId: listingVariant.id,
    providerProductId: store.product.providerProductId,
    providerVariantId: store.variant.providerVariantId,
    ...(sku ? { sku } : {}),
  };
}

/**
 * The store variants of one product each offered listing variant matches, or
 * `null` when any of them matches none or several. Used for a handle match and
 * when the seller picks the product by hand.
 */
export function matchListingVariants(
  listing: LinkableListing,
  product: ConnectorCatalogProduct,
  taken: ReadonlySet<string> = new Set(),
): readonly ConnectorMapping[] | null {
  const offered = listing.variants.filter((variant) => variant.enabled);
  const free = product.variants.filter((variant) => !taken.has(variantKey(product, variant)));
  if (offered.length === 0 || free.length === 0) return null;
  if (offered.length === 1 && free.length === 1 && product.variants.length === 1) {
    const [only] = offered;
    const [store] = free;
    return only && store ? [mappingFor(listing.listingId, only, { product, variant: store })] : null;
  }
  const used = new Set<string>();
  const mappings: ConnectorMapping[] = [];
  for (const listingVariant of offered) {
    const sku = normalizedSku(listingVariant.sku);
    const choice = normalizedValues(Object.values(listingVariant.options));
    const bySku = sku ? free.filter((variant) => normalizedSku(variant.sku) === sku) : [];
    const candidates =
      bySku.length > 0 ? bySku : choice === '' ? [] : free.filter((variant) => storeChoice(variant) === choice);
    if (candidates.length !== 1) return null;
    const [store] = candidates;
    if (!store) return null;
    const key = variantKey(product, store);
    if (used.has(key)) return null;
    used.add(key);
    mappings.push(mappingFor(listing.listingId, listingVariant, { product, variant: store }));
  }
  return mappings;
}

export function planListingLinks(input: ListingLinkInput): ListingLinkPlan {
  const split = input.variantMode === 'split';
  const linkedListings = new Set(input.mappings.map((mapping) => mapping.listingId));
  const taken = new Set(
    input.mappings.map((mapping) => `${mapping.providerProductId}\u0000${mapping.providerVariantId ?? ''}`),
  );
  const unlinkedListings = input.listings.filter((listing) => !linkedListings.has(listing.listingId));

  const storeBySku = new Map<string, StoreVariant[]>();
  for (const product of input.products) {
    for (const variant of product.variants) {
      if (taken.has(variantKey(product, variant))) continue;
      const sku = normalizedSku(variant.sku);
      if (!sku) continue;
      storeBySku.set(sku, [...(storeBySku.get(sku) ?? []), { product, variant }]);
    }
  }
  const listingSkuUse = new Map<string, number>();
  for (const listing of unlinkedListings) {
    for (const variant of listing.variants) {
      const sku = normalizedSku(variant.sku);
      if (variant.enabled && sku) listingSkuUse.set(sku, (listingSkuUse.get(sku) ?? 0) + 1);
    }
  }
  const productByHandle = new Map<string, ConnectorCatalogProduct[]>();
  for (const product of input.products) {
    const handle = product.handle?.trim().toLowerCase();
    if (handle) productByHandle.set(handle, [...(productByHandle.get(handle) ?? []), product]);
  }

  const suggestions: ListingLinkSuggestion[] = [];
  const unlinked: UnlinkedListing[] = [];
  const claimed = new Set<string>();

  for (const listing of unlinkedListings) {
    const offered = listing.variants.filter((variant) => variant.enabled);
    if (offered.length === 0) continue;
    if (split && offered.length > 1) {
      unlinked.push({ listingId: listing.listingId, title: listing.title, reason: 'split_multi_variant' });
      continue;
    }

    let skuMatched = 0;
    let skuAmbiguous = false;
    const skuStores: StoreVariant[] = [];
    for (const variant of offered) {
      const sku = normalizedSku(variant.sku);
      const matches = sku ? (storeBySku.get(sku) ?? []) : [];
      if (matches.length === 1 && (listingSkuUse.get(sku ?? '') ?? 0) === 1) {
        skuMatched += 1;
        const [match] = matches;
        if (match) skuStores.push(match);
      } else if (matches.length > 1 || (sku && (listingSkuUse.get(sku) ?? 0) > 1 && matches.length > 0)) {
        skuAmbiguous = true;
      }
    }
    const skuProducts = new Set(skuStores.map(({ product }) => product.providerProductId));
    const skuKeys = skuStores.map(({ product, variant }) => variantKey(product, variant));
    if (
      skuMatched === offered.length &&
      skuProducts.size === 1 &&
      new Set(skuKeys).size === skuKeys.length &&
      !skuKeys.some((key) => claimed.has(key))
    ) {
      const [first] = skuStores;
      if (first) {
        skuKeys.forEach((key) => claimed.add(key));
        suggestions.push({
          listingId: listing.listingId,
          title: listing.title,
          basis: 'sku',
          providerProductId: first.product.providerProductId,
          productTitle: first.product.title,
          mappings: offered.map((variant, index) => {
            const store = skuStores[index] ?? first;
            return mappingFor(listing.listingId, variant, store);
          }),
        });
        continue;
      }
    }

    const handled = productByHandle.get(listing.listingId.trim().toLowerCase()) ?? [];
    if (handled.length === 1 && !skuAmbiguous) {
      const [product] = handled;
      const mappings = product ? matchListingVariants(listing, product, new Set([...taken, ...claimed])) : null;
      if (product && mappings) {
        mappings.forEach((mapping) =>
          claimed.add(`${mapping.providerProductId}\u0000${mapping.providerVariantId ?? ''}`),
        );
        suggestions.push({
          listingId: listing.listingId,
          title: listing.title,
          basis: 'handle',
          providerProductId: product.providerProductId,
          productTitle: product.title,
          mappings,
        });
        continue;
      }
    }

    unlinked.push({
      listingId: listing.listingId,
      title: listing.title,
      reason: skuAmbiguous ? 'ambiguous' : skuMatched > 0 || handled.length > 0 ? 'partial' : 'no_match',
    });
  }
  return { suggestions, unlinked };
}

const UNLINKED_REASON_COPY: Readonly<Record<UnlinkedReason, string>> = {
  no_match: 'No product in your store has the same SKU or handle.',
  ambiguous: 'Its SKU matches more than one product, or more than one listing uses it.',
  partial: 'Some of its variants match a product in your store and some do not.',
  split_multi_variant:
    'This connection makes one listing per size or variant, and this listing has several. Import the product from your store instead.',
};

export function unlinkedReasonCopy(reason: UnlinkedReason): string {
  return UNLINKED_REASON_COPY[reason];
}

/**
 * The seller's listings a store can fulfil: live (active or paused), fixed
 * price, and shipped or picked up (a digital-only listing has nothing for a
 * store to send).
 */
export function linkableListingsFrom(
  listings: readonly { readonly listing_id: string; readonly record: CommerceListingRecord }[],
): LinkableListing[] {
  return listings
    .filter(({ record }) => {
      if (record.state !== 'active' && record.state !== 'paused') return false;
      if (record.sale.format !== 'fixed_price') return false;
      return commerceListingFulfillmentMethods(record.fulfillmentMethods).some((method) => method !== 'digital');
    })
    .map(({ listing_id, record }) => ({
      listingId: listing_id,
      title: record.title,
      variants: record.variants.map((variant) => ({
        id: variant.id,
        sku: variant.sku ?? null,
        options: variant.options,
        enabled: variant.enabled,
      })),
    }));
}

/**
 * The store variant each offered listing variant would link to in `product`
 * when the seller picks it by hand: the unambiguous match (SKU, options or
 * title, or the one variant), else `null` for the seller to choose.
 */
export function variantPicks(
  listing: LinkableListing,
  product: ConnectorCatalogProduct,
): Readonly<Record<string, string | null>> {
  const picks: Record<string, string | null> = {};
  const offered = listing.variants.filter((variant) => variant.enabled);
  const whole = matchListingVariants(listing, product);
  for (const variant of offered) {
    const matched = whole?.find((mapping) => mapping.variantId === variant.id);
    if (matched) {
      picks[variant.id] = matched.providerVariantId ?? null;
      continue;
    }
    const alone = matchListingVariants({ ...listing, variants: [variant] }, product);
    picks[variant.id] = alone?.[0]?.providerVariantId ?? null;
  }
  return picks;
}

/** The mappings for a hand-made link, or `null` while a variant has no store variant or two share one. */
export function mappingsFromPicks(
  listing: LinkableListing,
  product: ConnectorCatalogProduct,
  picks: Readonly<Record<string, string | null>>,
): ConnectorMapping[] | null {
  const offered = listing.variants.filter((variant) => variant.enabled);
  const chosen = offered.map((variant) => picks[variant.id] ?? null);
  if (offered.length === 0 || chosen.some((pick) => pick === null)) return null;
  if (new Set(chosen).size !== chosen.length) return null;
  const mappings: ConnectorMapping[] = [];
  for (const variant of offered) {
    const store = product.variants.find((candidate) => candidate.providerVariantId === picks[variant.id]);
    if (!store) return null;
    mappings.push(mappingFor(listing.listingId, variant, { product, variant: store }));
  }
  return mappings;
}
