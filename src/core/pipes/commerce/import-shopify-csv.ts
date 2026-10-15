import { csvColumns, parseCsvTable } from './import-csv-table';
import type { ImportLoss, ImportLossReport } from './import-loss-report';
import { finalizePresetRows, type PresetRow, type SourceImage, withSourceImages } from './import-preset-rows';
import { currencyExponent, IMPORT_CONDITIONS_SET, type ImportSettings, rescaleMinor } from './import-settings';

/**
 * Shop-side handling of a Shopify product CSV after the SDK mapper has run.
 * The SDK stays unchanged: it maps handles, prices, options and its loss
 * codes; this module applies the settings the SDK cannot know (currency,
 * CSV quantities, shipping, condition), keeps the source image URLs and turns
 * the SDK's losses into the shared loss-report shape.
 */

export type ShopifySdkLoss = { readonly code: string; readonly source: string; readonly detail: string };

export type ShopifySdkProduct = {
  readonly handle: string;
  readonly title: string;
  readonly images: readonly { readonly src: string; readonly alt: string }[];
  readonly losses: readonly ShopifySdkLoss[];
};

export type ShopifySdkSkipped = { readonly handle: string; readonly losses: readonly ShopifySdkLoss[] };

export type ShopifyPresetInput = {
  /** The decoded CSV text, read again here only to find each variant's quantity. */
  readonly text: string;
  readonly products: readonly ShopifySdkProduct[];
  readonly skipped: readonly ShopifySdkSkipped[];
  readonly headerLosses: readonly ShopifySdkLoss[];
  /** SDK rows (every variant, zero stock included) built at `workExponent`. */
  readonly rows: readonly PresetRow[];
  readonly workExponent: number;
  readonly settings: ImportSettings;
};

export type ShopifyPresetResult = { readonly rows: readonly PresetRow[]; readonly report: ImportLossReport };

const SDK_PUBKY_ID = /^[A-Za-z0-9_.-]{1,128}$/;
const HANDLE_HEADERS = ['URL handle', 'Handle'] as const;
const SKU_HEADERS = ['SKU', 'Variant SKU'] as const;
const PRICE_HEADERS = ['Price', 'Variant Price'] as const;
const QUANTITY_HEADERS = ['Inventory quantity', 'Variant Inventory Qty'] as const;

function firstRead(read: (header: string) => string, headers: readonly string[]): string {
  for (const header of headers) {
    const value = read(header);
    if (value !== '') return value;
  }
  return '';
}

/**
 * CSV quantity per handle and variant id. Variant ids are derived exactly as
 * the SDK mapper derives them (the SKU when it is a valid id, otherwise the
 * 1-based position of the row within its product), so a quantity always lands
 * on the variant it was written for.
 */
export function shopifyCsvQuantities(text: string): ReadonlyMap<string, ReadonlyMap<string, string>> {
  const parsed = parseCsvTable(text);
  const result = new Map<string, Map<string, string>>();
  if (!parsed.ok) return result;
  const columns = csvColumns(parsed.table.headers);
  const positions = new Map<string, number>();
  for (const record of parsed.table.records) {
    const read = (header: string) => columns.read(record, header);
    const handle = firstRead(read, HANDLE_HEADERS);
    if (handle === '') continue;
    const position = positions.get(handle) ?? 0;
    positions.set(handle, position + 1);
    const sku = firstRead(read, SKU_HEADERS);
    const price = firstRead(read, PRICE_HEADERS);
    if (price === '' && sku === '') continue;
    const variantId = SDK_PUBKY_ID.test(sku) ? sku : `v${position + 1}`;
    const byVariant = result.get(handle) ?? new Map<string, string>();
    byVariant.set(variantId, firstRead(read, QUANTITY_HEADERS));
    result.set(handle, byVariant);
  }
  return result;
}

const SKIPPING_CODES = new Set([
  'unpublished_product',
  'gift_card',
  'handle_not_identity',
  'variant_price_not_representable',
  'price_scale',
]);

function sdkSeverity(code: string): ImportLoss['severity'] {
  if (code === 'condition_defaulted') return 'changed';
  return SKIPPING_CODES.has(code) ? 'skipped' : 'dropped';
}

export function buildShopifyPresetRows(input: ShopifyPresetInput): ShopifyPresetResult {
  const { settings, workExponent } = input;
  const targetExponent = currencyExponent(settings.currency);
  const losses: ImportLoss[] = [];
  const quantities = input.settings.useCsvQuantities ? shopifyCsvQuantities(input.text) : null;
  const productByHandle = new Map(input.products.map((product) => [product.handle, product]));

  const sdkLoss = (entry: ShopifySdkLoss, listing: string | undefined, severity: ImportLoss['severity'], count = 1) => {
    if (entry.code === 'shipping_price_absent' || entry.code === 'image_src_requires_seller_download') return;
    const base = { code: entry.code, source: entry.source, ...(listing === undefined ? {} : { listing }), count };
    if (entry.code === 'csv_quantity_unscoped') {
      if (settings.useCsvQuantities) return;
      losses.push({
        ...base,
        severity: 'changed',
        detail:
          'The CSV quantity is not used, so stock is 0. Turn on "Use CSV quantities as total stock" to import it.',
      });
      return;
    }
    if (entry.code === 'condition_defaulted') {
      losses.push({
        ...base,
        severity,
        detail: `Shopify has no condition. The listing is set to "${settings.condition.replaceAll('_', ' ')}".`,
      });
      return;
    }
    losses.push({ ...base, severity, detail: entry.detail });
  };

  for (const skipped of input.skipped) {
    for (const entry of skipped.losses) {
      if (SKIPPING_CODES.has(entry.code)) sdkLoss(entry, skipped.handle, 'skipped');
    }
  }
  for (const product of input.products) {
    const name = product.title || product.handle;
    for (const entry of product.losses) sdkLoss(entry, name, sdkSeverity(entry.code));
    if (product.images.length > 0) {
      losses.push({
        code: 'image_not_loaded',
        severity: 'dropped',
        source: 'Product image URL',
        detail: `${product.images.length} photo link${product.images.length === 1 ? '' : 's'} kept for photo import. The photos are not loaded yet.`,
        listing: name,
        count: product.images.length,
      });
    }
  }

  const parsed = parseCsvTable(input.text);
  if (parsed.ok) {
    const columns = csvColumns(parsed.table.headers);
    for (const entry of input.headerLosses) {
      if (entry.code === 'shipping_price_absent' || entry.code === 'image_src_requires_seller_download') continue;
      if (entry.code === 'csv_quantity_unscoped' && settings.useCsvQuantities) continue;
      const count = parsed.table.records.filter((record) => columns.read(record, entry.source) !== '').length;
      if (count === 0) continue;
      sdkLoss(entry, undefined, sdkSeverity(entry.code), count);
    }
  }

  const rows: PresetRow[] = [];
  const dropped = new Set<string>();
  for (const row of input.rows) {
    if (dropped.has(row.listingId)) continue;
    const product = productByHandle.get(row.listingId);
    const label = product?.title || row.listingId;
    const amount = rescaleMinor(row.amountMinor, workExponent, targetExponent);
    if (amount === null || amount <= 0) {
      dropped.add(row.listingId);
      losses.push({
        code: 'price_scale',
        severity: 'skipped',
        source: 'Price',
        detail: `The price does not fit ${settings.currency}'s ${targetExponent} decimal places.`,
        listing: label,
        count: 1,
      });
      continue;
    }

    let quantity = row.variantQuantity;
    if (quantities) {
      const raw = quantities.get(row.listingId)?.get(row.variantId);
      if (raw === undefined || raw === '') {
        quantity = 0;
        losses.push({
          code: 'quantity_missing',
          severity: 'changed',
          source: 'Inventory quantity',
          detail: 'The row has no quantity, so stock is 0.',
          listing: label,
          count: 1,
        });
      } else if (/^\d+$/.test(raw)) {
        quantity = Number(raw);
      } else {
        quantity = 0;
        losses.push({
          code: 'quantity_invalid',
          severity: 'changed',
          source: 'Inventory quantity',
          detail: `"${raw}" is not a whole number, so stock is 0.`,
          listing: label,
          count: 1,
        });
      }
    }

    const defaulted = product?.losses.some((entry) => entry.code === 'condition_defaulted') ?? false;
    let condition = row.condition;
    if (defaulted || !condition) condition = settings.condition;
    else if (!IMPORT_CONDITIONS_SET.has(condition)) {
      condition = 'good';
      losses.push({
        code: 'condition_mapped',
        severity: 'changed',
        source: 'Google Shopping / Condition',
        detail: `"${row.condition}" has no exact match and becomes "good".`,
        listing: label,
        count: 1,
      });
    }

    const images: SourceImage[] = (product?.images ?? []).map((image) => ({
      url: image.src,
      alt: image.alt || label,
    }));
    rows.push({
      ...row,
      amountMinor: amount,
      currency: settings.currency,
      exponent: targetExponent,
      variantQuantity: quantity,
      condition,
      extraFields: withSourceImages(row.extraFields, images),
    });
  }

  const finalized = finalizePresetRows({
    rows,
    settings,
    labelFor: (id) => productByHandle.get(id)?.title || id,
    lineFor: () => undefined,
  });
  losses.push(...finalized.losses);

  const imported = new Set(finalized.rows.map((row) => row.listingId));
  const listingsRead = input.products.length + input.skipped.length;
  return {
    rows: finalized.rows,
    report: {
      format: 'shopify',
      listingsRead,
      listingsImported: imported.size,
      listingsSkipped: listingsRead - imported.size,
      losses,
    },
  };
}
