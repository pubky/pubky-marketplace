import {
  COMMERCE_LISTING_DESCRIPTION_MAX_CHARS,
  COMMERCE_LISTING_MAX_IMAGES,
  COMMERCE_LISTING_MAX_OPTION_DIMENSIONS,
  COMMERCE_LISTING_TITLE_MAX_CHARS,
  COMMERCE_LISTING_TITLE_MIN_CHARS,
} from '@/config/commerce';
import type { ConnectorProductChange } from '@/libs/commerce/connectors';
import { type CommerceListingRecord, commerceListingRecordSchema } from '@/libs/commerce/marketplace-records';
import type { CommerceMoney } from '@/libs/commerce/transaction-contracts';
import { secureImageUrls, storeVariantOptions } from './connector-catalog-rows';
import { htmlToPlainText } from './import-html-text';
import {
  type ImageSyncPlan,
  IMPORT_SOURCE_HASH_KEY,
  type ImportImageTarget,
  planImageSync,
  sourceUrlHash,
} from './import-image-phase';
import {
  clip,
  OPTION_NAME_MAX_CHARS,
  OPTION_VALUE_MAX_CHARS,
  type PresetJson,
  SKU_MAX_CHARS,
} from './import-preset-rows';
import { rescaleMinor } from './import-settings';

/**
 * Applies one store change to one linked listing. Pure: no IO and no clock
 * (`now` comes in), so every outcome is decided here and the hook only carries
 * it out.
 *
 * The rule is three-way, per field. The service keeps `base` (what the store
 * held when the listing last followed it) and `proposed` (what it holds now);
 * the listing's own value is `current`.
 *
 * - `current` equals `proposed`: nothing to do for the field.
 * - `current` equals `base`: the seller has not touched it since, so the
 *   proposal applies.
 * - Otherwise both sides changed it: a conflict, and nothing moves until the
 *   seller picks a side. A change with no base cannot tell, so it conflicts
 *   too.
 *
 * Photos are a set, not a value: a photo the store added or removed is merged
 * into the listing's photos one by one, and a photo the seller removed stays
 * removed while the store still has it. Photos never conflict.
 */

export type ChangeLink = ConnectorProductChange['listings'][number]['variants'][number];

export type ListingPatch = {
  readonly title?: string;
  readonly description?: string;
  /** The photo merge to run; the media it leaves is passed to {@link applyListingPatch}. */
  readonly photos?: ImageSyncPlan;
  /** The price each variant of the listing ends up with, keyed by variant id (every variant, changed or not). */
  readonly prices?: Readonly<Record<string, CommerceMoney>>;
  readonly state?: 'active' | 'paused';
  readonly variants?: Readonly<Record<string, VariantPatch>>;
};

export type VariantPatch = {
  readonly enabled?: false;
  readonly options?: Readonly<Record<string, string>>;
  readonly sku?: string | null;
};

/** One line of what applying the change does, for the review to show. */
export type FieldChange =
  | { readonly kind: 'text'; readonly field: 'title' | 'description'; readonly from: string; readonly to: string }
  | {
      readonly kind: 'photos';
      readonly added: number;
      readonly removed: number;
      /** Store photos left out because the listing already holds as many as it can. */
      readonly notAdded: number;
    }
  | { readonly kind: 'price'; readonly variantId: string; readonly from: CommerceMoney; readonly to: CommerceMoney }
  | { readonly kind: 'status'; readonly from: CommerceListingRecord['state']; readonly to: 'active' | 'paused' }
  | { readonly kind: 'variant_off'; readonly variantId: string }
  | {
      readonly kind: 'variant_options';
      readonly variantId: string;
      readonly from: Readonly<Record<string, string>>;
      readonly to: Readonly<Record<string, string>>;
    }
  | { readonly kind: 'variant_sku'; readonly variantId: string; readonly from: string; readonly to: string };

/** A field the seller and the store both changed. */
export type ChangeConflict =
  | { readonly kind: 'text'; readonly field: 'title' | 'description'; readonly yours: string; readonly store: string }
  | { readonly kind: 'price'; readonly variantId: string; readonly yours: CommerceMoney; readonly store: CommerceMoney }
  | {
      readonly kind: 'variant_options';
      readonly variantId: string;
      readonly yours: Readonly<Record<string, string>>;
      readonly store: Readonly<Record<string, string>>;
    }
  | { readonly kind: 'variant_sku'; readonly variantId: string; readonly yours: string; readonly store: string };

export type UnsupportedReason =
  | 'title_invalid'
  | 'no_photos'
  | 'photos_full'
  | 'auction_price'
  | 'currency_differs'
  | 'price_scale'
  | 'price_zero'
  | 'link_incomplete'
  | 'no_stock'
  | 'record_invalid';

export type NewStoreVariant = { readonly providerVariantId: string; readonly title: string | null };

export type ChangeEvaluation =
  | { readonly kind: 'nothing_to_do' }
  | { readonly kind: 'apply'; readonly patch: ListingPatch; readonly changes: readonly FieldChange[] }
  | { readonly kind: 'conflict'; readonly conflicts: readonly ChangeConflict[] }
  | { readonly kind: 'needs_import'; readonly variants: readonly NewStoreVariant[] }
  | { readonly kind: 'unsupported'; readonly reason: UnsupportedReason };

export type EvaluateInput = {
  readonly change: ConnectorProductChange;
  readonly record: CommerceListingRecord;
  /** The listing's links to the product's store variants. */
  readonly links: readonly ChangeLink[];
  /** Every store variant of the product that some listing links to; a proposed variant outside it is new. */
  readonly linkedProviderVariantIds: ReadonlySet<string>;
  /** When the seller chose the store's side of a conflict: the proposal wins every field. */
  readonly takeStore?: boolean;
};

type Verdict = 'same' | 'apply' | 'conflict';

function decide<T>(
  current: T,
  base: T | null,
  proposed: T,
  takeStore: boolean,
  equal: (a: T, b: T) => boolean,
): Verdict {
  if (equal(current, proposed)) return 'same';
  if (takeStore) return 'apply';
  if (base !== null && equal(current, base)) return 'apply';
  return 'conflict';
}

const sameValue = <T>(a: T, b: T) => a === b;

function storeTitle(raw: string): string {
  return clip(raw.trim(), COMMERCE_LISTING_TITLE_MAX_CHARS);
}

/** The description the import writes for a store description: plain text, or the title when there is none. */
function storeDescription(raw: string | null, title: string): string {
  const text = htmlToPlainText(raw ?? '').trim();
  return clip(text === '' ? title : text, COMMERCE_LISTING_DESCRIPTION_MAX_CHARS);
}

function normalizedOptions(
  variantCount: number,
  optionValues: readonly { readonly name: string; readonly value: string }[],
): Record<string, string> {
  const options: Record<string, string> = {};
  const entries = Object.entries(storeVariantOptions(variantCount, optionValues)).slice(
    0,
    COMMERCE_LISTING_MAX_OPTION_DIMENSIONS,
  );
  for (const [name, value] of entries) {
    const key = clip(name.trim(), OPTION_NAME_MAX_CHARS);
    const text = clip(value.trim(), OPTION_VALUE_MAX_CHARS);
    if (key !== '' && text !== '') options[key] = text;
  }
  return options;
}

function sameOptions(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean {
  const left = Object.entries(a).sort(([x], [y]) => x.localeCompare(y));
  const right = Object.entries(b).sort(([x], [y]) => x.localeCompare(y));
  return (
    left.length === right.length &&
    left.every(([key, value], index) => right[index]?.[0] === key && right[index]?.[1] === value)
  );
}

function storeSku(raw: string | null): string {
  const sku = (raw ?? '').trim();
  return sku.length > SKU_MAX_CHARS ? '' : sku;
}

function mediaSourceHash(media: unknown): string | undefined {
  if (typeof media !== 'object' || media === null) return undefined;
  const value = (media as Record<string, unknown>)[IMPORT_SOURCE_HASH_KEY];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function unsupported(reason: UnsupportedReason): ChangeEvaluation {
  return { kind: 'unsupported', reason };
}

function effectivePrice(record: CommerceListingRecord, variantId: string): CommerceMoney | null {
  if (record.sale.format !== 'fixed_price') return null;
  const variant = record.variants.find(({ id }) => id === variantId);
  return variant?.priceOverride ?? record.sale.unitPrice;
}

/**
 * The links that name a variant the listing still has. Links the listing cannot use (a blank store or listing
 * variant id, or only links to variants the seller deleted) mean the change cannot be told apart from "nothing
 * to do", so they are refused instead of read as an empty change.
 */
function resolvableLinks(record: CommerceListingRecord, links: readonly ChangeLink[]): readonly ChangeLink[] | null {
  if (links.some(({ variantId, providerVariantId }) => variantId === '' || providerVariantId === '')) return null;
  const usable = links.filter(({ variantId }) => record.variants.some(({ id }) => id === variantId));
  return links.length > 0 && usable.length === 0 ? null : usable;
}

function hasStock(variants: CommerceListingRecord['variants']): boolean {
  return variants.some(({ enabled, quantity }) => enabled && quantity > 0);
}

type ContentChange = Extract<ConnectorProductChange, { fieldGroup: 'content' }>;
type PriceChange = Extract<ConnectorProductChange, { fieldGroup: 'price' }>;
type VariantsChange = Extract<ConnectorProductChange, { fieldGroup: 'variants' }>;
type StatusChange = Extract<ConnectorProductChange, { fieldGroup: 'status' }>;

function evaluateContent(change: ContentChange, record: CommerceListingRecord, takeStore: boolean): ChangeEvaluation {
  const { base, proposed } = change;
  const changes: FieldChange[] = [];
  const conflicts: ChangeConflict[] = [];
  let patch: ListingPatch = {};

  const title = storeTitle(proposed.title);
  if (title.length < COMMERCE_LISTING_TITLE_MIN_CHARS) return unsupported('title_invalid');
  const baseTitle = base ? storeTitle(base.title) : null;
  const titleVerdict = decide(record.title, baseTitle, title, takeStore, sameValue);
  if (titleVerdict === 'apply') {
    patch = { ...patch, title };
    changes.push({ kind: 'text', field: 'title', from: record.title, to: title });
  } else if (titleVerdict === 'conflict') {
    conflicts.push({ kind: 'text', field: 'title', yours: record.title, store: title });
  }

  if (proposed.description !== null) {
    const description = storeDescription(proposed.description, title);
    const baseDescription = base ? storeDescription(base.description, baseTitle ?? '') : null;
    const verdict = decide(record.description, baseDescription, description, takeStore, sameValue);
    if (verdict === 'apply') {
      patch = { ...patch, description };
      changes.push({ kind: 'text', field: 'description', from: record.description, to: description });
    } else if (verdict === 'conflict') {
      conflicts.push({ kind: 'text', field: 'description', yours: record.description, store: description });
    }
  }

  const proposedUrls = secureImageUrls(proposed.imageUrls).valid.slice(0, COMMERCE_LISTING_MAX_IMAGES);
  const baseHashes = base ? new Set(secureImageUrls(base.imageUrls).valid.map(sourceUrlHash)) : null;
  const currentHashes = new Set(record.media.map(mediaSourceHash).filter((hash): hash is string => hash !== undefined));
  const wanted = takeStore
    ? proposedUrls
    : proposedUrls.filter((url) => {
        const hash = sourceUrlHash(url);
        return !(baseHashes?.has(hash) && !currentHashes.has(hash));
      });
  const videoCount = record.media.filter(({ type }) => type === 'video').length;
  const plan = planImageSync(
    record.media,
    wanted.map((url) => ({ url, alt: title })),
    COMMERCE_LISTING_MAX_IMAGES + videoCount,
  );
  const keepsAnImage = plan.keptMedia.some((entry) => (entry as { type?: unknown }).type === 'image');
  if (plan.toUpload.length > 0 || plan.removed > 0) {
    if (!keepsAnImage && plan.toUpload.length === 0) return unsupported('no_photos');
    patch = { ...patch, photos: plan };
    changes.push({
      kind: 'photos',
      added: plan.toUpload.length,
      removed: plan.removed,
      notAdded: plan.overflow.length,
    });
  } else if (plan.overflow.length > 0) {
    if (changes.length === 0 && conflicts.length === 0) return unsupported('photos_full');
    changes.push({ kind: 'photos', added: 0, removed: 0, notAdded: plan.overflow.length });
  }

  if (conflicts.length > 0) return { kind: 'conflict', conflicts };
  return changes.length > 0 ? { kind: 'apply', patch, changes } : { kind: 'nothing_to_do' };
}

function evaluatePrice(
  change: PriceChange,
  record: CommerceListingRecord,
  links: readonly ChangeLink[],
  takeStore: boolean,
): ChangeEvaluation {
  if (record.sale.format !== 'fixed_price') return unsupported('auction_price');
  const usable = resolvableLinks(record, links);
  if (usable === null) return unsupported('link_incomplete');
  const { currency, exponent } = record.sale.unitPrice;
  const proposedByVariant = new Map(change.proposed.variants.map((entry) => [entry.providerVariantId, entry]));
  const baseByVariant = new Map((change.base?.variants ?? []).map((entry) => [entry.providerVariantId, entry]));

  const changes: FieldChange[] = [];
  const conflicts: ChangeConflict[] = [];
  const next = new Map<string, number>();

  for (const link of usable) {
    const proposed = proposedByVariant.get(link.providerVariantId);
    const current = effectivePrice(record, link.variantId);
    if (!proposed || !current) continue;
    if (proposed.currency !== currency) return unsupported('currency_differs');
    const proposedMinor = rescaleMinor(proposed.amountMinor, proposed.exponent, exponent);
    if (proposedMinor === null) return unsupported('price_scale');
    if (proposedMinor <= 0) return unsupported('price_zero');
    const baseEntry = baseByVariant.get(link.providerVariantId);
    const baseMinor =
      baseEntry && baseEntry.currency === currency
        ? rescaleMinor(baseEntry.amountMinor, baseEntry.exponent, exponent)
        : null;
    const verdict = decide(current.amountMinor, baseMinor, proposedMinor, takeStore, sameValue);
    const to = { amountMinor: proposedMinor, currency, exponent };
    if (verdict === 'apply') {
      next.set(link.variantId, proposedMinor);
      changes.push({ kind: 'price', variantId: link.variantId, from: current, to });
    } else if (verdict === 'conflict') {
      conflicts.push({ kind: 'price', variantId: link.variantId, yours: current, store: to });
    }
  }

  if (conflicts.length > 0) return { kind: 'conflict', conflicts };
  if (changes.length === 0) return { kind: 'nothing_to_do' };
  const prices: Record<string, CommerceMoney> = {};
  for (const variant of record.variants) {
    const amountMinor = next.get(variant.id) ?? (variant.priceOverride ?? record.sale.unitPrice).amountMinor;
    prices[variant.id] = { amountMinor, currency, exponent };
  }
  return { kind: 'apply', patch: { prices }, changes };
}

function evaluateStatus(change: StatusChange, record: CommerceListingRecord): ChangeEvaluation {
  if (!change.proposed.available) {
    return record.state === 'active'
      ? {
          kind: 'apply',
          patch: { state: 'paused' },
          changes: [{ kind: 'status', from: record.state, to: 'paused' }],
        }
      : { kind: 'nothing_to_do' };
  }
  if (record.state !== 'paused') return { kind: 'nothing_to_do' };
  if (!hasStock(record.variants)) return unsupported('no_stock');
  return {
    kind: 'apply',
    patch: { state: 'active' },
    changes: [{ kind: 'status', from: record.state, to: 'active' }],
  };
}

function evaluateVariants(
  change: VariantsChange,
  record: CommerceListingRecord,
  links: readonly ChangeLink[],
  linkedProviderVariantIds: ReadonlySet<string>,
  takeStore: boolean,
): ChangeEvaluation {
  const knownToStore = new Set((change.base?.variants ?? []).map(({ providerVariantId }) => providerVariantId));
  const added = change.proposed.variants.filter(
    ({ providerVariantId }) => !linkedProviderVariantIds.has(providerVariantId) && !knownToStore.has(providerVariantId),
  );
  if (added.length > 0) {
    return {
      kind: 'needs_import',
      variants: added.map(({ providerVariantId, title }) => ({ providerVariantId, title })),
    };
  }
  const usable = resolvableLinks(record, links);
  if (usable === null) return unsupported('link_incomplete');

  const proposedByVariant = new Map(change.proposed.variants.map((entry) => [entry.providerVariantId, entry]));
  const baseByVariant = new Map((change.base?.variants ?? []).map((entry) => [entry.providerVariantId, entry]));
  const changes: FieldChange[] = [];
  const conflicts: ChangeConflict[] = [];
  const variants: Record<string, VariantPatch> = {};
  const remaining = new Set(record.variants.filter(({ enabled }) => enabled).map(({ id }) => id));

  for (const link of usable) {
    const variant = record.variants.find(({ id }) => id === link.variantId);
    if (!variant) continue;
    const proposed = proposedByVariant.get(link.providerVariantId);
    if (!proposed) {
      if (variant.enabled) {
        variants[variant.id] = { enabled: false };
        remaining.delete(variant.id);
        changes.push({ kind: 'variant_off', variantId: variant.id });
      }
      continue;
    }
    const proposedOptions = normalizedOptions(change.proposed.variants.length, proposed.optionValues);
    const baseEntry = baseByVariant.get(link.providerVariantId);
    const baseOptions = baseEntry ? normalizedOptions(change.base?.variants.length ?? 0, baseEntry.optionValues) : null;
    const optionsVerdict = decide(variant.options, baseOptions, proposedOptions, takeStore, sameOptions);
    let patch: VariantPatch = variants[variant.id] ?? {};
    if (optionsVerdict === 'apply') {
      patch = { ...patch, options: proposedOptions };
      changes.push({ kind: 'variant_options', variantId: variant.id, from: variant.options, to: proposedOptions });
    } else if (optionsVerdict === 'conflict') {
      conflicts.push({
        kind: 'variant_options',
        variantId: variant.id,
        yours: variant.options,
        store: proposedOptions,
      });
    }
    const proposedSku = storeSku(proposed.sku);
    const baseSku = baseEntry ? storeSku(baseEntry.sku) : null;
    const currentSku = variant.sku ?? '';
    const skuVerdict = decide(currentSku, baseSku, proposedSku, takeStore, sameValue);
    if (skuVerdict === 'apply') {
      patch = { ...patch, sku: proposedSku === '' ? null : proposedSku };
      changes.push({ kind: 'variant_sku', variantId: variant.id, from: currentSku, to: proposedSku });
    } else if (skuVerdict === 'conflict') {
      conflicts.push({ kind: 'variant_sku', variantId: variant.id, yours: currentSku, store: proposedSku });
    }
    if (Object.keys(patch).length > 0) variants[variant.id] = patch;
  }

  if (conflicts.length > 0) return { kind: 'conflict', conflicts };
  if (changes.length === 0) return { kind: 'nothing_to_do' };
  const left = record.variants.filter(({ id }) => remaining.has(id));
  const pauses = record.state === 'active' && !hasStock(left);
  if (pauses) changes.push({ kind: 'status', from: record.state, to: 'paused' });
  return { kind: 'apply', patch: { variants, ...(pauses ? { state: 'paused' as const } : {}) }, changes };
}

/** What applying the change to this listing does, or why it cannot be applied as it stands. */
export function evaluateChange(input: EvaluateInput): ChangeEvaluation {
  const { change, record, links, linkedProviderVariantIds } = input;
  const takeStore = input.takeStore === true;
  switch (change.fieldGroup) {
    case 'content':
      return evaluateContent(change, record, takeStore);
    case 'price':
      return evaluatePrice(change, record, links, takeStore);
    case 'status':
      return evaluateStatus(change, record);
    case 'variants':
      return evaluateVariants(change, record, links, linkedProviderVariantIds, takeStore);
  }
}

export type ApplyOutcome =
  | { readonly ok: true; readonly record: CommerceListingRecord }
  | { readonly ok: false; readonly reason: 'record_invalid' };

/**
 * The listing with the patch applied: the next revision, stamped `now`. `media` is the photo list the
 * patch's photo merge ended with (kept photos, then the uploaded ones); without a photo merge the
 * listing keeps its own. The result is checked against the record schema, so a change that would make
 * the listing invalid (a duplicate SKU, no photo, no stock on an active listing) is refused here.
 */
export function applyListingPatch(
  record: CommerceListingRecord,
  patch: ListingPatch,
  options: { readonly now: string; readonly media?: readonly PresetJson[] },
): ApplyOutcome {
  const media = patch.photos ? (options.media ?? patch.photos.keptMedia) : record.media;
  const mediaIds = new Set(media.map((entry) => (entry as { id?: unknown }).id));

  let variants: CommerceListingRecord['variants'] = record.variants.map((variant) => {
    const edit = patch.variants?.[variant.id];
    const next: CommerceListingRecord['variants'][number] = {
      ...variant,
      options: edit?.options ?? variant.options,
      enabled: edit?.enabled ?? variant.enabled,
      mediaIds: variant.mediaIds.filter((id) => mediaIds.has(id)),
    };
    if (edit && 'sku' in edit) {
      if (edit.sku) next.sku = edit.sku;
      else delete next.sku;
    }
    return next;
  });

  let sale = record.sale;
  const turnsAVariantOff = Object.values(patch.variants ?? {}).some((edit) => edit.enabled === false);
  if ((patch.prices || turnsAVariantOff) && record.sale.format === 'fixed_price') {
    const { currency, exponent, amountMinor: listingMinor } = record.sale.unitPrice;
    const wanted = (id: string) =>
      patch.prices?.[id]?.amountMinor ??
      record.variants.find((variant) => variant.id === id)?.priceOverride?.amountMinor ??
      listingMinor;
    const live = variants.filter(({ enabled }) => enabled);
    const unit = Math.min(...(live.length > 0 ? live : variants).map(({ id }) => wanted(id)));
    sale = { ...record.sale, unitPrice: { amountMinor: unit, currency, exponent } };
    variants = variants.map((variant) => {
      const next = { ...variant };
      const amountMinor = wanted(variant.id);
      if (amountMinor === unit) delete next.priceOverride;
      else next.priceOverride = { amountMinor, currency, exponent };
      return next;
    });
  }

  const parsed = commerceListingRecordSchema.safeParse({
    ...record,
    revision: record.revision + 1,
    updatedAt: options.now,
    title: patch.title ?? record.title,
    description: patch.description ?? record.description,
    state: patch.state ?? record.state,
    media,
    variants,
    sale,
  });
  return parsed.success ? { ok: true, record: parsed.data } : { ok: false, reason: 'record_invalid' };
}

/** The photo phase's work for a listing's photo merge: the photos to fetch and upload, and the media it keeps. */
export function photoTarget(listingId: string, plan: ImageSyncPlan): ImportImageTarget {
  return { listingId, images: plan.toUpload, skipped: plan.overflow, keptMedia: plan.keptMedia };
}

export type ListingVerdict = {
  readonly listingId: string;
  readonly evaluation:
    | ChangeEvaluation
    | { readonly kind: 'skipped'; readonly why: 'direction_off' | 'listing_missing' };
};

export type ChangeState = 'nothing_to_do' | 'applicable' | 'conflict' | 'needs_import' | 'unsupported';

/** The one state a change shows: a conflict or a new variant blocks it, then what cannot be applied, then what can. */
export function changeState(verdicts: readonly ListingVerdict[]): ChangeState {
  const kinds = new Set(verdicts.map(({ evaluation }) => evaluation.kind));
  if (kinds.has('conflict')) return 'conflict';
  if (kinds.has('needs_import')) return 'needs_import';
  if (kinds.has('unsupported')) return 'unsupported';
  if (kinds.has('apply')) return 'applicable';
  return 'nothing_to_do';
}

/**
 * Whether the Shop applies the change as soon as it opens, without a tap: store text and photos, and
 * a product the store no longer sells. A price, a variant change and making a listing active again
 * wait for the seller.
 */
export function isAutoApplied(change: Pick<ConnectorProductChange, 'fieldGroup' | 'proposed'>): boolean {
  if (change.fieldGroup === 'content') return true;
  return change.fieldGroup === 'status' && 'available' in change.proposed && change.proposed.available === false;
}

/** Evaluates a change for each listing it names, given the listings as they stand now. */
export function evaluateChangeListings(
  change: ConnectorProductChange,
  records: ReadonlyMap<string, CommerceListingRecord | null>,
  takeStore = false,
): ListingVerdict[] {
  const linkedProviderVariantIds = new Set(
    change.listings.flatMap(({ variants }) => variants.map(({ providerVariantId }) => providerVariantId)),
  );
  return change.listings.map((listing) => {
    if (listing.direction === 'off') {
      return { listingId: listing.listingId, evaluation: { kind: 'skipped', why: 'direction_off' } };
    }
    const record = records.get(listing.listingId);
    if (!record) return { listingId: listing.listingId, evaluation: { kind: 'skipped', why: 'listing_missing' } };
    return {
      listingId: listing.listingId,
      evaluation: evaluateChange({ change, record, links: listing.variants, linkedProviderVariantIds, takeStore }),
    };
  });
}
