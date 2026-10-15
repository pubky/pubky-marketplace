import {
  COMMERCE_LISTING_DESCRIPTION_MAX_CHARS,
  COMMERCE_LISTING_MAX_OPTION_DIMENSIONS,
  COMMERCE_LISTING_MAX_QUANTITY,
  COMMERCE_LISTING_MAX_TAGS,
  COMMERCE_LISTING_TITLE_MAX_CHARS,
  COMMERCE_LISTING_TITLE_MIN_CHARS,
} from '@/config/commerce';
import type { ImportLoss } from './import-loss-report';
import { IMPORT_CONDITIONS_SET, type ImportSettings, shippingOptionRow } from './import-settings';

/** JSON-safe value carried in a canonical import row. */
export type PresetJson = string | number | boolean | null | PresetJson[] | { [key: string]: PresetJson };

/**
 * One canonical import row (one variant) as the shared plan step reads it.
 * Structurally the same as `CanonicalImportRow`; kept here so pipes do not
 * depend on the application layer.
 */
export type PresetRow = {
  readonly recordUri: string;
  readonly sellerPubky: string;
  readonly listingId: string;
  readonly sourceListingKey: string;
  readonly recordRevision: number | null;
  readonly variantId: string;
  readonly sku: string;
  readonly state: string;
  readonly title: string;
  readonly description: string;
  readonly taxonomy: PresetJson;
  readonly category: string;
  readonly condition: string;
  readonly tags: readonly string[];
  readonly amountMinor: number;
  readonly currency: string;
  readonly exponent: number;
  readonly variantQuantity: number;
  readonly variantEnabled: boolean;
  readonly options: Readonly<Record<string, string>>;
  readonly media: readonly PresetJson[];
  readonly shippingOptions: readonly PresetJson[];
  readonly returnPolicy: PresetJson;
  readonly sale: PresetJson;
  readonly externalRefs: PresetJson;
  readonly extraFields: Readonly<Record<string, string>>;
};

/**
 * Extra-field key that carries the source image URLs (a JSON array of
 * `{ url, alt }`) on every row of a listing, for the image-fetch step to load.
 */
export const SOURCE_IMAGE_URLS_FIELD = 'source_image_urls';
/** Extra-field key for a variant price that differs from the listing price (minor units). */
export const VARIANT_PRICE_MINOR_FIELD = 'variant_price_minor';
export const COUNTRY_CODE_FIELD = 'country_code';

export type SourceImage = { readonly url: string; readonly alt: string };

const ENTITY_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SKU_MAX_CHARS = 64;
const OPTION_NAME_MAX_CHARS = 40;
const OPTION_VALUE_MAX_CHARS = 80;
const TAG_MAX_CHARS = 40;

export function isEntityId(value: string): boolean {
  return ENTITY_ID.test(value);
}

/** A path-safe id from free text (a SKU or handle); empty when nothing usable remains. */
export function entityIdFrom(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 128);
}

function loss(
  code: string,
  severity: ImportLoss['severity'],
  source: string,
  detail: string,
  listing: string,
  line?: number,
): ImportLoss {
  return { code, severity, source, detail, listing, ...(line === undefined ? {} : { line }), count: 1 };
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

export function withSourceImages(
  extraFields: Readonly<Record<string, string>>,
  images: readonly SourceImage[],
): Record<string, string> {
  return images.length === 0
    ? { ...extraFields }
    : { ...extraFields, [SOURCE_IMAGE_URLS_FIELD]: JSON.stringify(images) };
}

export type FinalizeInput = {
  readonly rows: readonly PresetRow[];
  readonly settings: ImportSettings;
  /** Human label for a listing id, used in loss entries. */
  readonly labelFor: (listingId: string) => string;
  readonly lineFor: (listingId: string) => number | undefined;
};

export type FinalizeResult = {
  readonly rows: readonly PresetRow[];
  readonly losses: readonly ImportLoss[];
  readonly skippedListingIds: ReadonlySet<string>;
};

/**
 * The checks every preset needs before rows reach the shared planner, which
 * fails the whole file on a duplicate id or SKU. A listing that cannot be
 * imported is skipped and reported; the rest of the file goes ahead.
 */
export function finalizePresetRows(input: FinalizeInput): FinalizeResult {
  const { settings, labelFor, lineFor } = input;
  const groups = new Map<string, PresetRow[]>();
  for (const row of input.rows) {
    const group = groups.get(row.listingId) ?? [];
    group.push(row);
    groups.set(row.listingId, group);
  }

  const losses: ImportLoss[] = [];
  const skipped = new Set<string>();
  const kept: PresetRow[] = [];
  const skuOwner = new Map<string, string>();
  const shipping = settings.shipping ? [shippingOptionRow(settings.shipping, settings.currency) as PresetJson] : [];

  for (const [listingId, group] of groups) {
    const label = labelFor(listingId);
    const line = lineFor(listingId);
    const skip = (code: string, source: string, detail: string) => {
      skipped.add(listingId);
      losses.push(loss(code, 'skipped', source, detail, label, line));
    };

    if (!isEntityId(listingId)) {
      skip('identity_invalid', 'Handle', 'The id can only use letters, numbers, - and _.');
      continue;
    }
    const first = group[0] as PresetRow;
    const variantIds = group.map((row) => row.variantId);
    if (variantIds.some((id) => !isEntityId(id))) {
      skip('identity_invalid', 'SKU', 'A variant id can only use letters, numbers, - and _.');
      continue;
    }
    if (new Set(variantIds).size !== variantIds.length) {
      skip('variant_id_duplicate', 'SKU', 'Two variants share an id, so the listing cannot be told apart.');
      continue;
    }
    const clashing = group.find(
      (row) => row.sku !== '' && skuOwner.has(row.sku) && skuOwner.get(row.sku) !== listingId,
    );
    if (clashing) {
      skip('sku_duplicate', 'SKU', `SKU ${clashing.sku} is already used by another listing in this file.`);
      continue;
    }

    const title = first.title.trim();
    if (title.length < COMMERCE_LISTING_TITLE_MIN_CHARS) {
      skip('title_invalid', 'Name', `A title needs at least ${COMMERCE_LISTING_TITLE_MIN_CHARS} characters.`);
      continue;
    }
    const rowLosses: ImportLoss[] = [];
    const finalTitle = clip(title, COMMERCE_LISTING_TITLE_MAX_CHARS);
    if (finalTitle !== title) {
      rowLosses.push(
        loss(
          'title_truncated',
          'changed',
          'Name',
          `Shortened to ${COMMERCE_LISTING_TITLE_MAX_CHARS} characters.`,
          label,
          line,
        ),
      );
    }
    let description = first.description.trim();
    if (description === '') {
      description = finalTitle;
      rowLosses.push(
        loss('description_absent', 'changed', 'Description', 'No description, so the title is used.', label, line),
      );
    }
    const finalDescription = clip(description, COMMERCE_LISTING_DESCRIPTION_MAX_CHARS);
    if (finalDescription !== description) {
      rowLosses.push(
        loss(
          'description_truncated',
          'changed',
          'Description',
          `Shortened to ${COMMERCE_LISTING_DESCRIPTION_MAX_CHARS} characters.`,
          label,
          line,
        ),
      );
    }

    const seenTags = new Set<string>();
    const tags: string[] = [];
    let tagsLost = 0;
    for (const raw of first.tags) {
      const tag = raw.trim();
      const key = tag.toLowerCase();
      if (tag === '' || seenTags.has(key)) continue;
      seenTags.add(key);
      if (tag.length > TAG_MAX_CHARS || tags.length >= COMMERCE_LISTING_MAX_TAGS) {
        tagsLost += 1;
        continue;
      }
      tags.push(tag);
    }
    if (tagsLost > 0) {
      rowLosses.push(
        loss(
          'tags_truncated',
          'dropped',
          'Tags',
          `${tagsLost} tag${tagsLost === 1 ? '' : 's'} dropped (at most ${COMMERCE_LISTING_MAX_TAGS} tags, ${TAG_MAX_CHARS} characters each).`,
          label,
          line,
        ),
      );
    }

    let optionsClipped = false;
    const normalized = group.map((row) => {
      const entries = Object.entries(row.options);
      if (entries.length > COMMERCE_LISTING_MAX_OPTION_DIMENSIONS) optionsClipped = true;
      const options: Record<string, string> = {};
      for (const [name, value] of entries.slice(0, COMMERCE_LISTING_MAX_OPTION_DIMENSIONS)) {
        const key = clip(name.trim(), OPTION_NAME_MAX_CHARS);
        const text = clip(value.trim(), OPTION_VALUE_MAX_CHARS);
        if (key !== name.trim() || text !== value.trim()) optionsClipped = true;
        if (key !== '' && text !== '') options[key] = text;
      }
      return { row, options };
    });
    if (optionsClipped) {
      rowLosses.push(
        loss(
          'options_truncated',
          'dropped',
          'Attributes',
          `Options are limited to ${COMMERCE_LISTING_MAX_OPTION_DIMENSIONS} per variant, ${OPTION_NAME_MAX_CHARS}/${OPTION_VALUE_MAX_CHARS} characters.`,
          label,
          line,
        ),
      );
    }

    let capped = false;
    const quantities = normalized.map(({ row }) => {
      if (row.variantQuantity >= COMMERCE_LISTING_MAX_QUANTITY) {
        capped = true;
        return COMMERCE_LISTING_MAX_QUANTITY - 1;
      }
      return Math.max(0, Math.trunc(row.variantQuantity));
    });
    if (capped) {
      rowLosses.push(
        loss(
          'stock_capped',
          'changed',
          'Stock',
          'Stock was above the largest count a physical listing can hold.',
          label,
          line,
        ),
      );
    }

    let state = first.state;
    const hasStock = normalized.some(({ row }, index) => row.variantEnabled && (quantities[index] ?? 0) > 0);
    if (state === 'active' && !hasStock) {
      state = 'paused';
      rowLosses.push(
        loss(
          'no_stock_paused',
          'changed',
          'Stock',
          'No variant has stock, so the listing is paused. Set stock in Inventory to publish it.',
          label,
          line,
        ),
      );
    }

    const condition = IMPORT_CONDITIONS_SET.has(first.condition) ? first.condition : settings.condition;

    normalized.forEach(({ row, options }, index) => {
      let sku = row.sku;
      if (sku.length > SKU_MAX_CHARS) {
        sku = '';
        rowLosses.push(
          loss('sku_dropped', 'dropped', 'SKU', `A SKU can have at most ${SKU_MAX_CHARS} characters.`, label, line),
        );
      }
      if (sku !== '') skuOwner.set(sku, listingId);
      kept.push({
        ...row,
        sku,
        state,
        title: finalTitle,
        description: finalDescription,
        condition,
        tags,
        options,
        variantQuantity: quantities[index] ?? 0,
        shippingOptions: shipping,
        extraFields: settings.countryCode
          ? { ...row.extraFields, [COUNTRY_CODE_FIELD]: settings.countryCode }
          : { ...row.extraFields },
      });
    });
    losses.push(...rowLosses);
  }

  return { rows: kept, losses, skippedListingIds: skipped };
}
