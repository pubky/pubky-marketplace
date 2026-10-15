import { COMMERCE_LISTING_MAX_IMAGES, COMMERCE_LISTING_MAX_QUANTITY } from '@/config/commerce';
import { type CsvColumns, csvColumns, type CsvRecord, type CsvTable } from './import-csv-table';
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
import { currencyExponent, type ImportSettings, majorToMinor } from './import-settings';
import { localizeWooHeaders } from './import-woo-headers';

/**
 * WooCommerce product CSV (the exporter's standard columns) to canonical
 * import rows. Pure: parsed table in, rows and a loss report out.
 */

export type WooMapInput = {
  readonly table: CsvTable;
  readonly sellerPubky: string;
  readonly settings: ImportSettings;
  readonly now: Date;
  /** The file was not UTF-8 and was read as Windows-1252. */
  readonly encodingFallback?: boolean;
};

export type WooMapResult = {
  readonly rows: readonly PresetRow[];
  readonly report: ImportLossReport;
};

/** A Woo product export in English, German, French or Italian: Type, SKU and Regular price are present. */
export function isWooProductCsv(headers: readonly string[]): boolean {
  return localizeWooHeaders(headers) !== null;
}

const MAPPED_COLUMNS = new Set([
  'id',
  'type',
  'sku',
  'name',
  'published',
  'short description',
  'description',
  'in stock?',
  'stock',
  'sale price',
  'regular price',
  'categories',
  'tags',
  'images',
  'parent',
  'date sale price starts',
  'date sale price ends',
]);

type ColumnRule = {
  readonly match: RegExp;
  readonly code: string;
  readonly detail: string;
  readonly quiet?: boolean;
  readonly meaningful?: (value: string) => boolean;
};

const COLUMN_RULES: readonly ColumnRule[] = [
  { match: /^attribute \d+ (name|value\(s\))$/, code: 'attribute', detail: '', quiet: true },
  { match: /^attribute \d+ (visible|global|default)$/, code: 'attribute', detail: '', quiet: true },
  { match: /^(position|allow customer reviews\?|tax class|is featured\?)$/, code: 'ignored', detail: '', quiet: true },
  {
    match: /^visibility in catalog$/,
    code: 'catalog_visibility',
    detail: 'Hidden catalog visibility is not imported. The listing is visible.',
    meaningful: (value) => value.toLowerCase() !== 'visible',
  },
  {
    match: /^tax status$/,
    code: 'tax',
    detail: 'Tax settings are not imported. Prices are used as listed.',
    meaningful: (value) => value.toLowerCase() !== 'none',
  },
  {
    match: /^(weight|length|width|height)\b/,
    code: 'weight',
    detail: 'Weight and size are not imported. The default package is used.',
  },
  {
    match: /^backorders allowed\?$/,
    code: 'inventory_policy',
    detail: 'Backorders are not imported. Stock is the counted stock.',
    meaningful: (value) => value !== '0' && value.toLowerCase() !== 'no',
  },
  {
    match: /^sold individually\?$/,
    code: 'inventory_policy',
    detail: 'The one-per-order limit is not imported.',
    meaningful: (value) => value === '1' || value.toLowerCase() === 'yes',
  },
  {
    match: /^low stock amount$/,
    code: 'inventory_policy',
    detail: 'The low-stock threshold is not imported.',
  },
  { match: /^purchase note$/, code: 'purchase_note', detail: 'Purchase notes are not imported.' },
  {
    match: /^shipping class$/,
    code: 'shipping_class',
    detail: 'Shipping classes are not imported. The default shipping option applies.',
  },
  {
    match: /^(upsells|cross-sells|grouped products)$/,
    code: 'related_products',
    detail: 'Product links are not imported.',
  },
  {
    match: /^(download \d+ (name|url)|download limit|download expiry days)$/,
    code: 'downloadable_files',
    detail: 'Downloadable files are not imported.',
  },
  { match: /^(external url|button text)$/, code: 'unmapped_header', detail: 'The column has no Pubky field.' },
];

function isTruthy(value: string): boolean {
  return value === '1' || /^(yes|true)$/i.test(value);
}

function splitList(value: string): string[] {
  return value
    .split(/(?<!\\),/)
    .map((part) => part.replaceAll('\\,', ',').trim())
    .filter((part) => part !== '');
}

function imageUrls(value: string): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const part of value.split(/,\s+|,(?=[a-z][a-z0-9+.-]*:\/\/)|\n/i)) {
    const candidate = part.trim();
    if (candidate === '') continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        if (!valid.includes(candidate)) valid.push(candidate);
        continue;
      }
    } catch {
      // not a URL; reported below
    }
    invalid.push(candidate);
  }
  return { valid, invalid };
}

type WooRecord = {
  readonly record: CsvRecord;
  readonly id: string;
  readonly types: readonly string[];
  readonly base: string;
  readonly sku: string;
  readonly name: string;
  readonly parent: string;
};

function readRecord(columns: CsvColumns, record: CsvRecord): WooRecord {
  const types = columns
    .read(record, 'Type')
    .toLowerCase()
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  return {
    record,
    id: columns.read(record, 'ID'),
    types,
    base: types[0] ?? '',
    sku: columns.read(record, 'SKU'),
    name: htmlToPlainText(columns.read(record, 'Name')).replace(/\s+/g, ' '),
    parent: columns.read(record, 'Parent'),
  };
}

function label(record: WooRecord): string {
  return record.name || record.sku || (record.id ? `ID ${record.id}` : `line ${record.record.line}`);
}

type PriceResult =
  | {
      ok: true;
      minor: number;
      saleApplied: boolean;
      scheduleNote: 'none' | 'applied' | 'out_of_window';
      regular: string;
      sale: string;
      from: string;
      to: string;
    }
  | { ok: false; code: string; detail: string };

function parseDate(value: string): number | null {
  if (value === '') return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function decimalCell(value: string, delimiter: string): string {
  return delimiter === ';' && /^\d+,\d+$/.test(value) ? value.replace(',', '.') : value;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function resolvePrice(
  columns: CsvColumns,
  record: CsvRecord,
  fallback: { regular: string; sale: string } | null,
  exponent: number,
  delimiter: string,
  now: Date,
): PriceResult {
  const regularRaw = decimalCell(columns.read(record, 'Regular price') || fallback?.regular || '', delimiter);
  const saleRaw = decimalCell(
    columns.read(record, 'Sale price') || (regularRaw ? '' : (fallback?.sale ?? '')),
    delimiter,
  );
  const starts = parseDate(columns.read(record, 'Date sale price starts'));
  const ends = parseDate(columns.read(record, 'Date sale price ends'));
  const scheduled =
    columns.read(record, 'Date sale price starts') !== '' || columns.read(record, 'Date sale price ends') !== '';
  const nowMs = now.getTime();
  const inWindow = (starts === null || starts <= nowMs) && (ends === null || nowMs <= ends + DAY_MS - 1);
  const useSale = saleRaw !== '' && inWindow;
  const chosen = useSale ? saleRaw : regularRaw;
  if (chosen === '') return { ok: false, code: 'price_missing', detail: 'The row has no price.' };
  const minor = majorToMinor(chosen, exponent);
  if (minor === null) {
    return {
      ok: false,
      code: 'price_scale',
      detail: `Price ${chosen} does not fit the currency's ${exponent} decimal places.`,
    };
  }
  if (minor <= 0) return { ok: false, code: 'price_zero', detail: 'A listing price must be above zero.' };
  return {
    ok: true,
    minor,
    saleApplied: useSale && regularRaw !== '',
    scheduleNote: !scheduled ? 'none' : useSale ? 'applied' : 'out_of_window',
    regular: regularRaw,
    sale: saleRaw,
    from: columns.read(record, 'Date sale price starts'),
    to: columns.read(record, 'Date sale price ends'),
  };
}

type StockResult = { quantity: number; unmanaged: boolean };

function resolveStock(columns: CsvColumns, record: CsvRecord, unmanagedStock: number): StockResult {
  const stock = columns.read(record, 'Stock');
  const inStock = columns.read(record, 'In stock?').toLowerCase();
  if (/^-?\d+(?:\.\d+)?$/.test(stock)) {
    return { quantity: Math.max(0, Math.floor(Number(stock))), unmanaged: false };
  }
  if (inStock === '0' || inStock === 'no' || inStock === 'false' || inStock === 'outofstock') {
    return { quantity: 0, unmanaged: false };
  }
  return { quantity: Math.min(unmanagedStock, COMMERCE_LISTING_MAX_QUANTITY - 1), unmanaged: true };
}

function optionsFor(
  columns: CsvColumns,
  record: CsvRecord,
  allowMulti: boolean,
): { options: Record<string, string>; droppedMulti: number } {
  const options: Record<string, string> = {};
  let droppedMulti = 0;
  for (let index = 1; index <= 24; index += 1) {
    const name = columns.read(record, `Attribute ${index} name`);
    if (name === '') {
      if (index > 3 && !columns.has(`Attribute ${index} name`)) break;
      continue;
    }
    const values = splitList(columns.read(record, `Attribute ${index} value(s)`));
    if (values.length === 0) continue;
    if (values.length > 1 && !allowMulti) {
      droppedMulti += 1;
      continue;
    }
    options[name] = values[0] as string;
  }
  return { options, droppedMulti };
}

function descriptionText(columns: CsvColumns, record: CsvRecord): string {
  const full = htmlToPlainText(columns.read(record, 'Description'));
  const short = htmlToPlainText(columns.read(record, 'Short description'));
  if (short === '') return full;
  if (full === '') return short;
  return full.includes(short) ? full : `${short}\n\n${full}`;
}

function loss(
  code: string,
  severity: ImportLoss['severity'],
  source: string,
  detail: string,
  listing: string | undefined,
  line: number | undefined,
  count = 1,
): ImportLoss {
  return {
    code,
    severity,
    source,
    detail,
    ...(listing === undefined ? {} : { listing }),
    ...(line === undefined ? {} : { line }),
    count,
  };
}

type Candidate = {
  readonly source: WooRecord;
  readonly priceMinor: number;
  readonly stock: StockResult;
  readonly enabled: boolean;
  readonly options: Record<string, string>;
};

/**
 * A variation's Parent holds the parent's SKU (Woo's own export does this, and
 * a numeric-looking SKU such as 7718 is common), or `id:N`, or a bare ID. Try
 * them in that order; only a variable product can be a parent.
 */
function resolveParent(
  reference: string,
  bySku: ReadonlyMap<string, WooRecord>,
  byId: ReadonlyMap<string, WooRecord>,
): WooRecord | undefined {
  if (reference === '') return undefined;
  const candidates: (WooRecord | undefined)[] = [bySku.get(reference) ?? bySku.get(reference.toLowerCase())];
  const idReference = /^id:\s*(\d+)$/i.exec(reference);
  if (idReference) candidates.push(byId.get(idReference[1] as string));
  if (/^\d+$/.test(reference)) candidates.push(byId.get(reference));
  return candidates.find((candidate) => candidate?.base === 'variable');
}

export function mapWooProductCsv(input: WooMapInput): WooMapResult {
  const { table, sellerPubky, settings, now } = input;
  const localized = localizeWooHeaders(table.headers);
  if (!localized) {
    return {
      rows: [],
      report: {
        format: 'woocommerce',
        listingsRead: 0,
        listingsImported: 0,
        listingsSkipped: 0,
        losses: [
          loss(
            'unknown_language',
            'skipped',
            'Header',
            'The column headers are not in English, German, French or Italian, so no column could be read.',
            undefined,
            1,
          ),
        ],
      },
    };
  }
  const columns = csvColumns(localized.headers);
  const exponent = currencyExponent(settings.currency);
  const losses: ImportLoss[] = [];
  const records = table.records.map((record) => readRecord(columns, record));

  const parents = records.filter((record) => record.base !== 'variation');
  const variations = records.filter((record) => record.base === 'variation');
  const byId = new Map<string, WooRecord>();
  const bySku = new Map<string, WooRecord>();
  for (const parent of parents) {
    if (parent.id !== '') byId.set(parent.id, parent);
    if (parent.sku !== '') {
      bySku.set(parent.sku, parent);
      if (!bySku.has(parent.sku.toLowerCase())) bySku.set(parent.sku.toLowerCase(), parent);
    }
  }
  const childrenOf = new Map<WooRecord, WooRecord[]>();
  const orphans: WooRecord[] = [];
  for (const variation of variations) {
    const parent = resolveParent(variation.parent, bySku, byId);
    if (!parent) {
      orphans.push(variation);
      continue;
    }
    const list = childrenOf.get(parent) ?? [];
    list.push(variation);
    childrenOf.set(parent, list);
  }

  for (const orphan of orphans) {
    losses.push(
      loss(
        'variation_orphan',
        'skipped',
        'Parent',
        orphan.parent === ''
          ? 'The variation names no parent product.'
          : `The parent ${orphan.parent} is not a variable product in this file.`,
        label(orphan),
        orphan.record.line,
      ),
    );
  }

  const rows: PresetRow[] = [];
  const labels = new Map<string, string>();
  const lines = new Map<string, number>();
  const usedIds = new Set<string>();
  const listingOfSource = new Map<WooRecord, string>();
  let listingsRead = orphans.length;

  const nextListingId = (parent: WooRecord, position: number): string => {
    let candidate = entityIdFrom(parent.sku) || (parent.id ? `woo-${parent.id}` : entityIdFrom(parent.name));
    if (candidate === '') candidate = `woo-line-${position}`;
    if (usedIds.has(candidate)) candidate = `${candidate}-${parent.id || position}`.slice(0, 128);
    usedIds.add(candidate);
    return candidate;
  };

  parents.forEach((parent, position) => {
    listingsRead += 1;
    const name = label(parent);
    const line = parent.record.line;
    if (parent.base !== 'simple' && parent.base !== 'variable') {
      losses.push(
        loss(
          'unsupported_type',
          'skipped',
          'Type',
          parent.base === 'grouped' || parent.base === 'external'
            ? `${parent.base === 'grouped' ? 'Grouped' : 'External'} products have no price or stock of their own, so they are not imported.`
            : `Product type "${parent.base || 'unknown'}" is not supported.`,
          name,
          line,
        ),
      );
      return;
    }

    const candidates: Candidate[] = [];
    const sources = parent.base === 'variable' ? (childrenOf.get(parent) ?? []) : [parent];
    if (parent.base === 'variable' && sources.length === 0) {
      losses.push(loss('no_variations', 'skipped', 'Type', 'The variable product has no variation rows.', name, line));
      return;
    }
    const inherited = {
      regular: columns.read(parent.record, 'Regular price'),
      sale: columns.read(parent.record, 'Sale price'),
    };
    let listingFailed = false;
    for (const source of sources) {
      const price = resolvePrice(
        columns,
        source.record,
        parent.base === 'variable' ? inherited : null,
        exponent,
        table.delimiter,
        now,
      );
      if (!price.ok) {
        losses.push(loss(price.code, 'skipped', 'Regular price', price.detail, label(source), source.record.line));
        if (parent.base === 'simple') listingFailed = true;
        continue;
      }
      if (price.saleApplied) {
        losses.push(
          loss(
            'compare_at_price',
            'dropped',
            'Regular price',
            `Regular price ${price.regular} dropped; sale price ${price.sale} used.`,
            label(source),
            source.record.line,
          ),
        );
      }
      if (price.scheduleNote !== 'none') {
        losses.push(
          loss(
            'sale_schedule',
            price.scheduleNote === 'applied' ? 'dropped' : 'changed',
            'Date sale price starts',
            price.scheduleNote === 'applied'
              ? `Sale price ${price.sale} applied while active (${price.from || 'any time'} to ${price.to || 'no end'}). The schedule itself is not imported.`
              : `Regular price ${price.regular} applied. Sale price ${price.sale} is not active (${price.from || 'any time'} to ${price.to || 'no end'}).`,
            label(source),
            source.record.line,
          ),
        );
      }
      const stock = resolveStock(columns, source.record, settings.unmanagedStock);
      if (stock.unmanaged) {
        losses.push(
          loss(
            'stock_unmanaged',
            'changed',
            'Stock',
            `Stock unknown, set to ${stock.quantity}.`,
            label(source),
            source.record.line,
          ),
        );
      }
      const attributes = optionsFor(columns, source.record, parent.base === 'variable');
      if (attributes.droppedMulti > 0) {
        losses.push(
          loss(
            'attribute_dropped',
            'dropped',
            'Attribute 1 value(s)',
            'A simple product lists several values for an attribute; it is not a choice a buyer makes.',
            label(source),
            source.record.line,
          ),
        );
      }
      const published = columns.read(source.record, 'Published');
      candidates.push({
        source,
        priceMinor: price.minor,
        stock,
        enabled: source === parent ? true : published !== '0',
        options: attributes.options,
      });
    }
    if (listingFailed || candidates.length === 0) return;

    const id = nextListingId(parent, position);
    labels.set(id, name);
    lines.set(id, line);
    const listingPrice = Math.min(...candidates.map((candidate) => candidate.priceMinor));

    const published = columns.read(parent.record, 'Published');
    const state = published === '' || isTruthy(published) ? 'active' : 'paused';
    if (state === 'paused') {
      losses.push(
        loss(
          'draft_paused',
          'changed',
          'Published',
          published === '-1'
            ? 'A private product is imported as a paused listing.'
            : 'A draft is imported as a paused listing.',
          name,
          line,
        ),
      );
    }

    const categories = splitList(columns.read(parent.record, 'Categories'));
    const category = categories[0] ?? '';
    if (category === '') {
      losses.push(
        loss('category_absent', 'changed', 'Categories', 'No category, so the listing is uncategorized.', name, line),
      );
    }
    const categoryTags = categories.slice(1).map((entry) => entry.split('>').pop()?.trim() ?? entry);
    const tags = [...splitList(columns.read(parent.record, 'Tags')), ...categoryTags];
    const description = descriptionText(columns, parent.record);

    const imageSources = [parent, ...(parent.base === 'variable' ? sources : [])];
    const found: string[] = [];
    const invalid: string[] = [];
    for (const source of imageSources) {
      const urls = imageUrls(columns.read(source.record, 'Images'));
      for (const url of urls.valid) if (!found.includes(url)) found.push(url);
      invalid.push(...urls.invalid);
    }
    if (invalid.length > 0) {
      losses.push(
        loss(
          'image_url_invalid',
          'dropped',
          'Images',
          `${invalid.length} image entr${invalid.length === 1 ? 'y is' : 'ies are'} not a web link.`,
          name,
          line,
          invalid.length,
        ),
      );
    }
    const kept = found.slice(0, COMMERCE_LISTING_MAX_IMAGES);
    if (found.length > kept.length) {
      losses.push(
        loss(
          'image_overflow',
          'dropped',
          'Images',
          `A listing holds at most ${COMMERCE_LISTING_MAX_IMAGES} photos.`,
          name,
          line,
          found.length - kept.length,
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
          name,
          line,
          kept.length,
        ),
      );
    }
    const images: SourceImage[] = kept.map((url) => ({ url, alt: name }));
    for (const source of parent.base === 'variable' ? [parent, ...sources] : [parent]) listingOfSource.set(source, id);

    const recordUri = `pubky://${sellerPubky}/pub/pubky.app/marketplace/v1/listings/${id}`;
    const usedVariantIds = new Set<string>();
    candidates.forEach((candidate, index) => {
      let variantId =
        entityIdFrom(candidate.source.sku) || (candidate.source.id ? `v${candidate.source.id}` : `v${index + 1}`);
      if (usedVariantIds.has(variantId)) variantId = `${variantId}-${index + 1}`;
      usedVariantIds.add(variantId);
      const extra: Record<string, string> = {};
      if (candidate.priceMinor !== listingPrice) extra[VARIANT_PRICE_MINOR_FIELD] = String(candidate.priceMinor);
      if (candidate.source !== parent && candidate.source.id !== '') {
        extra.external_variant_id = `woo:${candidate.source.id}`;
      }
      rows.push({
        recordUri,
        sellerPubky,
        listingId: id,
        sourceListingKey: `woo:${parent.sku || parent.id || id}`,
        // A shop-system file has no revision to compare, so a re-import is never a conflict with the listing's own edits.
        recordRevision: null,
        variantId,
        sku: candidate.source.sku,
        state,
        title: parent.name,
        description,
        taxonomy: {},
        category,
        condition: settings.condition,
        tags,
        amountMinor: listingPrice,
        currency: settings.currency,
        exponent,
        variantQuantity: candidate.stock.quantity,
        variantEnabled: candidate.enabled,
        options: candidate.options,
        media: [],
        shippingOptions: [],
        returnPolicy: { accepted: false },
        sale: { format: 'fixed_price' },
        externalRefs: {
          channel: 'woocommerce',
          external_id: `woo:${parent.id || parent.sku || id}`,
          ...(parent.sku !== '' ? { sku: parent.sku } : {}),
        },
        extraFields: withSourceImages(extra, images),
      });
    });
  });

  const finalized = finalizePresetRows({
    rows,
    settings,
    labelFor: (id) => labels.get(id) ?? id,
    lineFor: (id) => lines.get(id),
  });
  losses.push(...finalized.losses);

  const imported = new Set(finalized.rows.map((row) => row.listingId));
  const importedRecords = [...listingOfSource].filter(([, id]) => imported.has(id)).map(([source]) => source);
  losses.push(...columnLosses(localized.headers, table.headers, columns, importedRecords));
  if (imported.size > 0) {
    losses.push(
      loss(
        'condition_defaulted',
        'changed',
        'Condition',
        `WooCommerce has no condition. Every listing is set to "${settings.condition.replaceAll('_', ' ')}".`,
        undefined,
        undefined,
        imported.size,
      ),
      loss(
        'return_policy_absent',
        'dropped',
        'Return policy',
        'WooCommerce has no return policy, so listings accept no returns.',
        undefined,
        undefined,
        imported.size,
      ),
    );
  }
  if (input.encodingFallback) {
    losses.push(
      loss(
        'encoding_fallback',
        'changed',
        'File',
        'The file is not UTF-8, so it was read as Windows-1252. Check accents in titles.',
        undefined,
        undefined,
      ),
    );
  }

  return {
    rows: finalized.rows,
    report: {
      format: 'woocommerce',
      listingsRead,
      listingsImported: imported.size,
      listingsSkipped: listingsRead - imported.size,
      losses,
    },
  };
}

function columnLosses(
  headers: readonly string[],
  originalHeaders: readonly string[],
  columns: CsvColumns,
  sources: readonly WooRecord[],
): ImportLoss[] {
  const out: ImportLoss[] = [];
  const grouped = new Map<string, { rule: ColumnRule; headers: string[]; rows: Set<WooRecord> }>();
  for (const [position, header] of headers.entries()) {
    const shown = originalHeaders[position] ?? header;
    const key = header.toLowerCase();
    if (MAPPED_COLUMNS.has(key) || key === '') continue;
    const rule = COLUMN_RULES.find((candidate) => candidate.match.test(key));
    if (rule?.quiet) continue;
    const meaningful = rule?.meaningful ?? ((value: string) => value !== '');
    const rows = sources.filter((source) => meaningful(columns.read(source.record, header)));
    if (rows.length === 0) continue;
    if (!rule || rule.code === 'unmapped_header') {
      out.push(
        loss(
          'unmapped_header',
          'dropped',
          shown,
          `The column has no Pubky field and was not imported. ${rows.length} row${rows.length === 1 ? ' has' : 's have'} a value.`,
          undefined,
          undefined,
        ),
      );
      continue;
    }
    const entry = grouped.get(rule.code) ?? { rule, headers: [], rows: new Set<WooRecord>() };
    entry.headers.push(shown);
    for (const row of rows) entry.rows.add(row);
    grouped.set(rule.code, entry);
  }
  for (const [code, entry] of grouped) {
    out.push(loss(code, 'dropped', entry.headers.join(', '), entry.rule.detail, undefined, undefined, entry.rows.size));
  }
  return out;
}
