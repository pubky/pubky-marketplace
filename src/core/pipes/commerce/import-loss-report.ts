/**
 * Loss report for shop-system imports: what a preset skipped, dropped or
 * changed, and why. Shopify entries keep the SDK's loss codes; WooCommerce
 * entries follow the same style so one report shape serves both.
 */

export type ImportLossSeverity = 'skipped' | 'dropped' | 'changed';

export type ImportLoss = {
  readonly code: string;
  readonly severity: ImportLossSeverity;
  /** The CSV column or field the loss concerns. */
  readonly source: string;
  readonly detail: string;
  /** The product label (name, SKU or handle); absent for whole-column entries. */
  readonly listing?: string;
  /** 1-based line of the source row, when the loss belongs to one row. */
  readonly line?: number;
  /** How many rows this entry stands for (whole-column entries); 1 otherwise. */
  readonly count: number;
};

export type ImportSourceFormat = 'woocommerce' | 'woocommerce_store' | 'shopify';

export type ImportLossReport = {
  readonly format: ImportSourceFormat;
  /** Products the file described (a Woo variable product with its variations counts once). */
  readonly listingsRead: number;
  readonly listingsImported: number;
  readonly listingsSkipped: number;
  readonly losses: readonly ImportLoss[];
};

export type ImportLossGroup = {
  readonly code: string;
  readonly severity: ImportLossSeverity;
  readonly label: string;
  readonly count: number;
  readonly examples: readonly string[];
  readonly detail: string;
};

export type ImportLossSummary = {
  readonly format: ImportSourceFormat;
  readonly listingsRead: number;
  readonly listingsImported: number;
  readonly listingsSkipped: number;
  readonly skipped: number;
  readonly dropped: number;
  readonly changed: number;
  readonly groups: readonly ImportLossGroup[];
};

const LOSS_LABELS: Readonly<Record<string, string>> = {
  unsupported_type: 'Product type not supported',
  variation_orphan: 'Variation without a parent',
  no_variations: 'Variable product without variations',
  gift_card: 'Gift cards',
  unpublished_product: 'Unpublished products',
  handle_not_identity: 'Handle cannot be used as a listing id',
  identity_invalid: 'Id cannot be used',
  sku_duplicate: 'Duplicate SKU',
  sku_dropped: 'SKU dropped',
  variant_id_duplicate: 'Duplicate variant',
  price_missing: 'Price missing',
  price_zero: 'Price must be above zero',
  price_scale: 'Price does not fit the currency',
  variant_price_not_representable: 'Variants with different prices',
  title_invalid: 'Title too short',
  title_truncated: 'Title shortened',
  description_absent: 'Description missing',
  description_truncated: 'Description shortened',
  tags_truncated: 'Tags shortened',
  options_truncated: 'Options shortened',
  compare_at_price: 'Regular or compare-at price',
  sale_schedule: 'Sale schedule',
  tax: 'Tax settings',
  weight: 'Weight and size',
  inventory_policy: 'Stock policy',
  catalog_visibility: 'Catalog visibility',
  purchase_note: 'Purchase notes',
  shipping_class: 'Shipping classes',
  related_products: 'Related products',
  stock_unmanaged: 'Stock unknown',
  stock_capped: 'Stock capped',
  stock_not_public: 'Exact stock not public',
  stock_from_cart_limit: 'Stock from the cart limit',
  tax_display: 'Tax',
  backorder_stock: 'On backorder',
  password_protected: 'Password-protected products',
  currency_mismatch: 'Other currency',
  variation_unread: 'Variations not read',
  variant_duplicate: 'Duplicate variation',
  variants_truncated: 'Too many variations',
  attribute_in_description: 'Attributes added to the description',
  catalog_truncated: 'Catalogue larger than one import',
  product_unreadable: 'Products not readable',
  stock_adjusted: 'Stock adjusted',
  csv_quantity_unscoped: 'Stock quantity not used',
  quantity_missing: 'Stock quantity missing',
  quantity_invalid: 'Stock quantity invalid',
  no_stock_paused: 'No stock, listing paused',
  draft_paused: 'Draft imported as paused',
  image_not_loaded: 'Photos not loaded',
  image_url_invalid: 'Photo link invalid',
  image_overflow: 'Too many photos',
  downloadable_files: 'Downloadable files',
  condition_defaulted: 'Condition defaulted',
  condition_mapped: 'Condition mapped',
  return_policy_absent: 'Return policy absent',
  unmapped_header: 'Column not imported',
  encoding_fallback: 'File encoding',
  attribute_dropped: 'Attributes not used as options',
  category_absent: 'Category missing',
  html_body: 'HTML removed',
  market_price_list: 'Market prices',
  metafield: 'Metafields',
  google_shopping: 'Google Shopping fields',
  cost: 'Cost per item',
  barcode: 'Barcode',
  seo: 'SEO fields',
  collection: 'Collections',
};

export function lossLabel(code: string): string {
  return LOSS_LABELS[code] ?? code.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

const SEVERITY_ORDER: readonly ImportLossSeverity[] = ['skipped', 'changed', 'dropped'];
const EXAMPLES_PER_GROUP = 3;
/** File-wide notes whose "source" is not a useful example. */
const NO_EXAMPLE_CODES = new Set([
  'condition_defaulted',
  'return_policy_absent',
  'encoding_fallback',
  'stock_not_public',
  'tax_display',
]);

export function summarizeLossReport(report: ImportLossReport): ImportLossSummary {
  const groups = new Map<
    string,
    { code: string; severity: ImportLossSeverity; count: number; examples: string[]; detail: string }
  >();
  for (const loss of report.losses) {
    const key = `${loss.severity}:${loss.code}`;
    const group = groups.get(key) ?? {
      code: loss.code,
      severity: loss.severity,
      count: 0,
      examples: [],
      detail: loss.detail,
    };
    group.count += loss.count;
    const example = loss.listing ?? (NO_EXAMPLE_CODES.has(loss.code) ? undefined : loss.source);
    if (example && group.examples.length < EXAMPLES_PER_GROUP && !group.examples.includes(example)) {
      group.examples.push(example);
    }
    groups.set(key, group);
  }
  const ordered: ImportLossGroup[] = [...groups.values()]
    .map((group) => ({
      code: group.code,
      severity: group.severity,
      label: lossLabel(group.code),
      count: group.count,
      examples: group.examples,
      detail: group.detail,
    }))
    .sort(
      (left, right) =>
        SEVERITY_ORDER.indexOf(left.severity) - SEVERITY_ORDER.indexOf(right.severity) || right.count - left.count,
    );
  const total = (severity: ImportLossSeverity) =>
    ordered.filter((group) => group.severity === severity).reduce((sum, group) => sum + group.count, 0);
  return {
    format: report.format,
    listingsRead: report.listingsRead,
    listingsImported: report.listingsImported,
    listingsSkipped: report.listingsSkipped,
    skipped: total('skipped'),
    dropped: total('dropped'),
    changed: total('changed'),
    groups: ordered,
  };
}

function csvCell(value: string): string {
  const protectedValue = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

export const LOSS_REPORT_CSV_HEADER = 'result,code,reason,product,column,line,rows';

/** One row per loss, formula-protected, for the merchant to keep or hand to support. */
export function lossReportToCsv(report: ImportLossReport): string {
  const lines = [LOSS_REPORT_CSV_HEADER];
  for (const loss of report.losses) {
    lines.push(
      [
        loss.severity,
        loss.code,
        loss.detail,
        loss.listing ?? '',
        loss.source,
        loss.line === undefined ? '' : String(loss.line),
        String(loss.count),
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}
