import {
  COMMERCE_LISTING_MAX_IMAGES,
  COMMERCE_LISTING_MAX_QUANTITY,
  COMMERCE_LISTING_MAX_VARIANTS,
  COMMERCE_LISTING_TITLE_MAX_CHARS,
  COMMERCE_LISTING_TITLE_MIN_CHARS,
} from '@/config/commerce';
import type {
  ConnectorCatalogProduct,
  ConnectorCatalogVariant,
  ConnectorMapping,
  ConnectorProvider,
  VariantMode,
} from '@/libs/commerce/connectors';
import { htmlToPlainText } from './import-html-text';
import type { ImportLoss, ImportLossReport } from './import-loss-report';
import {
  entityIdFrom,
  finalizePresetRows,
  type PresetRow,
  type SourceImage,
  VARIANT_PRICE_MINOR_FIELD,
  withSourceImages,
} from './import-preset-rows';
import { currencyExponent, type ImportSettings, rescaleMinor } from './import-settings';

/**
 * Store products (from a connected WooCommerce or Shopify store) as the same
 * canonical rows the CSV presets produce, so they go through the one plan,
 * dry-run and publish flow. Pure: no IO, no clock, no randomness.
 *
 * Rules (coordination C10): shipping and ships-from come only from the
 * settings the seller chose (the rows carry neither until they did); a variant
 * whose stock the store does not track gets the seller's default quantity and a
 * "Stock unknown, set to N" note.
 */

const ID_PREFIX: Readonly<Record<ConnectorProvider, string>> = { shopify: 'shopify', woocommerce: 'woo' };

export type ConnectorImportLink = {
  readonly listingId: string;
  readonly variantId: string;
  readonly providerProductId: string;
  readonly providerVariantId: string;
  readonly sku: string | null;
};

export type ConnectorCatalogRowsInput = {
  readonly products: readonly ConnectorCatalogProduct[];
  readonly provider: ConnectorProvider;
  readonly sellerPubky: string;
  /**
   * `currency` is the store's own currency (see {@link connectorStoreCurrency});
   * prices are never converted. `shipping` and `countryCode` stay `null` until
   * the seller chooses.
   */
  readonly settings: ImportSettings;
  /**
   * `native` (default) keeps a product's variants together as one listing.
   * `split` makes each store variant its own listing (the connection's
   * "One listing per size or variant"), each with a single variant.
   */
  readonly variantMode?: VariantMode;
};

export type ConnectorCatalogRows = {
  readonly rows: readonly PresetRow[];
  readonly report: ImportLossReport;
  /** One link per imported variant, for the mapping the service needs to sync stock and push orders. */
  readonly links: readonly ConnectorImportLink[];
};

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

/** The numeric tail of a store id (`gid://shopify/Product/42` is `42`), safe in a listing id. */
function idTail(id: string): string {
  return entityIdFrom(id.split('/').pop() ?? id);
}

export function connectorListingId(provider: ConnectorProvider, providerProductId: string): string {
  return `${ID_PREFIX[provider]}-${idTail(providerProductId)}`.slice(0, 128);
}

/** The listing of one store variant in split mode; stable across imports. */
export function connectorSplitListingId(
  provider: ConnectorProvider,
  providerProductId: string,
  providerVariantId: string,
): string {
  return `${ID_PREFIX[provider]}-${idTail(providerProductId)}-${idTail(providerVariantId)}`.slice(0, 128);
}

export function connectorVariantId(providerVariantId: string): string {
  return `v${idTail(providerVariantId)}`.slice(0, 128);
}

/** The currency the store prices in, read from the first priced variant; `null` for an empty selection. */
export function connectorStoreCurrency(products: readonly ConnectorCatalogProduct[]): string | null {
  for (const product of products) {
    const first = product.variants[0];
    if (first) return first.price.currency;
  }
  return null;
}

function optionsOf(product: ConnectorCatalogProduct, variant: ConnectorCatalogVariant): Record<string, string> {
  const isShopifyDefault =
    product.variants.length === 1 &&
    variant.optionValues.length === 1 &&
    variant.optionValues[0]?.name === 'Title' &&
    variant.optionValues[0]?.value === 'Default Title';
  if (isShopifyDefault) return {};
  const options: Record<string, string> = {};
  for (const { name, value } of variant.optionValues) {
    if (name.trim() !== '' && value.trim() !== '') options[name.trim()] = value.trim();
  }
  return options;
}

function imagesOf(urls: readonly string[], label: string, losses: ImportLoss[]): readonly SourceImage[] {
  const seen = new Set<string>();
  const valid: string[] = [];
  let invalid = 0;
  for (const url of urls) {
    let parsed: URL | null = null;
    try {
      parsed = new URL(url);
    } catch {
      parsed = null;
    }
    if (!parsed || parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') {
      invalid += 1;
      continue;
    }
    if (!seen.has(parsed.href)) {
      seen.add(parsed.href);
      valid.push(parsed.href);
    }
  }
  if (invalid > 0) {
    losses.push(
      loss(
        'image_url_invalid',
        'dropped',
        'Images',
        `${invalid} photo link${invalid === 1 ? ' is' : 's are'} not a secure https address and was not kept.`,
        label,
        invalid,
      ),
    );
  }
  const kept = valid.slice(0, COMMERCE_LISTING_MAX_IMAGES);
  if (valid.length > kept.length) {
    losses.push(
      loss(
        'image_overflow',
        'dropped',
        'Images',
        `A listing holds at most ${COMMERCE_LISTING_MAX_IMAGES} photos.`,
        label,
        valid.length - kept.length,
      ),
    );
  }
  if (kept.length > 0) {
    losses.push(
      loss(
        'image_not_loaded',
        'dropped',
        'Images',
        `${kept.length} photo link${kept.length === 1 ? '' : 's'} kept for photo import. The photos are not loaded yet.`,
        label,
        kept.length,
      ),
    );
  }
  return kept.map((url) => ({ url, alt: label }));
}

/** The title of a split listing: the product and the variant's own choice ("Socks bundle, Size M"), kept inside the title limit. */
function splitTitle(product: ConnectorCatalogProduct, variant: ConnectorCatalogVariant): string {
  const choice =
    variant.optionValues
      .map(({ value }) => value.trim())
      .filter(Boolean)
      .join(' / ') ||
    variant.title?.trim() ||
    '';
  const isDefault = choice === 'Default Title' || choice === '';
  if (isDefault) return product.title;
  const suffix = `, ${choice}`;
  const room = COMMERCE_LISTING_TITLE_MAX_CHARS - suffix.length;
  return room >= COMMERCE_LISTING_TITLE_MIN_CHARS
    ? `${product.title.length > room ? `${product.title.slice(0, room - 1).trimEnd()}…` : product.title}${suffix}`
    : product.title;
}

export function mapConnectorCatalog(input: ConnectorCatalogRowsInput): ConnectorCatalogRows {
  const { products, provider, sellerPubky, settings } = input;
  const split = input.variantMode === 'split';
  const exponent = currencyExponent(settings.currency);
  const rows: PresetRow[] = [];
  const links: ConnectorImportLink[] = [];
  const losses: ImportLoss[] = [];
  const labels = new Map<string, string>();
  const usedListingIds = new Set<string>();
  const linksOfListing = new Map<string, ConnectorImportLink[]>();
  let listingsRead = 0;

  /** One Pubky listing from the given variants of a store product. */
  const addListing = (
    product: ConnectorCatalogProduct,
    variants: readonly ConnectorCatalogVariant[],
    listingId: string,
    title: string,
    imageUrls: readonly string[],
  ) => {
    listingsRead += 1;
    const label = title.trim() || product.providerProductId;
    const wrongCurrency = variants.find((variant) => variant.price.currency !== settings.currency);
    if (wrongCurrency) {
      losses.push(
        loss(
          'price_currency',
          'skipped',
          'Price',
          `This product is priced in ${wrongCurrency.price.currency}, but the rest of this import is in ${settings.currency}. Nothing is converted.`,
          label,
        ),
      );
      return;
    }

    const prices: number[] = [];
    let unpriced: 'price_zero' | 'price_scale' | null = null;
    for (const variant of variants) {
      const minor = rescaleMinor(variant.price.amountMinor, variant.price.exponent, exponent);
      if (minor === null) {
        unpriced = 'price_scale';
        break;
      }
      if (minor <= 0) {
        unpriced = 'price_zero';
        break;
      }
      prices.push(minor);
    }
    if (unpriced) {
      losses.push(
        loss(
          unpriced,
          'skipped',
          'Price',
          unpriced === 'price_zero'
            ? 'A listing price must be above zero.'
            : `A price does not fit ${settings.currency} with ${exponent} decimal places.`,
          label,
        ),
      );
      return;
    }

    if (usedListingIds.has(listingId)) {
      losses.push(
        loss(
          'product_duplicate',
          'skipped',
          'Product',
          'The store sent this product twice, so it was read once.',
          label,
        ),
      );
      return;
    }
    usedListingIds.add(listingId);
    labels.set(listingId, label);
    const listingPrice = Math.min(...prices);
    const images = imagesOf(imageUrls, label, losses);
    const description = htmlToPlainText(product.description ?? '');
    const recordUri = `pubky://${sellerPubky}/pub/pubky.app/marketplace/v1/listings/${listingId}`;
    const usedVariantIds = new Set<string>();
    let unknownStock = 0;
    let unknownStockQuantity = 0;
    const productLinks: ConnectorImportLink[] = [];

    variants.forEach((variant, index) => {
      let variantId = connectorVariantId(variant.providerVariantId);
      if (usedVariantIds.has(variantId)) variantId = `${variantId}-${index + 1}`;
      usedVariantIds.add(variantId);
      const price = prices[index] ?? listingPrice;
      const tracked = typeof variant.stock === 'number';
      const quantity = tracked
        ? Math.min(Math.max(0, variant.stock as number), COMMERCE_LISTING_MAX_QUANTITY - 1)
        : Math.min(settings.unmanagedStock, COMMERCE_LISTING_MAX_QUANTITY - 1);
      if (!tracked) {
        unknownStock += 1;
        unknownStockQuantity = quantity;
      }
      const extra: Record<string, string> = {
        external_variant_id: `${provider}:${variant.providerVariantId}`,
      };
      if (price !== listingPrice) extra[VARIANT_PRICE_MINOR_FIELD] = String(price);
      const sku = variant.sku?.trim() ?? '';
      rows.push({
        recordUri,
        sellerPubky,
        listingId,
        sourceListingKey: split
          ? `${provider}:${product.providerProductId}:${variant.providerVariantId}`
          : `${provider}:${product.providerProductId}`,
        // A store has no revision to compare, so a re-import updates instead of conflicting with the listing's own edits.
        recordRevision: null,
        variantId,
        sku,
        state: 'active',
        title,
        description,
        taxonomy: {},
        category: '',
        condition: settings.condition,
        tags: [],
        amountMinor: listingPrice,
        currency: settings.currency,
        exponent,
        variantQuantity: quantity,
        variantEnabled: true,
        options: optionsOf(product, variant),
        media: [],
        shippingOptions: [],
        returnPolicy: { accepted: false },
        sale: { format: 'fixed_price' },
        externalRefs: {
          channel: provider,
          external_id: `${provider}:${product.providerProductId}`,
        },
        extraFields: withSourceImages(extra, images),
      });
      productLinks.push({
        listingId,
        variantId,
        providerProductId: product.providerProductId,
        providerVariantId: variant.providerVariantId,
        sku: sku === '' ? null : sku,
      });
    });
    if (unknownStock > 0) {
      losses.push(
        loss(
          'stock_unmanaged',
          'changed',
          'Stock',
          `Stock unknown, set to ${unknownStockQuantity}.${unknownStock > 1 ? ` (${unknownStock} variants)` : ''}`,
          label,
          unknownStock,
        ),
      );
    }
    linksOfListing.set(listingId, productLinks);
  };

  for (const product of products) {
    const label = product.title.trim() || product.providerProductId;
    if (product.variants.length === 0) {
      listingsRead += 1;
      losses.push(loss('no_variants', 'skipped', 'Variants', 'The store lists no variant to sell.', label));
      continue;
    }
    if (split) {
      for (const variant of product.variants) {
        addListing(
          product,
          [variant],
          connectorSplitListingId(provider, product.providerProductId, variant.providerVariantId),
          splitTitle(product, variant),
          [...(variant.imageUrl ? [variant.imageUrl] : []), ...product.imageUrls],
        );
      }
      continue;
    }
    if (product.variants.length > COMMERCE_LISTING_MAX_VARIANTS) {
      listingsRead += 1;
      losses.push(
        loss(
          'variants_overflow',
          'skipped',
          'Variants',
          `A listing holds at most ${COMMERCE_LISTING_MAX_VARIANTS} variants; this product has ${product.variants.length}.`,
          label,
        ),
      );
      continue;
    }
    addListing(
      product,
      product.variants,
      connectorListingId(provider, product.providerProductId),
      product.title,
      product.imageUrls,
    );
  }

  const finalized = finalizePresetRows({
    rows,
    settings,
    labelFor: (id) => labels.get(id) ?? id,
    lineFor: () => undefined,
  });
  losses.push(...finalized.losses);

  const kept = new Set(finalized.rows.map((row) => row.listingId));
  const keptVariants = new Set(finalized.rows.map((row) => `${row.listingId}\u0000${row.variantId}`));
  for (const [listingId, productLinks] of linksOfListing) {
    if (!kept.has(listingId)) continue;
    for (const link of productLinks) {
      if (keptVariants.has(`${link.listingId}\u0000${link.variantId}`)) links.push(link);
    }
  }

  const imported = kept.size;
  if (imported > 0) {
    losses.push(
      loss(
        'category_absent',
        'changed',
        'Categories',
        'Your store catalog has no Pubky category, so listings are uncategorized.',
        undefined,
        imported,
      ),
      loss(
        'condition_defaulted',
        'changed',
        'Condition',
        `A store has no condition. Every listing is set to "${settings.condition.replaceAll('_', ' ')}".`,
        undefined,
        imported,
      ),
      loss(
        'return_policy_absent',
        'dropped',
        'Return policy',
        'A store product has no Pubky return policy, so listings accept no returns.',
        undefined,
        imported,
      ),
    );
  }

  return {
    rows: finalized.rows,
    links,
    report: {
      format: provider,
      listingsRead,
      listingsImported: imported,
      listingsSkipped: listingsRead - imported,
      losses,
    },
  };
}

/**
 * The mappings to give the service for the imported listings. The service holds
 * only the listings whose publish finished, so the caller writes these and
 * leaves out any listing the service names as missing.
 */
export function connectorMappingsFor(links: readonly ConnectorImportLink[]): ConnectorMapping[] {
  return links.map((link) => ({
    listingId: link.listingId,
    variantId: link.variantId,
    providerProductId: link.providerProductId,
    providerVariantId: link.providerVariantId,
    ...(link.sku ? { sku: link.sku } : {}),
  }));
}
