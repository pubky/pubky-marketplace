import {
  ALLOWED_CHECKPOINT_TRANSITIONS,
  browserFileSource,
  type CanonicalCsvRow,
  canonicalCsvRowIdentity,
  type CheckpointImportResult,
  chunkSyncManyListings,
  classifySyncManyItem,
  type CurrentImportItem,
  DEFAULT_CSV_LIMITS,
  DEFAULT_JSON_LIMITS,
  type DryRunCounts,
  dryRunCounts,
  exportCanonicalCsv,
  type ImportCheckpoint,
  type ImportManifest,
  type InventoryAdjustmentEnvelope,
  type InventoryAdjustRequest,
  type InventoryProjection,
  listingIdentity,
  type LosslessJsonObject,
  type ManifestStore,
  normalizedCsvRowHash,
  parseBoundedJson,
  parseCanonicalCsvStream,
  planImport,
  planImportStream,
  type PlannedImportRow,
  PubkyShopClient,
  PubkyShopError,
  type ResumeTask,
  resumeTasks,
  type SdkResult,
  streamResumeTasks,
  SYNC_MANY_LIMIT,
  type SyncManyClassification,
  type SyncManyEnvelope,
  type SyncManyListing,
} from '@bitcoinerrorlog/pubky-shop';
import {
  canonicalRowsFor,
  mapShopifyProductCsv,
  SHOPIFY_PRODUCT_CSV_HEADERS,
} from '@bitcoinerrorlog/pubky-shop/connectors/shopify/map';
import { getMarketplaceUrl } from '@/config/commerce';
import { csvHeaderCells, parseCsvTable } from '@/pipes/commerce/import-csv-table';
import type { ImportLossReport, ImportSourceFormat } from '@/pipes/commerce/import-loss-report';
import type { PresetRow } from '@/pipes/commerce/import-preset-rows';
import { type ImportSettings, shopifyWorkExponent } from '@/pipes/commerce/import-settings';
import { buildShopifyPresetRows } from '@/pipes/commerce/import-shopify-csv';
import { isWooProductCsv, mapWooProductCsv } from '@/pipes/commerce/import-woo-csv';
import { looksLikeUnknownLanguageWooExport, WOO_UNKNOWN_LANGUAGE_MESSAGE } from '@/pipes/commerce/import-woo-headers';
import { mapWooStoreCatalog, type WooStoreCatalog } from '@/pipes/commerce/import-woo-store';
import type { InventoryManifestStore } from '@/services/marketplace/marketplace-import-store';

/**
 * The only Shop module that imports `@bitcoinerrorlog/pubky-shop`. Components
 * and hooks go through controllers. The `.` export is the inventory client.
 * Shopify CSV detection uses the browser-safe `connectors/shopify/map` entry
 * so the bridge's node modules stay out of this graph.
 */

/** What a shop-system CSV preset needs: whose listings these are and the dry-run import settings. */
export type PresetImportConfig = {
  readonly sellerPubky: string;
  readonly settings: ImportSettings;
};

/** What a store import needs beyond the preset config: the currencies a listing can be priced in. */
export type StoreImportConfig = PresetImportConfig & { readonly offeredCurrencies: readonly string[] };

export type PlannedStoreCatalog =
  | { readonly ok: true; readonly value: PlannedBrowserFile }
  | { readonly ok: false; readonly message: string };

export type ShopBrowserFile = {
  readonly size: number;
  readonly name?: string;
  readonly type?: string;
  stream(): ReadableStream<Uint8Array>;
  arrayBuffer(): Promise<ArrayBuffer>;
  slice(start?: number, end?: number, contentType?: string): { arrayBuffer(): Promise<ArrayBuffer> };
};

export type PlannedBrowserFile = {
  readonly manifestId: string;
  readonly rowCount: number;
  /** Set when the file was a shop-system export mapped by a preset. */
  readonly format?: ImportSourceFormat;
  readonly lossReport?: ImportLossReport;
};

const SHOPIFY_HEADER_SET = new Set<string>(SHOPIFY_PRODUCT_CSV_HEADERS);

function headerCellsOf(bytes: Uint8Array): readonly string[] {
  return csvHeaderCells(new TextDecoder('utf-8').decode(bytes));
}

function isShopifyProductCsv(cells: readonly string[]): boolean {
  if (cells.includes('record_uri')) return false;
  const hits = cells.filter((cell) => SHOPIFY_HEADER_SET.has(cell));
  return hits.includes('URL handle') || hits.includes('Handle');
}

function limitError(field: string, limit: number, observed: number): PubkyShopError {
  return new PubkyShopError('limit_exceeded', { field, limit, observed: Math.min(observed, limit + 1) });
}

async function readCsvBytes(file: ShopBrowserFile): Promise<SdkResult<Uint8Array>> {
  if (!Number.isSafeInteger(file.size) || file.size < 0) {
    return { ok: false, error: new PubkyShopError('invalid_configuration', { field: 'file.size' }) };
  }
  if (file.size > DEFAULT_CSV_LIMITS.maxBytes) {
    return { ok: false, error: limitError('csv_bytes', DEFAULT_CSV_LIMITS.maxBytes, file.size) };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > DEFAULT_CSV_LIMITS.maxBytes) {
    return { ok: false, error: limitError('csv_bytes', DEFAULT_CSV_LIMITS.maxBytes, bytes.byteLength) };
  }
  return { ok: true, value: bytes };
}

/**
 * Plans mapped preset rows as JSON. The CSV stream parser rejects Uint8Array
 * chunks from another realm, which this app's bundler produces, so presets
 * hand the planner the same JSON a canonical JSON import would.
 */
async function planPresetRows(
  rows: readonly PresetRow[],
  report: ImportLossReport,
  manifestStore: ManifestStore,
  store: InventoryManifestStore,
  currentItems: Readonly<Record<string, CurrentImportItem>>,
): Promise<SdkResult<PlannedBrowserFile>> {
  const json = new TextEncoder().encode(JSON.stringify(rows));
  if (json.byteLength > DEFAULT_JSON_LIMITS.maxBytes) {
    return { ok: false, error: limitError('json_bytes', DEFAULT_JSON_LIMITS.maxBytes, json.byteLength) };
  }
  const planned = await planImport(json, {
    store: manifestStore,
    currentItems,
    limits: { maxBytes: DEFAULT_JSON_LIMITS.maxBytes },
  });
  if (!planned.ok) return planned;
  const payloads = jsonPayloads(parseBoundedJson(json, { maxBytes: DEFAULT_JSON_LIMITS.maxBytes }));
  await store.persistPayloads(planned.value.manifestId, payloads);
  return {
    ok: true,
    value: {
      manifestId: planned.value.manifestId,
      rowCount: planned.value.rowCount,
      format: report.format,
      lossReport: report,
    },
  };
}

function presetRowsFrom(rows: unknown): PresetRow[] {
  return JSON.parse(JSON.stringify(rows)) as PresetRow[];
}

async function planShopifyProductCsv(
  file: ShopBrowserFile,
  manifestStore: ManifestStore,
  store: InventoryManifestStore,
  currentItems: Readonly<Record<string, CurrentImportItem>>,
  config: PresetImportConfig,
): Promise<SdkResult<PlannedBrowserFile>> {
  const read = await readCsvBytes(file);
  if (!read.ok) return read;
  const workExponent = shopifyWorkExponent(config.settings.currency);
  const mapped = mapShopifyProductCsv(read.value, {
    sellerPubky: config.sellerPubky,
    currency: config.settings.currency,
    exponent: workExponent,
  });
  const sdkRows = mapped.products.flatMap((product) => canonicalRowsFor(product, [], { includeZeroQuantity: true }));
  const result = buildShopifyPresetRows({
    text: new TextDecoder('utf-8').decode(read.value),
    products: mapped.products,
    skipped: mapped.skipped,
    headerLosses: mapped.headerLosses,
    rows: presetRowsFrom(sdkRows),
    workExponent,
    settings: config.settings,
  });
  return planPresetRows(result.rows, result.report, manifestStore, store, currentItems);
}

function decodeWooCsv(bytes: Uint8Array): { text: string; encodingFallback: boolean } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encodingFallback: false };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encodingFallback: true };
  }
}

async function planWooProductCsv(
  file: ShopBrowserFile,
  manifestStore: ManifestStore,
  store: InventoryManifestStore,
  currentItems: Readonly<Record<string, CurrentImportItem>>,
  config: PresetImportConfig,
): Promise<SdkResult<PlannedBrowserFile>> {
  const read = await readCsvBytes(file);
  if (!read.ok) return read;
  const decoded = decodeWooCsv(read.value);
  const parsed = parseCsvTable(decoded.text);
  if (!parsed.ok) return { ok: false, error: new PubkyShopError('malformed_csv') };
  const { table } = parsed;
  if (table.headers.length > DEFAULT_CSV_LIMITS.maxColumns) {
    return { ok: false, error: limitError('csv_columns', DEFAULT_CSV_LIMITS.maxColumns, table.headers.length) };
  }
  if (table.records.length > DEFAULT_CSV_LIMITS.maxRows) {
    return { ok: false, error: limitError('csv_rows', DEFAULT_CSV_LIMITS.maxRows, table.records.length) };
  }
  const result = mapWooProductCsv({
    table,
    sellerPubky: config.sellerPubky,
    settings: config.settings,
    now: new Date(),
    encodingFallback: decoded.encodingFallback,
  });
  return planPresetRows(result.rows, result.report, manifestStore, store, currentItems);
}

const JSON_LEAD = new Set([0x7b, 0x5b]);

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstNonWs(bytes: Uint8Array): number | undefined {
  for (const byte of bytes) {
    if (byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x20) return byte;
  }
  return undefined;
}

function namedJson(file: ShopBrowserFile): boolean {
  const name = file.name?.toLowerCase() ?? '';
  const type = file.type?.toLowerCase() ?? '';
  return name.endsWith('.json') || type.includes('json');
}

async function peekLooksLikeJson(file: ShopBrowserFile): Promise<boolean> {
  if (namedJson(file)) return true;
  if (!Number.isSafeInteger(file.size) || file.size <= 0) return false;
  const peek = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const lead = firstNonWs(peek);
  return lead !== undefined && JSON_LEAD.has(lead);
}

/** Same prefix as SDK `exportCanonicalCsv` / `formulaProtected`. */
const FORMULA_PREFIX = /^[=+\-@]/;
const FORMULA_IDENTITY_KEYS = new Set([
  'listingId',
  'listing_id',
  'sellerPubky',
  'seller_pubky',
  'recordUri',
  'record_uri',
  'variantId',
  'variant_id',
  'rowIdentity',
]);

function formulaProtected(value: string): string {
  if (value.startsWith("'") || FORMULA_PREFIX.test(value)) {
    return `'${value}`;
  }
  return value;
}

function quoteFormulaStrings(value: unknown, key?: string): unknown {
  if (typeof value === 'string') {
    return key !== undefined && FORMULA_IDENTITY_KEYS.has(key) ? value : formulaProtected(value);
  }
  if (Array.isArray(value)) return value.map((entry) => quoteFormulaStrings(entry));
  const object = asObject(value);
  if (!object) return value;
  const next: Record<string, unknown> = {};
  for (const [field, entry] of Object.entries(object)) {
    next[field] = quoteFormulaStrings(entry, field);
  }
  return next;
}

function jsonPayloads(value: unknown): Map<string, string> {
  const items = Array.isArray(value)
    ? value
    : asObject(value) && Array.isArray(asObject(value)?.rows)
      ? (asObject(value)?.rows as unknown[])
      : [];
  const payloads = new Map<string, string>();
  for (const item of items) {
    const object = asObject(item);
    if (!object) continue;
    const row = object as unknown as CanonicalCsvRow;
    payloads.set(canonicalCsvRowIdentity(row), JSON.stringify(quoteFormulaStrings(object)));
  }
  return payloads;
}

export class MarketplaceShopClientService {
  private constructor() {}

  static serviceOrigin(): string {
    return new URL(getMarketplaceUrl()).origin;
  }

  static createInventoryClient(session: string): PubkyShopClient {
    return new PubkyShopClient({
      session,
      serviceUrl: this.serviceOrigin(),
      // Chromium throws "Illegal invocation" when Window.fetch runs with `this`
      // bound to PubkyShopClient. Node fetch does not, which hid the board crash.
      fetch: globalThis.fetch.bind(globalThis),
    });
  }

  static isCapabilityRequired(error: PubkyShopError): boolean {
    return error.code === 'service_error' && error.details.serviceCode === 'capability_required';
  }

  static isRevisionConflict(error: PubkyShopError): boolean {
    return error.code === 'service_error' && error.details.serviceCode === 'revision_conflict';
  }

  static isSessionRejected(error: PubkyShopError): boolean {
    return error.code === 'session_rejected';
  }

  static isRateLimited(error: PubkyShopError): boolean {
    return (
      error.details.status === 429 || (error.code === 'service_error' && error.details.serviceCode === 'rate_limited')
    );
  }

  static formatPlanFailure(error: PubkyShopError): string {
    if (error.code === 'invalid_csv_header' && error.details.field === 'woo_language') {
      return WOO_UNKNOWN_LANGUAGE_MESSAGE;
    }
    if (error.code === 'limit_exceeded') {
      const limit = error.details.limit ?? 0;
      const observed = error.details.observed ?? 0;
      return `This file exceeds ${limit} (${observed}).`;
    }
    return 'This file could not be planned. Nothing was published.';
  }

  /**
   * Plans a WooCommerce store's public catalogue (read through the Store API)
   * as preset rows, the same way a CSV preset's rows are planned. A refusal
   * that is not an SDK error (a store currency the listing form does not
   * offer) comes back as a message, with nothing planned.
   */
  static async planStoreCatalog(
    catalog: WooStoreCatalog,
    store: InventoryManifestStore,
    currentItems: Readonly<Record<string, CurrentImportItem>>,
    config: StoreImportConfig,
  ): Promise<PlannedStoreCatalog> {
    const mapped = mapWooStoreCatalog({
      catalog,
      sellerPubky: config.sellerPubky,
      settings: config.settings,
      offeredCurrencies: config.offeredCurrencies,
    });
    if (!mapped.ok) return { ok: false, message: mapped.message };
    try {
      const planned = await planPresetRows(
        mapped.rows,
        mapped.report,
        store as unknown as ManifestStore,
        store,
        currentItems,
      );
      return planned.ok ? planned : { ok: false, message: this.formatPlanFailure(planned.error) };
    } catch {
      return { ok: false, message: 'This catalogue could not be planned. Nothing was published.' };
    }
  }

  static formatRateLimitCopy(error: PubkyShopError): string {
    const retryAfter = (error.details as { retryAfter?: number }).retryAfter;
    const wait = typeof retryAfter === 'number' && Number.isFinite(retryAfter) ? String(retryAfter) : 'a few';
    return `Too many inventory requests. Wait ${wait} seconds.`;
  }

  static async listSellerListings(
    client: PubkyShopClient,
    pubky: string,
    query: { cursor?: string; limit?: number } = {},
  ): Promise<SdkResult<LosslessJsonObject>> {
    return client.listings(pubky, query);
  }

  static async listSellerOrders(
    client: PubkyShopClient,
    pubky: string,
    query: { cursor?: string; limit?: number } = {},
  ): Promise<SdkResult<LosslessJsonObject>> {
    return client.orders(pubky, query);
  }

  static async listSessions(client: PubkyShopClient): Promise<SdkResult<LosslessJsonObject>> {
    return client.listSessions();
  }

  static async revokeSession(client: PubkyShopClient, id: string): Promise<SdkResult<null>> {
    return client.revokeSession(id);
  }

  static async addWebhook(client: PubkyShopClient, url: string): Promise<SdkResult<LosslessJsonObject>> {
    return client.addWebhook(url);
  }

  static async rotateWebhook(client: PubkyShopClient, id: string): Promise<SdkResult<LosslessJsonObject>> {
    return client.rotateWebhook(id);
  }

  static async deleteWebhook(client: PubkyShopClient, id: string): Promise<SdkResult<null>> {
    return client.deleteWebhook(id);
  }

  static async getInventoryProjection(
    client: PubkyShopClient,
    aggregateId: string,
  ): Promise<SdkResult<InventoryProjection>> {
    return client.getInventoryProjection(aggregateId);
  }

  static async adjustInventory(
    client: PubkyShopClient,
    request: InventoryAdjustRequest,
  ): Promise<SdkResult<InventoryAdjustmentEnvelope>> {
    return client.adjustInventory(request);
  }

  static async syncMany(
    client: PubkyShopClient,
    listings: readonly SyncManyListing[],
  ): Promise<SdkResult<SyncManyEnvelope>> {
    return client.syncMany(listings);
  }

  static chunkSyncMany(listings: readonly SyncManyListing[]): SyncManyListing[][] {
    return chunkSyncManyListings(listings, SYNC_MANY_LIMIT);
  }

  static classifySyncItem(item: unknown): SyncManyClassification {
    return classifySyncManyItem(item);
  }

  static dryRunCounts(manifest: ImportManifest): DryRunCounts {
    return dryRunCounts(manifest);
  }

  static resumeTasks(manifest: ImportManifest): readonly ResumeTask[] {
    return resumeTasks(manifest);
  }

  static streamResumeTasks(store: ManifestStore, manifestId: string): AsyncGenerator<ResumeTask> {
    return streamResumeTasks(store, manifestId);
  }

  static listingIdentity(row: CanonicalCsvRow): string {
    return listingIdentity(row);
  }

  static rowIdentity(row: CanonicalCsvRow): string {
    return canonicalCsvRowIdentity(row);
  }

  static rowHash(row: CanonicalCsvRow): string {
    return normalizedCsvRowHash(row);
  }

  static currentItemsFromRows(rows: readonly CanonicalCsvRow[]): Record<string, CurrentImportItem> {
    const items: Record<string, CurrentImportItem> = {};
    for (const row of rows) {
      items[canonicalCsvRowIdentity(row)] = {
        normalizedHash: normalizedCsvRowHash(row),
        recordRevision: row.recordRevision && row.recordRevision > 0 ? row.recordRevision : 1,
      };
    }
    return items;
  }

  static exportListingsCsv(rows: readonly CanonicalCsvRow[]): Uint8Array {
    return exportCanonicalCsv(rows);
  }

  /**
   * One checkpoint hop through the store's incremental `patchRow`: one row and
   * the manifest version are written, never the whole manifest. This is the
   * SDK's own `checkpointImportRow` step (its transition table, the manifest
   * version guard and the result check), done here because SDK 0.1.6 only knows
   * `compareAndSwap`. Once Shop depends on an SDK whose `ManifestStore` has the
   * optional `patchRow`, this becomes `checkpointImportRow(store, …)` again.
   */
  static async checkpointRow(
    store: InventoryManifestStore,
    manifestId: string,
    expectedManifestVersion: number,
    rowIdentity: string,
    checkpoint: ImportCheckpoint,
    failureCode?: PlannedImportRow['failureCode'],
  ): Promise<SdkResult<CheckpointImportResult>> {
    const step = (row: PlannedImportRow): PlannedImportRow => {
      if (!ALLOWED_CHECKPOINT_TRANSITIONS[row.checkpoint].includes(checkpoint)) {
        throw new PubkyShopError('manifest_store_error', { manifestId, rowIdentity });
      }
      return failureCode === undefined ? { ...row, checkpoint } : { ...row, checkpoint, failureCode };
    };
    try {
      const patched = (await store.patchRow(
        manifestId,
        expectedManifestVersion,
        rowIdentity,
        step as unknown as Parameters<InventoryManifestStore['patchRow']>[3],
      )) as unknown as CheckpointImportResult;
      if (
        patched.row.rowIdentity !== rowIdentity ||
        patched.row.checkpoint !== checkpoint ||
        patched.manifest.manifestId !== manifestId ||
        patched.manifest.manifestVersion !== expectedManifestVersion + 1
      ) {
        throw new PubkyShopError('manifest_store_error', { manifestId, rowIdentity });
      }
      return { ok: true, value: patched };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof PubkyShopError ? error : new PubkyShopError('manifest_store_error', { manifestId }),
      };
    }
  }

  /**
   * Browser planner. JSON is size-checked then bounded `arrayBuffer` (16 MiB).
   * A Shopify or WooCommerce product CSV is mapped to canonical rows by its
   * preset and planned as that JSON, with a loss report.
   * Other CSV streams via `browserFileSource` (64 MiB) and never calls unbounded
   * `File.arrayBuffer()`. D6.19: parse failure never reaches `store.create`.
   */
  static async planBrowserFile(
    file: ShopBrowserFile,
    store: InventoryManifestStore,
    currentItems: Readonly<Record<string, CurrentImportItem>> = {},
    preset: PresetImportConfig | undefined = undefined,
  ): Promise<SdkResult<PlannedBrowserFile>> {
    const manifestStore = store as unknown as ManifestStore;
    try {
      if (await peekLooksLikeJson(file)) {
        if (!Number.isSafeInteger(file.size) || file.size < 0) {
          return {
            ok: false,
            error: new PubkyShopError('invalid_configuration', { field: 'file.size' }),
          };
        }
        if (file.size > DEFAULT_JSON_LIMITS.maxBytes) {
          return {
            ok: false,
            error: new PubkyShopError('limit_exceeded', {
              field: 'json_bytes',
              limit: DEFAULT_JSON_LIMITS.maxBytes,
              observed: Math.min(file.size, DEFAULT_JSON_LIMITS.maxBytes + 1),
            }),
          };
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes.byteLength > DEFAULT_JSON_LIMITS.maxBytes) {
          return {
            ok: false,
            error: new PubkyShopError('limit_exceeded', {
              field: 'json_bytes',
              limit: DEFAULT_JSON_LIMITS.maxBytes,
              observed: Math.min(bytes.byteLength, DEFAULT_JSON_LIMITS.maxBytes + 1),
            }),
          };
        }
        const planned = await planImport(bytes, {
          store: manifestStore,
          currentItems,
          limits: { maxBytes: DEFAULT_JSON_LIMITS.maxBytes },
        });
        if (!planned.ok) return planned;
        const payloads = jsonPayloads(parseBoundedJson(bytes, { maxBytes: DEFAULT_JSON_LIMITS.maxBytes }));
        await store.persistPayloads(planned.value.manifestId, payloads);
        return { ok: true, value: { manifestId: planned.value.manifestId, rowCount: planned.value.rowCount } };
      }

      const headerEnd = Number.isSafeInteger(file.size) && file.size > 0 ? Math.min(file.size, 8192) : 0;
      if (headerEnd > 0) {
        const headerBytes = new Uint8Array(await file.slice(0, headerEnd).arrayBuffer());
        const header = headerCellsOf(headerBytes);
        const shopify = isShopifyProductCsv(header);
        if (!shopify && looksLikeUnknownLanguageWooExport(header)) {
          return { ok: false, error: new PubkyShopError('invalid_csv_header', { field: 'woo_language' }) };
        }
        if (shopify || isWooProductCsv(header)) {
          if (!preset) {
            return { ok: false, error: new PubkyShopError('invalid_configuration', { field: 'sellerPubky' }) };
          }
          return shopify
            ? await planShopifyProductCsv(file, manifestStore, store, currentItems, preset)
            : await planWooProductCsv(file, manifestStore, store, currentItems, preset);
        }
      }

      const source = browserFileSource(file, DEFAULT_CSV_LIMITS.maxBytes);
      const planned = await planImportStream(source, { store: manifestStore, currentItems });
      if (!planned.ok) return planned;
      const payloads = new Map<string, string>();
      await parseCanonicalCsvStream(browserFileSource(file, DEFAULT_CSV_LIMITS.maxBytes), (row) => {
        payloads.set(canonicalCsvRowIdentity(row), JSON.stringify(row));
      });
      await store.persistPayloads(planned.value.manifest.manifestId, payloads);
      return {
        ok: true,
        value: { manifestId: planned.value.manifest.manifestId, rowCount: planned.value.resourceUsage.rowCount },
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof PubkyShopError ? error : new PubkyShopError('malformed_csv'),
      };
    }
  }
}

export { DEFAULT_CSV_LIMITS, DEFAULT_JSON_LIMITS, PubkyShopError, SYNC_MANY_LIMIT };
export type {
  CanonicalCsvRow,
  CurrentImportItem,
  DryRunCounts,
  ImportCheckpoint,
  ImportManifest,
  InventoryAdjustRequest,
  InventoryProjection,
  LosslessJsonObject,
  PlannedImportRow,
  ResumeTask,
  SdkResult,
  SyncManyClassification,
  SyncManyEnvelope,
  SyncManyListing,
};
