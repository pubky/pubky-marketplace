import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import {
  COMMERCE_LISTING_MAX_IMAGES,
  COMMERCE_LISTING_MAX_QUANTITY,
  COMMERCE_LISTING_MAX_VARIANTS,
} from '@/config/commerce';
import { IMPORT_IMAGE_MAX_COUNT } from '@/config/import-image';
import type { StoreApiProduct } from '@/pipes/import-store/import-store.product';
import { htmlToPlainText } from './import-html-text';
import type { ImportLoss, ImportLossReport } from './import-loss-report';
import {
  entityIdFrom,
  finalizePresetRows,
  type PresetRow,
  SOURCE_IMAGE_URLS_FIELD,
  type SourceImage,
  VARIANT_PRICE_MINOR_FIELD,
  withSourceImages,
} from './import-preset-rows';
import { currencyExponent, type ImportSettings, rescaleMinor } from './import-settings';

/**
 * A WooCommerce store's public Store API catalogue to canonical import rows.
 * Pure: the products and variation reads the server route fetched go in, rows
 * and a loss report come out. The same rows the CSV presets produce, so the
 * plan, dry run and publish steps do not know the difference.
 */

export type WooStoreCatalog = {
  /** The store's base address as the import read it, e.g. `https://myshop.com`; keys listing ids. */
  readonly storeUrl: string;
  readonly products: readonly StoreApiProduct[];
  /** Variation reads (`/products/{id}`) by parent product id. */
  readonly variations: Readonly<Record<string, readonly StoreApiProduct[]>>;
  /** Products the pages listed that could not be read. */
  readonly unreadProducts: number;
  /** The store's own product count (`X-WP-Total`), when it said. */
  readonly total: number | null;
};

export type WooStoreMapInput = {
  readonly catalog: WooStoreCatalog;
  readonly sellerPubky: string;
  readonly settings: ImportSettings;
  /** The currencies a listing can be priced in; the store's currency must be one of them. */
  readonly offeredCurrencies: readonly string[];
};

export type WooStoreMapResult =
  | { readonly ok: true; readonly rows: readonly PresetRow[]; readonly report: ImportLossReport }
  | { readonly ok: false; readonly message: string };

/** A short, stable key for one store, so two stores' product ids cannot meet in one seller's listings. */
export function storeIdKey(storeUrl: string): string {
  return bytesToHex(blake3(utf8ToBytes(storeUrl.trim().toLowerCase()))).slice(0, 8);
}

/** The store's own currency: the one most of its priced products use. */
export function storeCurrency(products: readonly StoreApiProduct[]): string | null {
  const counts = new Map<string, number>();
  for (const product of products) {
    const code = product.prices?.currency_code;
    if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [code, count] of counts) if (best === null || count > (counts.get(best) ?? 0)) best = code;
  return best;
}

function loss(
  code: string,
  severity: ImportLoss['severity'],
  source: string,
  detail: string,
  listing?: string,
  count = 1,
): ImportLoss {
  return { code, severity, source, detail, ...(listing === undefined ? {} : { listing }), count };
}

function plainName(html: string): string {
  return htmlToPlainText(html).replace(/\s+/g, ' ').trim();
}

/** The block editor wraps list items in paragraphs, which would split a bullet from its text. */
function richText(html: string): string {
  return htmlToPlainText(html.replace(/<li([^>]*)>\s*<p[^>]*>/gi, '<li$1>').replace(/<\/p>\s*<\/li>/gi, '</li>'));
}

function descriptionText(product: StoreApiProduct): string {
  const full = richText(product.description);
  const short = richText(product.short_description);
  if (short === '') return full;
  if (full === '') return short;
  return full.includes(short) ? full : `${short}\n\n${full}`;
}

/** Product attributes that are not a choice the buyer makes, as a short block at the end of the description. */
function attributeBlock(product: StoreApiProduct): string {
  const lines: string[] = [];
  for (const attribute of product.attributes) {
    if (attribute.has_variations) continue;
    const terms = attribute.terms.map((term) => plainName(term.name)).filter((term) => term !== '');
    if (terms.length > 0) lines.push(`${plainName(attribute.name)}: ${terms.join(', ')}`);
  }
  return lines.join('\n');
}

function minorText(minor: number, exponent: number): string {
  return exponent === 0 ? String(minor) : (minor / 10 ** exponent).toFixed(exponent);
}

function isHttps(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

type Stock = { readonly quantity: number; readonly note: 'unknown' | 'backorder' | 'cart_limit' | null };

/** WooCommerce's cart maximum when stock is not managed. */
const UNMANAGED_CART_MAXIMUM = 9_999;

function resolveStock(product: StoreApiProduct, unmanagedStock: number): Stock {
  if (!product.is_in_stock) return { quantity: 0, note: null };
  if (product.is_on_backorder) return { quantity: 0, note: 'backorder' };
  const cartMaximum = product.add_to_cart.maximum;
  if (cartMaximum !== null && cartMaximum < UNMANAGED_CART_MAXIMUM && !product.sold_individually) {
    return { quantity: cartMaximum, note: 'cart_limit' };
  }
  if (product.low_stock_remaining !== null) return { quantity: product.low_stock_remaining, note: null };
  return { quantity: Math.min(unmanagedStock, COMMERCE_LISTING_MAX_QUANTITY - 1), note: 'unknown' };
}

type PriceResult =
  | { readonly ok: true; readonly minor: number; readonly regularMinor: number | null }
  | { readonly ok: false; readonly code: string; readonly detail: string };

function resolvePrice(product: StoreApiProduct, currency: string, exponent: number): PriceResult {
  const prices = product.prices;
  if (!prices || prices.price === '') return { ok: false, code: 'price_missing', detail: 'The product has no price.' };
  if (prices.currency_code !== currency) {
    return {
      ok: false,
      code: 'currency_mismatch',
      detail: `This product is priced in ${prices.currency_code}, not ${currency}. Nothing is converted.`,
    };
  }
  const minor = rescaleMinor(Number(prices.price), prices.currency_minor_unit, exponent);
  if (minor === null || !Number.isSafeInteger(minor)) {
    return {
      ok: false,
      code: 'price_scale',
      detail: `Price ${prices.price} does not fit the currency's ${exponent} decimal places.`,
    };
  }
  if (minor <= 0) return { ok: false, code: 'price_zero', detail: 'A listing price must be above zero.' };
  const regular =
    prices.regular_price === ''
      ? null
      : rescaleMinor(Number(prices.regular_price), prices.currency_minor_unit, exponent);
  return { ok: true, minor, regularMinor: regular !== null && regular > minor ? regular : null };
}

type Candidate = {
  readonly source: StoreApiProduct;
  readonly priceMinor: number;
  readonly stock: Stock;
  readonly options: Record<string, string>;
  readonly sku: string;
};

export function mapWooStoreCatalog(input: WooStoreMapInput): WooStoreMapResult {
  const { catalog, sellerPubky } = input;
  const currency = storeCurrency(catalog.products);
  if (currency === null) {
    return { ok: false, message: 'This store lists no priced products, so there is nothing to import.' };
  }
  if (!input.offeredCurrencies.includes(currency)) {
    return {
      ok: false,
      message: `This store sells in ${currency}. Pubky listings can be priced in ${input.offeredCurrencies.join(', ')}, and prices are never converted. Nothing was imported.`,
    };
  }
  const settings: ImportSettings = { ...input.settings, currency };
  const exponent = currencyExponent(currency);
  const key = storeIdKey(catalog.storeUrl);

  const losses: ImportLoss[] = [];
  const rows: PresetRow[] = [];
  const labels = new Map<string, string>();
  const usedIds = new Set<string>();
  let listingsRead = catalog.unreadProducts;
  let withWeight = 0;
  let unknownStock = 0;

  for (const product of catalog.products) {
    if (product.type === 'variation' || product.parent !== 0) continue;
    listingsRead += 1;
    const name = plainName(product.name);

    if (product.type !== 'simple' && product.type !== 'variable') {
      losses.push(
        loss(
          'unsupported_type',
          'skipped',
          'Type',
          product.type === 'grouped' || product.type === 'external'
            ? `${product.type === 'grouped' ? 'Grouped' : 'External'} products have no price or stock of their own, so they are not imported.`
            : `Product type "${product.type || 'unknown'}" is not supported.`,
          name,
        ),
      );
      continue;
    }
    if (product.is_password_protected) {
      losses.push(
        loss('password_protected', 'skipped', 'Visibility', 'A password-protected product is not imported.', name),
      );
      continue;
    }

    const reads = new Map((catalog.variations[String(product.id)] ?? []).map((read) => [read.id, read]));
    const parts: { source: StoreApiProduct; options: Record<string, string> }[] = [];
    if (product.type === 'variable') {
      if (product.variations.length === 0) {
        losses.push(loss('no_variations', 'skipped', 'Type', 'The variable product has no variations.', name));
        continue;
      }
      let unread = 0;
      let anyValue = 0;
      for (const ref of product.variations) {
        const read = reads.get(ref.id);
        if (!read) {
          unread += 1;
          continue;
        }
        const options: Record<string, string> = {};
        for (const attribute of ref.attributes) {
          const value = plainName(attribute.value);
          if (value === '') anyValue += 1;
          else options[plainName(attribute.name)] = value;
        }
        parts.push({ source: read, options });
      }
      if (unread > 0) {
        losses.push(
          loss(
            'variation_unread',
            parts.length === 0 ? 'skipped' : 'dropped',
            'Variations',
            `${unread} variation${unread === 1 ? '' : 's'} could not be read from the store${parts.length === 0 ? ', so the product is not imported' : ' and not imported'}.`,
            name,
            unread,
          ),
        );
      }
      if (anyValue > 0) {
        losses.push(
          loss(
            'attribute_dropped',
            'dropped',
            'Variations',
            'A variation that applies to any value of an attribute is imported without that option.',
            name,
            anyValue,
          ),
        );
      }
      if (parts.length === 0) continue;
    } else {
      parts.push({ source: product, options: {} });
    }

    const candidates: Candidate[] = [];
    const seenOptions = new Set<string>();
    let listingFailed = false;
    let inheritedSku = false;
    for (const part of parts) {
      const priced = resolvePrice(part.source, currency, exponent);
      const label =
        product.type === 'variable' ? `${name} (${Object.values(part.options).join(', ') || part.source.id})` : name;
      if (!priced.ok) {
        losses.push(loss(priced.code, 'skipped', 'Price', priced.detail, label));
        if (product.type === 'simple') listingFailed = true;
        continue;
      }
      const signature = JSON.stringify(Object.entries(part.options).sort());
      if (Object.keys(part.options).length > 0 && seenOptions.has(signature)) {
        losses.push(
          loss('variant_duplicate', 'skipped', 'Variations', 'Another variation has the same options.', label),
        );
        continue;
      }
      seenOptions.add(signature);
      if (priced.regularMinor !== null) {
        losses.push(
          loss(
            'compare_at_price',
            'dropped',
            'Regular price',
            `Regular price ${minorText(priced.regularMinor, exponent)} dropped; sale price ${minorText(priced.minor, exponent)} used.`,
            label,
          ),
        );
      }
      const stock = resolveStock(part.source, settings.unmanagedStock);
      if (stock.note === 'unknown') {
        unknownStock += 1;
        losses.push(loss('stock_unmanaged', 'changed', 'Stock', `Stock unknown, set to ${stock.quantity}.`, label));
      } else if (stock.note === 'cart_limit') {
        losses.push(
          loss('stock_from_cart_limit', 'changed', 'Stock', "Stock from the store's cart limit, check it.", label),
        );
      } else if (stock.note === 'backorder') {
        losses.push(
          loss('backorder_stock', 'changed', 'Stock', 'The product is on backorder, so its stock is 0.', label),
        );
      }
      let sku = part.source.sku;
      if (part.source !== product && sku === product.sku) {
        sku = '';
        inheritedSku = product.sku !== '';
      }
      candidates.push({ source: part.source, priceMinor: priced.minor, stock, options: part.options, sku });
    }
    if (listingFailed || candidates.length === 0) continue;
    if (inheritedSku) {
      losses.push(
        loss(
          'sku_dropped',
          'changed',
          'SKU',
          "Variations share their product's SKU, so each variation's SKU was left empty.",
          name,
        ),
      );
    }
    if (candidates.length > COMMERCE_LISTING_MAX_VARIANTS) {
      losses.push(
        loss(
          'variants_truncated',
          'dropped',
          'Variations',
          `A listing holds at most ${COMMERCE_LISTING_MAX_VARIANTS} variants.`,
          name,
          candidates.length - COMMERCE_LISTING_MAX_VARIANTS,
        ),
      );
      candidates.length = COMMERCE_LISTING_MAX_VARIANTS;
    }

    const id = listingIdFor(key, product.id, usedIds);
    labels.set(id, name);
    const listingPrice = Math.min(...candidates.map((candidate) => candidate.priceMinor));

    const categories = product.categories.map((category) => plainName(category.name)).filter((entry) => entry !== '');
    if (categories.length === 0) {
      losses.push(
        loss('category_absent', 'changed', 'Categories', 'No category, so the listing is uncategorized.', name),
      );
    }
    const tags = [
      ...categories.slice(1),
      ...product.tags.map((tag) => plainName(tag.name)),
      ...product.brands.map((brand) => plainName(brand.name)),
    ].filter((tag) => tag !== '');

    const attributes = attributeBlock(product);
    if (attributes !== '') {
      losses.push(
        loss(
          'attribute_in_description',
          'changed',
          'Attributes',
          'Product attributes that are not a choice the buyer makes are listed at the end of the description.',
          name,
        ),
      );
    }
    const body = descriptionText(product);
    const description = attributes === '' ? body : body === '' ? attributes : `${body}\n\n${attributes}`;

    if (product.weight !== '' || product.has_dimensions) withWeight += 1;
    if (product.sold_individually) {
      losses.push(
        loss('inventory_policy', 'dropped', 'Sold individually', 'The one-per-order limit is not imported.', name),
      );
    }

    const found: string[] = [];
    const invalid: string[] = [];
    const imageAlt = new Map<string, string>();
    for (const source of [product, ...candidates.map((candidate) => candidate.source)]) {
      for (const image of source.images) {
        const url = image.src.trim();
        if (!isHttps(url)) {
          if (url !== '' && !invalid.includes(url)) invalid.push(url);
          continue;
        }
        if (!found.includes(url)) {
          found.push(url);
          imageAlt.set(url, plainName(image.alt));
        }
      }
    }
    if (invalid.length > 0) {
      losses.push(
        loss(
          'image_url_invalid',
          'dropped',
          'Images',
          `${invalid.length} image entr${invalid.length === 1 ? 'y is' : 'ies are'} not a secure web link.`,
          name,
          invalid.length,
        ),
      );
    }
    const keptUrls = found.slice(0, COMMERCE_LISTING_MAX_IMAGES);
    if (found.length > keptUrls.length) {
      losses.push(
        loss(
          'image_overflow',
          'dropped',
          'Images',
          `A listing holds at most ${COMMERCE_LISTING_MAX_IMAGES} photos.`,
          name,
          found.length - keptUrls.length,
        ),
      );
    }
    const images: SourceImage[] = keptUrls.map((url) => ({ url, alt: imageAlt.get(url) || name }));

    const recordUri = `pubky://${sellerPubky}/pub/pubky.app/marketplace/v1/listings/${id}`;
    candidates.forEach((candidate) => {
      const extra: Record<string, string> = {};
      if (candidate.priceMinor !== listingPrice) extra[VARIANT_PRICE_MINOR_FIELD] = String(candidate.priceMinor);
      if (candidate.source !== product) extra.external_variant_id = `woo:${candidate.source.id}`;
      rows.push({
        recordUri,
        sellerPubky,
        listingId: id,
        sourceListingKey: `woo-store:${key}:${product.id}`,
        // A store has no revision to compare, so a re-import updates the stored listing instead of conflicting with it.
        recordRevision: null,
        variantId: `v${candidate.source.id}`,
        sku: candidate.sku,
        state: 'active',
        title: name,
        description,
        taxonomy: {},
        category: categories[0] ?? '',
        condition: settings.condition,
        tags,
        amountMinor: listingPrice,
        currency,
        exponent,
        variantQuantity: candidate.stock.quantity,
        variantEnabled: true,
        options: candidate.options,
        media: [],
        shippingOptions: [],
        returnPolicy: { accepted: false },
        sale: { format: 'fixed_price' },
        externalRefs: {
          channel: 'woocommerce',
          external_id: `woo:${product.id}`,
          ...(product.sku !== '' ? { sku: product.sku } : {}),
        },
        extraFields: withSourceImages(extra, images),
      });
    });
  }

  const deduped = dropSharedSkus(rows, labels, losses);
  const finalized = finalizePresetRows({
    rows: deduped,
    settings,
    labelFor: (id) => labels.get(id) ?? id,
    lineFor: () => undefined,
  });
  losses.push(...finalized.losses);

  const imported = new Set(finalized.rows.map((row) => row.listingId));
  const readCount = catalog.products.length + catalog.unreadProducts;
  const unlisted = catalog.total !== null && catalog.total > readCount ? catalog.total - readCount : 0;
  listingsRead += unlisted;

  if (catalog.unreadProducts > 0) {
    losses.push(
      loss(
        'product_unreadable',
        'skipped',
        'Products',
        'The store sent a product this import could not read.',
        undefined,
        catalog.unreadProducts,
      ),
    );
  }
  if (unlisted > 0) {
    losses.push(
      loss(
        'catalog_truncated',
        'skipped',
        'Products',
        `The store lists ${catalog.total} products. This import reads the first ${readCount}; import again with a smaller catalogue or from a file for the rest.`,
        undefined,
        unlisted,
      ),
    );
  }
  const photoUrls = new Set<string>();
  for (const row of finalized.rows) {
    const images = JSON.parse(row.extraFields[SOURCE_IMAGE_URLS_FIELD] ?? '[]') as { url: string }[];
    for (const image of images) photoUrls.add(image.url);
  }
  if (photoUrls.size > IMPORT_IMAGE_MAX_COUNT) {
    losses.push(
      loss(
        'photos_over_import_limit',
        'changed',
        'Images',
        `This catalogue has ${photoUrls.size} photos. One import loads at most ${IMPORT_IMAGE_MAX_COUNT}, in listing order, so the listings after that fail with "photo required". Import the store again to load the rest; listings already published keep their photos.`,
        undefined,
        photoUrls.size - IMPORT_IMAGE_MAX_COUNT,
      ),
    );
  }
  if (imported.size > 0) {
    losses.push(
      loss(
        'stock_not_public',
        'changed',
        'Stock',
        `Exact stock isn't public. Counts here come from the store's cart limit or low-stock count where it shows one; ${unknownStock} item${unknownStock === 1 ? ' has' : 's have'} neither and get the default quantity. Connect the store for live stock.`,
        undefined,
        imported.size,
      ),
      loss(
        'tax_display',
        'dropped',
        'Prices',
        'Prices are what the store shows buyers, with or without tax as the store displays them. Tax settings are not imported.',
        undefined,
        imported.size,
      ),
      loss(
        'condition_defaulted',
        'changed',
        'Condition',
        `WooCommerce has no condition. Every listing is set to "${settings.condition.replaceAll('_', ' ')}".`,
        undefined,
        imported.size,
      ),
      loss(
        'return_policy_absent',
        'dropped',
        'Return policy',
        'WooCommerce has no return policy, so listings accept no returns.',
        undefined,
        imported.size,
      ),
    );
    if (withWeight > 0) {
      losses.push(
        loss(
          'weight',
          'dropped',
          'Weight and size',
          'Weight and size are not imported. The default package is used.',
          undefined,
          withWeight,
        ),
      );
    }
  }

  return {
    ok: true,
    rows: finalized.rows,
    report: {
      format: 'woocommerce_store',
      listingsRead,
      listingsImported: imported.size,
      listingsSkipped: listingsRead - imported.size,
      losses,
    },
  };
}

function listingIdFor(key: string, productId: number, used: Set<string>): string {
  let id = entityIdFrom(`woo-${key}-${productId}`);
  while (used.has(id)) id = `${id}-x`;
  used.add(id);
  return id;
}

/**
 * The shared planner fails a whole file on a duplicate SKU, and a store can
 * hold the same SKU on several products. The SKU is the least important field,
 * so it is left empty on every row that shares one, and reported.
 */
function dropSharedSkus(
  rows: readonly PresetRow[],
  labels: ReadonlyMap<string, string>,
  losses: ImportLoss[],
): PresetRow[] {
  const owners = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.sku === '') continue;
    const set = owners.get(row.sku) ?? new Set<string>();
    set.add(`${row.listingId}/${row.variantId}`);
    owners.set(row.sku, set);
  }
  const shared = new Set([...owners].filter(([, set]) => set.size > 1).map(([sku]) => sku));
  if (shared.size === 0) return [...rows];
  const reported = new Set<string>();
  return rows.map((row) => {
    if (!shared.has(row.sku)) return row;
    if (!reported.has(row.listingId)) {
      reported.add(row.listingId);
      losses.push(
        loss(
          'sku_dropped',
          'changed',
          'SKU',
          `SKU ${row.sku} is used by more than one product, so it was not imported.`,
          labels.get(row.listingId) ?? row.listingId,
        ),
      );
    }
    return { ...row, sku: '' };
  });
}
