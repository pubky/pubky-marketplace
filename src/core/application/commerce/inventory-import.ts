import { CommerceApplication } from '@/application/commerce/commerce';
import { CommerceDeliveryKeysApplication } from '@/application/commerce/delivery-keys';
import {
  type CanonicalImportRow,
  listingToCanonicalRows,
  mapCanonicalRowsToListing,
} from '@/application/commerce/inventory-listing-map';
import { COMMERCE_LISTING_MAX_MEDIA, getCommerceAdapterMode, isDurableCommerceMode } from '@/config/commerce';
import {
  IMPORT_IMAGE_MAX_COUNT,
  IMPORT_IMAGE_RATE_LIMIT_BYTES,
  IMPORT_IMAGE_TYPICAL_BYTES,
} from '@/config/import-image';
import {
  evaluateDurableListingPublishGuards,
  type ListingPublishBlockReason,
  type SellerDeliveryKeyPublication,
} from '@/libs/commerce/listing-publish-guards';
import type { CommerceListingRecord, CommerceShopRecord } from '@/libs/commerce/marketplace-records';
import type { SellerPaymentConfig } from '@/libs/commerce/payment-methods';
import { ClientErrorCode } from '@/libs/error/error.codes';
import { isAppError, isNotFound } from '@/libs/error/error.utils';
import { CommerceRecordNormalizer } from '@/pipes/commerce/commerce.normalizer';
import {
  distinctImageCount,
  estimatePhotoPauses,
  extraFieldsWithImages,
  imageResultCells,
  imageResultsOf,
  imageSyncOf,
  imageSyncText,
  IMPORT_SOURCE_HASH_KEY,
  type ImportImageTarget,
  type ListingImageOutcome,
  mediaOf,
  planImageBatches,
  planImageSync,
  readPhotoJournal,
  RESULT_CSV_IMAGE_COLUMNS,
  rowHoldsMedia,
  sourceImagesOf,
  sourceUrlHash,
  uniqueImageUrls,
  withPhotoJournalEntry,
} from '@/pipes/commerce/import-image-phase';
import {
  continueRevision,
  keepLiveRecord,
  type KeptLiveSkip,
  keptLiveSkipText,
  rowsSupplyPackage,
} from '@/pipes/commerce/import-keep-live';
import type { ImportLossReport, ImportSourceFormat } from '@/pipes/commerce/import-loss-report';
import type { PresetJson } from '@/pipes/commerce/import-preset-rows';
import {
  classifyListingPublishFailure,
  invalidListingsCopy,
  type ListingPublishFailure,
} from '@/pipes/commerce/import-publish-failure';
import {
  gateBlocksListing,
  type ImportPublishGate,
  keptLiveFailureCode,
  keptLiveLine,
  keptLiveOf,
  keptLiveSummary,
  NO_PUBLISH_GATE,
  pausedFailureCode,
  pausedReasonOf,
  pausedResultText,
  pausedSummary,
  payloadShips,
} from '@/pipes/commerce/import-publish-gate';
import { DEFAULT_IMPORT_SETTINGS, type ImportSettings, type ImportShipping } from '@/pipes/commerce/import-settings';
import { shippingDefaultFromListings, shopCountryForImport } from '@/pipes/commerce/import-settings-defaults';
import type { WooStoreCatalog } from '@/pipes/commerce/import-woo-store';
import { CommerceHomeserverService } from '@/services/homeserver/commerce/commerce';
import { LocalCommerceService } from '@/services/local/commerce/commerce';
import {
  DexieManifestStore,
  type HostImportCheckpoint,
  type HostPlannedImportRow,
  type HostRowsSnapshot,
  type InventoryManifestStore,
  isManifestConflict,
} from '@/services/marketplace/marketplace-import-store';
import { MarketplaceInventorySessionService } from '@/services/marketplace/marketplace-inventory-session';
import { MarketplaceSessionService } from '@/services/marketplace/marketplace-session';
import {
  type CanonicalCsvRow,
  type CurrentImportItem,
  type DryRunCounts,
  type ImportManifest,
  MarketplaceShopClientService,
  type PlannedBrowserFile,
  type PlannedStoreCatalog,
  PubkyShopError,
  type SdkResult,
  type StoreImportConfig,
  type SyncManyEnvelope,
  type SyncManyListing,
} from '@/services/marketplace/marketplace-shop-client';

export const IMPORT_PARSE_FAIL_COPY = 'This file could not be planned. Nothing was published.';
export const IMPORT_CONFLICT_COPY =
  'This listing changed since the plan. Confirm or discard; it will not be overwritten.';
export const KEPT_LIVE_UNSAFE_MESSAGE = 'The live listing could not be updated safely, so it stays as it was.';
export const IMPORT_MIXED_COPY = 'Some listings synced; some did not. Resume publishes only the unfinished rows.';
export const CONFLICT_CONFIRMED = 'conflict_confirmed';
export const CONFLICT_DISCARDED = 'conflict_discarded';

export type InventoryImportAuth =
  | { status: 'durable-unavailable' }
  | { status: 'unauthenticated' }
  | { status: 'session-required' }
  | { status: 'grant-needed' }
  | { status: 'ready' };

export type InventoryImportPublishGate = ImportPublishGate;

export type InventoryImportPhotoPlan = {
  readonly count: number;
  readonly batches: number;
  /** About how many times the photo service's byte allowance will make the import wait, from a typical photo size. */
  readonly pauses: number;
};

/** An import that was started and not finished, as the Studio offers it for resume or discard. */
export type InventoryImportUnfinished = {
  readonly manifestId: string;
  readonly createdAt: number;
  /** Listings finished (published, or failed for good) out of the listings the import acts on. */
  readonly listings: { readonly done: number; readonly total: number };
  /** Distinct photos still to load. */
  readonly photosLeft: number;
};

/** What Discard did: photo files removed from the seller's homeserver, and whether the import is cleared. */
export type InventoryImportDiscardResult = {
  readonly removedFiles: number;
  readonly failedFiles: number;
  /** False when some file could not be removed: the import is kept, so Discard can be tried again. */
  readonly cleared: boolean;
};

/** Written onto the first planned row when the seller presses Publish, so a plan that was only looked at is never offered for resume. */
const IMPORT_STARTED_FIELD = 'import_started_at';

/** What the dry run can prefill from the seller's Shop data. */
export type InventoryImportDefaults = {
  countryCode: string | null;
  shipping: ImportShipping | null;
  /** The currency of the listing the shipping option came from. */
  currency: string | null;
};

export type InventoryImportPlanResult =
  | {
      status: 'planned';
      manifestId: string;
      rowCount: number;
      counts: DryRunCounts;
      /** Set when the file was a WooCommerce or Shopify export mapped by a preset. */
      format?: ImportSourceFormat;
      lossReport?: ImportLossReport;
      publishGate: InventoryImportPublishGate;
      /** Photos the publish will load and how many batches that takes; absent when there are none. */
      photos?: InventoryImportPhotoPlan;
    }
  | { status: 'parse-failed'; message: string; puts: 0 }
  | Exclude<InventoryImportAuth, { status: 'ready' }>
  | { status: 'error'; message: string };

export type InventoryImportPublishResult =
  | {
      status: 'complete';
      published: number;
      synced: number;
      failed: number;
      mixed: boolean;
      message?: string;
      /** Listings saved as paused because a publish gate blocked them (new ones, and ones that were paused). */
      paused?: number;
      pausedReason?: ListingPublishBlockReason;
      /** Listings that were live and stay live while a gate blocks; only their safe content was updated. */
      keptLive?: number;
      keptLiveReason?: ListingPublishBlockReason;
    }
  | { status: 'conflict'; listingId: string; message: string }
  | { status: 'rate-limited'; message: string }
  | Exclude<InventoryImportAuth, { status: 'ready' }>
  | { status: 'error'; message: string };

export type InventoryImportConflictAckResult =
  | InventoryImportPublishResult
  | { status: 'planned'; manifestId: string; rowCount: number; counts: DryRunCounts };

export type InventoryImportHost = {
  readonly sellerPubky: string;
  readonly store: InventoryManifestStore;
  planFile: (
    file: Parameters<typeof MarketplaceShopClientService.planBrowserFile>[0],
    store: InventoryManifestStore,
    currentItems: Readonly<Record<string, CurrentImportItem>>,
    settings: ImportSettings,
  ) => Promise<SdkResult<PlannedBrowserFile>>;
  planStoreCatalog: (
    catalog: WooStoreCatalog,
    store: InventoryManifestStore,
    currentItems: Readonly<Record<string, CurrentImportItem>>,
    config: StoreImportConfig,
  ) => Promise<PlannedStoreCatalog>;
  putListing: (record: CommerceListingRecord) => Promise<void>;
  listingExists: (url: string) => Promise<boolean>;
  syncMany: (listings: readonly SyncManyListing[]) => Promise<SdkResult<SyncManyEnvelope>>;
  currentItems: () => Promise<Readonly<Record<string, CurrentImportItem>>>;
  localRecords: () => Promise<readonly CommerceListingRecord[]>;
  loadPaymentConfig: (sellerPubky: string) => Promise<SellerPaymentConfig>;
  loadDeliveryKeyPublication: (sellerPubky: string) => Promise<SellerDeliveryKeyPublication>;
  loadShop: (sellerPubky: string) => Promise<CommerceShopRecord | null>;
  /** Whether a media file is on the seller's homeserver at this path. */
  mediaExists: (url: string) => Promise<boolean>;
  /** Deletes a media file from the seller's homeserver. */
  deleteMedia: (url: string) => Promise<void>;
};

function csvCell(value: string): string {
  const prefixed = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${prefixed.replaceAll('"', '""')}"`;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function resumeNext(checkpoint: HostImportCheckpoint): 'publish' | 'reconcile_publish' | 'sync_service' | 'none' {
  if (checkpoint === 'planned') return 'publish';
  if (checkpoint === 'publishing') return 'reconcile_publish';
  if (checkpoint === 'published_unsynced') return 'sync_service';
  return 'none';
}

function payloadRow(json: string): CanonicalImportRow | null {
  try {
    const parsed: unknown = JSON.parse(json);
    const object = asObject(parsed);
    if (!object) return null;
    return parsed as CanonicalImportRow;
  } catch {
    return null;
  }
}

const ADDRESS_KEYS = new Set([
  'address',
  'shippingAddress',
  'shipping_address',
  'deliveryAddress',
  'delivery_address',
  'buyerAddress',
  'buyer_address',
]);

function stripAddresses(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripAddresses);
  const object = asObject(value);
  if (!object) return value;
  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(object)) {
    if (ADDRESS_KEYS.has(key)) continue;
    next[key] = stripAddresses(entry);
  }
  return next;
}

export class CommerceInventoryImportApplication {
  private constructor(private readonly host: InventoryImportHost) {}

  static authStatus(sellerPubky: string): InventoryImportAuth {
    if (!isDurableCommerceMode(getCommerceAdapterMode())) return { status: 'durable-unavailable' };
    if (!sellerPubky) return { status: 'unauthenticated' };
    if (!MarketplaceSessionService.getActiveSession()) return { status: 'session-required' };
    if (!MarketplaceInventorySessionService.getCoveringBearer(sellerPubky)) return { status: 'grant-needed' };
    return { status: 'ready' };
  }

  static createHost(sellerPubky: string, overrides: Partial<InventoryImportHost> = {}): InventoryImportHost {
    const store = overrides.store ?? new DexieManifestStore(sellerPubky);
    const localRecords =
      overrides.localRecords ??
      (async () => (await LocalCommerceService.getListingsBySeller(sellerPubky)).map((listing) => listing.record));
    return {
      sellerPubky,
      store,
      planFile:
        overrides.planFile ??
        ((file, manifestStore, currentItems, settings) =>
          MarketplaceShopClientService.planBrowserFile(file, manifestStore, currentItems, { sellerPubky, settings })),
      planStoreCatalog:
        overrides.planStoreCatalog ??
        ((catalog, manifestStore, currentItems, config) =>
          MarketplaceShopClientService.planStoreCatalog(catalog, manifestStore, currentItems, config)),
      putListing: overrides.putListing ?? CommerceApplication.putPublicListingForImport.bind(CommerceApplication),
      listingExists: overrides.listingExists ?? ((url) => CommerceHomeserverService.exists(url)),
      syncMany:
        overrides.syncMany ??
        (async (listings) => {
          const inventory = MarketplaceInventorySessionService.getCoveringBearer(sellerPubky);
          if (!inventory) {
            return {
              ok: false,
              error: new PubkyShopError('session_rejected'),
            };
          }
          const client = MarketplaceShopClientService.createInventoryClient(inventory.token);
          return MarketplaceShopClientService.syncMany(client, listings);
        }),
      localRecords,
      loadPaymentConfig: overrides.loadPaymentConfig ?? ((pubky) => CommerceApplication.getSellerPaymentConfig(pubky)),
      loadDeliveryKeyPublication:
        overrides.loadDeliveryKeyPublication ??
        (async (pubky) => (await CommerceDeliveryKeysApplication.getSellerKeyStatus(pubky)).publication),
      loadShop:
        overrides.loadShop ??
        (async (pubky) => {
          try {
            return (await CommerceApplication.getShop(pubky))?.record ?? null;
          } catch {
            return null;
          }
        }),
      mediaExists: overrides.mediaExists ?? ((url) => CommerceHomeserverService.exists(url)),
      deleteMedia: overrides.deleteMedia ?? ((url) => CommerceHomeserverService.delete(url)),
      currentItems:
        overrides.currentItems ??
        (async () =>
          MarketplaceShopClientService.currentItemsFromRows((await localRecords()).flatMap(listingToCanonicalRows))),
    };
  }

  static forSeller(
    sellerPubky: string,
    overrides: Partial<InventoryImportHost> = {},
  ): CommerceInventoryImportApplication {
    return new CommerceInventoryImportApplication(this.createHost(sellerPubky, overrides));
  }

  async planFile(
    file: Parameters<typeof MarketplaceShopClientService.planBrowserFile>[0],
    settings: ImportSettings = DEFAULT_IMPORT_SETTINGS,
  ): Promise<InventoryImportPlanResult> {
    const auth = CommerceInventoryImportApplication.authStatus(this.host.sellerPubky);
    if (auth.status !== 'ready') return auth;
    await this.host.store.pruneExpired();
    const currentItems = await this.host.currentItems();
    const planned = await this.host.planFile(file, this.host.store, currentItems, settings);
    return this.planResult(
      planned.ok
        ? { ok: true, value: planned.value }
        : { ok: false, message: MarketplaceShopClientService.formatPlanFailure(planned.error) },
    );
  }

  /**
   * Plans a WooCommerce store's public catalogue, already read through the
   * Store API, with the same dry run as a file. `offeredCurrencies` are the
   * currencies a listing can be priced in; a store in another one is refused.
   */
  async planStoreCatalog(
    catalog: WooStoreCatalog,
    settings: ImportSettings,
    offeredCurrencies: readonly string[],
  ): Promise<InventoryImportPlanResult> {
    const auth = CommerceInventoryImportApplication.authStatus(this.host.sellerPubky);
    if (auth.status !== 'ready') return auth;
    await this.host.store.pruneExpired();
    const currentItems = await this.host.currentItems();
    return this.planResult(
      await this.host.planStoreCatalog(catalog, this.host.store, currentItems, {
        sellerPubky: this.host.sellerPubky,
        settings,
        offeredCurrencies,
      }),
    );
  }

  private async planResult(
    planned: { ok: true; value: PlannedBrowserFile } | { ok: false; message: string },
  ): Promise<InventoryImportPlanResult> {
    if (!planned.ok) return { status: 'parse-failed', message: planned.message, puts: 0 };
    const manifest = await this.host.store.load(planned.value.manifestId);
    if (!manifest) {
      return { status: 'parse-failed', message: IMPORT_PARSE_FAIL_COPY, puts: 0 };
    }
    const targets = planned.value.rowCount === 0 ? [] : await this.imageTargets(planned.value.manifestId);
    const photoCount = distinctImageCount(targets);
    return {
      status: 'planned',
      manifestId: planned.value.manifestId,
      rowCount: planned.value.rowCount,
      publishGate: planned.value.rowCount === 0 ? NO_PUBLISH_GATE : await this.publishGate(planned.value.manifestId),
      counts: MarketplaceShopClientService.dryRunCounts(manifest as ImportManifest),
      ...(photoCount > 0
        ? {
            photos: {
              count: photoCount,
              batches: planImageBatches(targets, IMPORT_IMAGE_MAX_COUNT).length,
              pauses: estimatePhotoPauses(photoCount, IMPORT_IMAGE_TYPICAL_BYTES, IMPORT_IMAGE_RATE_LIMIT_BYTES),
            },
          }
        : {}),
      ...(planned.value.format ? { format: planned.value.format } : {}),
      ...(planned.value.lossReport ? { lossReport: planned.value.lossReport } : {}),
    };
  }

  async dryRun(manifestId: string): Promise<DryRunCounts | null> {
    const manifest = await this.host.store.load(manifestId);
    if (!manifest) return null;
    return MarketplaceShopClientService.dryRunCounts(manifest as ImportManifest);
  }

  async publish(manifestId: string): Promise<InventoryImportPublishResult> {
    const auth = CommerceInventoryImportApplication.authStatus(this.host.sellerPubky);
    if (auth.status !== 'ready') return auth;
    return this.resume(manifestId);
  }

  async resume(manifestId: string): Promise<InventoryImportPublishResult> {
    const auth = CommerceInventoryImportApplication.authStatus(this.host.sellerPubky);
    if (auth.status !== 'ready') return auth;
    const loaded = await this.host.store.load(manifestId);
    if (!loaded) return { status: 'error', message: 'The import plan is missing.' };

    let published = 0;
    const pendingSync: SyncManyListing[] = [];
    const groups = this.groups(loaded.rows);
    let conflictListingId: string | null = null;
    const invalid: ListingPublishFailure[] = [];
    let gate: InventoryImportPublishGate | null = null;
    let existing: ReadonlyMap<string, CommerceListingRecord> | null = null;

    for (const [listingId, group] of groups) {
      const actionable = group.filter((row) => resumeNext(row.checkpoint) !== 'none');
      if (actionable.length === 0) continue;
      if (group.some((row) => isConflictRow(row))) {
        if (group.every((row) => isAcknowledgedConflict(row) || !isConflictRow(row))) continue;
        conflictListingId ??= listingId;
        continue;
      }
      if (group.every((row) => row.intendedAction === 'unchanged')) continue;

      const needsPut = actionable.some((row) => {
        const next = resumeNext(row.checkpoint);
        return next === 'publish' || next === 'reconcile_publish';
      });
      const needsSync = actionable.some((row) => resumeNext(row.checkpoint) === 'sync_service') || needsPut;

      if (needsPut) {
        gate ??= await this.publishGate(manifestId);
        existing ??= await this.existingRecords();
        const put = await this.publishGroup(manifestId, listingId, group, gate.reason, existing.get(listingId));
        if (put.status === 'invalid') {
          invalid.push(put.failure);
          continue;
        }
        if (put.status === 'conflict' || put.status === 'error') return put;
        published += 1;
        const note = put.pausedBy
          ? pausedFailureCode(put.pausedBy)
          : put.keptLive
            ? keptLiveFailureCode(put.keptLive.reason, put.keptLive.skipped)
            : null;
        if (note) {
          await this.annotateGroup(manifestId, group, note);
        }
      }
      if (needsSync) {
        pendingSync.push({ seller_pubky: this.host.sellerPubky, listing_id: listingId });
      }
    }

    const sync = await this.syncPending(manifestId, pendingSync, groups);
    if (sync.status === 'rate-limited' || sync.status === 'error') return sync;

    const finalManifest = await this.host.store.load(manifestId);
    const rows = finalManifest?.rows ?? [];
    const synced = rows.filter((row) => row.checkpoint === 'complete').length;
    const failed = rows.filter((row) => row.checkpoint === 'failed').length;
    const unfinished = rows.some((row) => resumeNext(row.checkpoint) !== 'none' && row.checkpoint !== 'conflict');
    const mixed = (synced > 0 && failed > 0) || unfinished;
    if (conflictListingId && published === 0 && synced === 0 && invalid.length === 0) {
      return { status: 'conflict', listingId: conflictListingId, message: IMPORT_CONFLICT_COPY };
    }
    const mainMessage = conflictListingId
      ? IMPORT_CONFLICT_COPY
      : invalid.length > 0
        ? invalidListingsCopy(invalid)
        : mixed
          ? IMPORT_MIXED_COPY
          : undefined;
    const gated = this.gatedListings(rows);
    const message = [
      mainMessage,
      gated.pausedReason ? pausedSummary(gated.paused, gated.pausedReason) : undefined,
      gated.keptLiveReason ? keptLiveSummary(gated.keptLive, gated.keptLiveReason, gated.skippedChanges) : undefined,
    ]
      .filter(Boolean)
      .join(' ');
    return {
      status: 'complete',
      published,
      synced,
      failed,
      mixed: mixed || conflictListingId !== null,
      ...(message ? { message } : {}),
      ...(gated.pausedReason ? { paused: gated.paused, pausedReason: gated.pausedReason } : {}),
      ...(gated.keptLiveReason ? { keptLive: gated.keptLive, keptLiveReason: gated.keptLiveReason } : {}),
    };
  }

  /** The listings a publish gate paused or kept live, counted from the manifest so a resume adds to the first run. */
  private gatedListings(rows: readonly HostPlannedImportRow[]) {
    const paused = new Map<string, ListingPublishBlockReason>();
    const kept = new Map<string, { reason: ListingPublishBlockReason; skipped: string[] }>();
    for (const row of rows) {
      const pausedReason = pausedReasonOf(row.failureCode);
      if (pausedReason) paused.set(row.listingId, pausedReason);
      const keptLive = keptLiveOf(row.failureCode);
      if (keptLive) kept.set(row.listingId, keptLive);
    }
    return {
      paused: paused.size,
      pausedReason: [...paused.values()][0] ?? null,
      keptLive: kept.size,
      keptLiveReason: [...kept.values()][0]?.reason ?? null,
      skippedChanges: [...kept.values()].reduce((sum, entry) => sum + entry.skipped.length, 0),
    };
  }

  /** The seller's listings as stored now, by listing id: what a re-import updates. */
  private async existingRecords(): Promise<ReadonlyMap<string, CommerceListingRecord>> {
    try {
      return new Map((await this.host.localRecords()).map((record) => [record.listingId, record]));
    } catch {
      return new Map();
    }
  }

  async confirmConflict(manifestId: string, listingId: string): Promise<InventoryImportConflictAckResult> {
    await this.acknowledgeConflict(manifestId, listingId, 'confirm');
    return this.afterConflictAck(manifestId);
  }

  async discardConflict(manifestId: string, listingId: string): Promise<InventoryImportConflictAckResult> {
    await this.acknowledgeConflict(manifestId, listingId, 'discard');
    return this.afterConflictAck(manifestId);
  }

  /**
   * The canonical import CSV for the seller's catalog: one row per variant,
   * with `record_json` so every field the columns cannot carry survives a
   * re-import. The service listing is read when the seller holds an Inventory
   * grant; any failed page falls back to the local catalog so an export is
   * never silently partial.
   */
  async exportListingsCsv(): Promise<Uint8Array> {
    const inventory = MarketplaceInventorySessionService.getCoveringBearer(this.host.sellerPubky);
    const served = inventory ? await this.serviceListingRows(inventory.token) : null;
    if (served) return MarketplaceShopClientService.exportListingsCsv(served);
    const local = await this.host.localRecords();
    return MarketplaceShopClientService.exportListingsCsv(local.flatMap(listingToCanonicalRows));
  }

  private async serviceListingRows(token: string): Promise<CanonicalCsvRow[] | null> {
    const rows: CanonicalCsvRow[] = [];
    const client = MarketplaceShopClientService.createInventoryClient(token);
    let cursor: string | undefined;
    for (;;) {
      const page = await MarketplaceShopClientService.listSellerListings(client, this.host.sellerPubky, {
        limit: 100,
        cursor,
      });
      if (!page.ok) return null;
      const listings = page.value.listings;
      if (Array.isArray(listings)) {
        for (const entry of listings) {
          const record = asObject(entry)?.record;
          if (!record || typeof record !== 'object') return null;
          try {
            rows.push(...listingToCanonicalRows(record as CommerceListingRecord));
          } catch {
            return null;
          }
        }
      }
      const next = typeof page.value.next_cursor === 'string' ? page.value.next_cursor : null;
      if (!next) return rows;
      cursor = next;
    }
  }

  async exportOrdersJson(): Promise<string> {
    const inventory = MarketplaceInventorySessionService.getCoveringBearer(this.host.sellerPubky);
    if (!inventory) return '[]';
    const client = MarketplaceShopClientService.createInventoryClient(inventory.token);
    const collected: unknown[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await MarketplaceShopClientService.listSellerOrders(client, this.host.sellerPubky, {
        limit: 100,
        cursor,
      });
      if (!page.ok) break;
      const orders = page.value.orders;
      if (Array.isArray(orders)) collected.push(...orders.map(stripAddresses));
      const next = typeof page.value.next_cursor === 'string' ? page.value.next_cursor : null;
      if (!next) break;
      cursor = next;
    }
    return JSON.stringify(collected);
  }

  /**
   * Listings in the plan that still need their photos fetched: a create or
   * update that has not been published, has source image URLs, and does not
   * already hold media (uploaded earlier, so a resume never uploads twice).
   */
  async imageTargets(manifestId: string): Promise<ImportImageTarget[]> {
    const manifest = await this.host.store.load(manifestId);
    if (!manifest) return [];
    const targets: ImportImageTarget[] = [];
    const existing = await this.existingRecords();
    for (const [listingId, group] of this.groups(manifest.rows)) {
      const pending = group.some(
        (row) => row.checkpoint === 'planned' && (row.intendedAction === 'create' || row.intendedAction === 'update'),
      );
      if (!pending) continue;
      let images: ReturnType<typeof sourceImagesOf> = [];
      let holdsMedia = false;
      for (const row of group) {
        const payload = await this.rowPayload(manifestId, row.rowIdentity);
        if (!payload) continue;
        if (rowHoldsMedia(payload)) holdsMedia = true;
        if (images.length === 0) images = sourceImagesOf(payload);
      }
      if (holdsMedia || images.length === 0) continue;
      const stored = existing.get(listingId);
      if (!stored) {
        targets.push({ listingId, rowIdentity: group[0]?.rowIdentity, images });
        continue;
      }
      // Already on the seller's record: fetch only URLs it does not have, drop what left the file, keep the rest.
      const plan = planImageSync(stored.media, images, COMMERCE_LISTING_MAX_MEDIA);
      targets.push({
        listingId,
        rowIdentity: group[0]?.rowIdentity,
        images: plan.toUpload,
        skipped: plan.overflow,
        keptMedia: plan.keptMedia,
        sync: { removed: plan.removed, handKept: plan.handKept },
      });
    }
    return targets;
  }

  /** Records that the seller pressed Publish, so the import can be offered for resume if it does not finish. */
  async markStarted(manifestId: string): Promise<void> {
    const manifest = await this.host.store.load(manifestId);
    const first = manifest?.rows[0];
    if (!first) return;
    const payload = await this.rowPayload(manifestId, first.rowIdentity);
    if (!payload || payload.extraFields?.[IMPORT_STARTED_FIELD]) return;
    const extraFields = { ...payload.extraFields, [IMPORT_STARTED_FIELD]: new Date().toISOString() };
    await this.host.store.persistPayloads(
      manifestId,
      new Map([[first.rowIdentity, JSON.stringify({ ...payload, extraFields })]]),
    );
  }

  /**
   * The newest import of this seller that was started and has work left: rows
   * still to publish or sync, or a conflict nobody has answered. A plan that was
   * only looked at is not one. Everything it needs to carry on is already stored:
   * rows, payloads, and the media of every finished batch.
   */
  async findUnfinished(): Promise<InventoryImportUnfinished | null> {
    for (const summary of await this.host.store.listManifests()) {
      const manifest = await this.host.store.load(summary.manifestId);
      if (!manifest) continue;
      const acting = manifest.rows.filter((row) => row.intendedAction !== 'unchanged');
      const open = (row: HostPlannedImportRow) =>
        resumeNext(row.checkpoint) !== 'none' || (row.checkpoint === 'conflict' && !isAcknowledgedConflict(row));
      if (!acting.some(open)) continue;
      const first = manifest.rows[0];
      const started =
        manifest.rows.some((row) => row.checkpoint !== 'planned') ||
        (first !== undefined &&
          Boolean(
            (await this.rowPayload(manifest.manifestId, first.rowIdentity))?.extraFields?.[IMPORT_STARTED_FIELD],
          ));
      if (!started) continue;

      const groups = this.groups(acting);
      const done = [...groups.values()].filter((group) => !group.some(open)).length;
      const urls = uniqueImageUrls(await this.imageTargets(manifest.manifestId));
      const loaded = await this.knownMedia(manifest.manifestId, urls);
      return {
        manifestId: manifest.manifestId,
        createdAt: summary.createdAt,
        listings: { done, total: groups.size },
        photosLeft: urls.length - loaded.size,
      };
    }
    return null;
  }

  /**
   * Clears an import the seller does not want to finish. Listings already
   * published stay published. The photo files this import wrote (its journal
   * records) that no published listing refers to are deleted from the seller's
   * homeserver first, so Discard leaves nothing behind; if one cannot be
   * deleted the import is kept, so Discard can be tried again.
   */
  async discard(manifestId: string): Promise<InventoryImportDiscardResult> {
    let removedFiles = 0;
    let failedFiles = 0;
    for (const url of await this.unreferencedUploads(manifestId)) {
      try {
        if (!(await this.host.mediaExists(url))) continue;
        await this.host.deleteMedia(url);
        removedFiles += 1;
      } catch {
        failedFiles += 1;
      }
    }
    if (failedFiles > 0) return { removedFiles, failedFiles, cleared: false };
    await this.host.store.deleteManifest(manifestId);
    return { removedFiles, failedFiles, cleared: true };
  }

  /**
   * Files this import wrote that nothing published refers to: the journal's
   * records on its rows, less every media that a possibly published listing of
   * the import holds (a listing past `planned` is treated as published) or that
   * a stored listing of the seller has, and only paths under the seller's own
   * media folder.
   */
  private async unreferencedUploads(manifestId: string): Promise<string[]> {
    const manifest = await this.host.store.load(manifestId);
    if (!manifest) return [];
    const referenced = new Set<string>();
    for (const record of await this.host.localRecords()) for (const media of record.media) referenced.add(media.url);
    const written = new Map<string, string>();
    for (const group of this.groups(manifest.rows).values()) {
      const maybePublished = group.some(
        (row) =>
          row.checkpoint === 'publishing' || row.checkpoint === 'published_unsynced' || row.checkpoint === 'complete',
      );
      for (const row of group) {
        const payload = await this.rowPayload(manifestId, row.rowIdentity);
        const held = mediaOf(payload);
        const journaled = readPhotoJournal(payload).map((entry) => entry.media);
        if (maybePublished) for (const media of [...held, ...journaled]) addUrl(referenced, media);
        for (const media of journaled) {
          const { id, url } = media as Record<string, unknown>;
          if (typeof id === 'string' && typeof url === 'string') written.set(url, id);
        }
      }
    }
    return [...written]
      .filter(
        ([url, id]) => !referenced.has(url) && url === CommerceRecordNormalizer.mediaUri(this.host.sellerPubky, id),
      )
      .map(([url]) => url);
  }

  /**
   * Photos of this import that are already stored on some listing's planned
   * rows, by source URL. A photo shared by listings that fell in different
   * batches, or on either side of an interruption, is then reused instead of
   * being loaded and uploaded a second time. The rows hold the hash of the source
   * URL on each media record, never the URL.
   */
  async knownMedia(manifestId: string, urls: readonly string[]): Promise<Map<string, PresetJson>> {
    const manifest = await this.host.store.load(manifestId);
    const known = new Map<string, PresetJson>();
    if (!manifest || urls.length === 0) return known;
    const wanted = new Map(urls.map((url) => [sourceUrlHash(url), url]));
    const byHash = new Map<string, PresetJson>();
    const journaled = new Map<string, PresetJson>();
    for (const row of manifest.rows) {
      const payload = await this.rowPayload(manifestId, row.rowIdentity);
      for (const entry of mediaOf(payload)) {
        const hash = (entry as Record<string, unknown>)[IMPORT_SOURCE_HASH_KEY];
        if (typeof hash === 'string' && !byHash.has(hash)) byHash.set(hash, entry);
      }
      for (const entry of readPhotoJournal(payload)) {
        if (!journaled.has(entry.hash)) journaled.set(entry.hash, entry.media);
      }
    }
    // An upload that was recorded and not attached: its file is at the recorded path only if the write got that far.
    for (const [hash, media] of journaled) {
      if (byHash.has(hash) || !wanted.has(hash)) continue;
      const path = (media as Record<string, unknown>).url;
      if (typeof path === 'string' && (await this.host.mediaExists(path))) byHash.set(hash, media);
    }
    for (const [hash, url] of wanted) {
      const found = byHash.get(hash);
      if (found) known.set(url, found);
    }
    return known;
  }

  /**
   * Records, before the file is written, the media record a photo is about to be
   * stored under. The record is stored on the listing's first row and read back
   * by `knownMedia`, which reuses it if the file is there. So a page lost at any
   * point leaves either nothing, or a file that the next run finds and attaches;
   * never a file nothing refers to.
   */
  async journalPhoto(manifestId: string, rowIdentity: string, url: string, media: PresetJson): Promise<void> {
    const payload = await this.rowPayload(manifestId, rowIdentity);
    if (!payload) return;
    const extraFields = withPhotoJournalEntry(payload.extraFields ?? {}, { hash: sourceUrlHash(url), media });
    await this.host.store.persistPayloads(
      manifestId,
      new Map([[rowIdentity, JSON.stringify({ ...payload, extraFields })]]),
    );
  }

  /** Writes each listing's uploaded media and per-image results onto its planned rows. */
  async attachImages(manifestId: string, outcomes: readonly ListingImageOutcome[]): Promise<void> {
    const manifest = await this.host.store.load(manifestId);
    if (!manifest) return;
    const groups = this.groups(manifest.rows);
    const updates = new Map<string, string>();
    for (const outcome of outcomes) {
      for (const row of groups.get(outcome.listingId) ?? []) {
        const payload = await this.rowPayload(manifestId, row.rowIdentity);
        if (!payload) continue;
        updates.set(
          row.rowIdentity,
          JSON.stringify({ ...payload, extraFields: extraFieldsWithImages(payload.extraFields ?? {}, outcome) }),
        );
      }
    }
    if (updates.size > 0) await this.host.store.persistPayloads(manifestId, updates);
  }

  private async rowPayload(
    manifestId: string,
    rowIdentity: string,
  ): Promise<{ media?: unknown; extraFields?: Record<string, string> } | null> {
    const json = await this.host.store.getPayloadJson(manifestId, rowIdentity);
    if (!json) return null;
    const parsed: unknown = (() => {
      try {
        return JSON.parse(json);
      } catch {
        return null;
      }
    })();
    return asObject(parsed) as { media?: unknown; extraFields?: Record<string, string> } | null;
  }

  /**
   * The sell composer's own publish gates (`evaluateDurableListingPublishGuards`),
   * answered once for this seller: the payment-method gate for every listing,
   * and the delivery-key gate when any planned listing ships. Import publishes
   * save listings as paused while a gate blocks.
   */
  async publishGate(manifestId: string): Promise<InventoryImportPublishGate> {
    const planned = await this.plannedListings(manifestId);
    const ships = planned.some((listing) => listing.ships);
    const reason = await evaluateDurableListingPublishGuards({
      ownerPubky: this.host.sellerPubky,
      hasMarketplaceSession: Boolean(MarketplaceSessionService.getActiveSession()),
      loadPaymentConfig: (pubky) => this.host.loadPaymentConfig(pubky),
      deliveryKey: {
        required: ships,
        loadPublication: () => this.host.loadDeliveryKeyPublication(this.host.sellerPubky),
      },
    });
    if (!reason) return { ...NO_PUBLISH_GATE, ships };
    const existing = await this.existingRecords();
    let pausing = 0;
    const keptLive: { listingId: string; title: string }[] = [];
    for (const listing of planned) {
      if (!listing.active || !gateBlocksListing(reason, listing.ships)) continue;
      const stored = existing.get(listing.listingId);
      if (stored?.state === 'active') keptLive.push({ listingId: listing.listingId, title: stored.title });
      else pausing += 1;
    }
    return { reason, ships, pausing, keptLive };
  }

  /** Each listing still to publish: whether it ships, and whether the row would save it active. */
  private async plannedListings(manifestId: string): Promise<{ listingId: string; ships: boolean; active: boolean }[]> {
    const manifest = await this.host.store.load(manifestId);
    if (!manifest) return [];
    const listings: { listingId: string; ships: boolean; active: boolean }[] = [];
    for (const [listingId, group] of this.groups(manifest.rows)) {
      const actionable = group.some(
        (row) => resumeNext(row.checkpoint) !== 'none' && row.intendedAction !== 'unchanged',
      );
      if (!actionable) continue;
      let ships = false;
      let active = false;
      for (const row of group) {
        const json = await this.host.store.getPayloadJson(manifestId, row.rowIdentity);
        const payload = json ? payloadRow(json) : null;
        if (!payload) continue;
        if (payloadShips(payload)) ships = true;
        if (payload.state === 'active') active = true;
      }
      listings.push({ listingId, ships, active });
    }
    return listings;
  }

  /**
   * What the dry run prefills from the seller's own data: the country of their
   * shop (never the Shop's fallback) and the shipping option of their latest
   * listing that has one.
   */
  async importDefaults(): Promise<InventoryImportDefaults> {
    const shop = await this.host.loadShop(this.host.sellerPubky);
    const fromListings = shippingDefaultFromListings(await this.host.localRecords());
    return {
      countryCode: shopCountryForImport(shop),
      shipping: fromListings?.shipping ?? null,
      currency: fromListings?.currency ?? null,
    };
  }

  async resultCsv(manifestId: string): Promise<string> {
    const manifest = await this.host.store.load(manifestId);
    const rows = manifest?.rows ?? [];
    const imageLines: string[][] = [];
    const seenListings = new Set<string>();
    for (const row of rows) {
      if (seenListings.has(row.listingId)) continue;
      const payload = await this.rowPayload(manifestId, row.rowIdentity);
      const results = payload ? imageResultsOf(payload) : [];
      const sync = payload ? imageSyncOf(payload) : null;
      if (results.length === 0 && !sync) continue;
      seenListings.add(row.listingId);
      if (sync) imageLines.push([row.listingId, '', '', '', '', 'summary', imageSyncText(sync)]);
      for (const result of results) imageLines.push([row.listingId, '', '', '', ...imageResultCells(result)]);
    }
    const withImages = imageLines.length > 0;
    const lines = [
      `listing_id,row_identity,checkpoint,result${withImages ? `,${RESULT_CSV_IMAGE_COLUMNS.join(',')}` : ''}`,
    ];
    for (const row of rows) {
      const pausedReason = pausedReasonOf(row.failureCode);
      const keptLive = keptLiveOf(row.failureCode);
      const noted = pausedReason !== null || keptLive !== null;
      const base =
        row.checkpoint === 'complete' ? 'synced' : noted ? row.checkpoint : (row.failureCode ?? row.checkpoint);
      let result = base;
      if (pausedReason) result = `${base}, ${pausedResultText(pausedReason)}`;
      if (keptLive) {
        const skipped =
          keptLive.skipped.length > 0 ? `; skipped: ${keptLiveSkipText(keptLive.skipped as KeptLiveSkip[])}` : '';
        result = `${base}, ${keptLiveLine(keptLive.reason)}${skipped}`;
      }
      const cells = [row.listingId, row.rowIdentity, row.checkpoint, result, ...(withImages ? ['', '', ''] : [])];
      lines.push(cells.map(csvCell).join(','));
    }
    for (const cells of imageLines) lines.push(cells.map(csvCell).join(','));
    return `${lines.join('\n')}\n`;
  }

  private async afterConflictAck(manifestId: string): Promise<InventoryImportConflictAckResult> {
    const loaded = await this.host.store.load(manifestId);
    if (!loaded) return { status: 'error', message: 'The import plan is missing.' };
    const started = loaded.rows.some((row) => publishHadStarted(row));
    if (started) return this.resume(manifestId);
    const unresolved = firstUnresolvedConflict(this.groups(loaded.rows));
    if (unresolved) {
      return { status: 'conflict', listingId: unresolved, message: IMPORT_CONFLICT_COPY };
    }
    return {
      status: 'planned',
      manifestId,
      rowCount: loaded.rowCount,
      counts: remainingDryRunCounts(loaded.rows),
    };
  }

  private async acknowledgeConflict(manifestId: string, listingId: string, kind: 'confirm' | 'discard'): Promise<void> {
    const loaded = await this.host.store.load(manifestId);
    if (!loaded) return;
    const groups = this.groups(loaded.rows);
    const targetId = listingId || firstUnresolvedConflict(groups);
    if (!targetId) return;
    const group = groups.get(targetId);
    if (!group) return;
    const failureCode = kind === 'confirm' ? CONFLICT_CONFIRMED : CONFLICT_DISCARDED;
    const preferred: HostImportCheckpoint = kind === 'confirm' ? 'conflict' : 'failed';
    for (const row of group) {
      if (isAcknowledgedConflict(row)) continue;
      if (row.checkpoint !== 'conflict') {
        const hop = nextAllowedCheckpoint(row.checkpoint, preferred);
        if (hop !== null) {
          await this.checkpointRows(manifestId, [row.rowIdentity], hop);
        }
      }
      await this.annotateRows(manifestId, [row.rowIdentity], failureCode);
    }
  }

  /**
   * Notes `failureCode` on each of the rows. Each note is one row write under
   * the manifest version; reads cover these rows only, never the whole manifest.
   */
  private async annotateRows(manifestId: string, rowIdentities: readonly string[], failureCode: string): Promise<void> {
    let snapshot = await this.host.store.loadRows(manifestId, rowIdentities);
    while (snapshot) {
      const row = snapshot.rows.find((entry) => entry.failureCode !== failureCode);
      if (!row) return;
      try {
        const patched = await this.host.store.patchRow(
          manifestId,
          snapshot.manifestVersion,
          row.rowIdentity,
          (current) => ({
            ...current,
            failureCode,
          }),
        );
        snapshot = withRow(patched.manifest.manifestVersion, snapshot.rows, patched.row);
      } catch (error) {
        snapshot = isManifestConflict(error)
          ? await this.host.store.loadRows(manifestId, rowIdentities)
          : { ...snapshot, rows: snapshot.rows.filter((entry) => entry.rowIdentity !== row.rowIdentity) };
      }
    }
  }

  /**
   * Moves the rows, in order, one allowed hop at a time toward `checkpoint`.
   * Every hop is one row write guarded by the manifest version; the version a
   * write returns guards the next one, so the manifest is read once per call,
   * not once per hop. A write that lost to another tab is retried on a fresh
   * read of these rows; a write that failed without the manifest moving is not.
   */
  private async checkpointRows(
    manifestId: string,
    rowIdentities: readonly string[],
    checkpoint: HostImportCheckpoint,
  ): Promise<void> {
    let snapshot = await this.host.store.loadRows(manifestId, rowIdentities);
    while (snapshot) {
      const row = snapshot.rows.find((entry) => entry.checkpoint !== checkpoint);
      if (!row) return;
      const hop = nextAllowedCheckpoint(row.checkpoint, checkpoint);
      if (hop === null) return;
      const result = await MarketplaceShopClientService.checkpointRow(
        this.host.store,
        manifestId,
        snapshot.manifestVersion,
        row.rowIdentity,
        hop,
      );
      if (result.ok) {
        snapshot = withRow(
          result.value.manifest.manifestVersion,
          snapshot.rows,
          result.value.row as HostPlannedImportRow,
        );
        continue;
      }
      const fresh = await this.host.store.loadRows(manifestId, rowIdentities);
      snapshot = fresh && fresh.manifestVersion !== snapshot.manifestVersion ? fresh : null;
    }
  }

  private groups(rows: readonly HostPlannedImportRow[]): Map<string, HostPlannedImportRow[]> {
    const groups = new Map<string, HostPlannedImportRow[]>();
    for (const row of rows) {
      const current = groups.get(row.listingId) ?? [];
      current.push(row);
      groups.set(row.listingId, current);
    }
    return groups;
  }

  private async publishGroup(
    manifestId: string,
    listingId: string,
    group: readonly HostPlannedImportRow[],
    blocked: ListingPublishBlockReason | null,
    existing: CommerceListingRecord | undefined,
  ): Promise<
    | {
        status: 'ok';
        pausedBy?: ListingPublishBlockReason;
        keptLive?: { reason: ListingPublishBlockReason; skipped: KeptLiveSkip[] };
      }
    | { status: 'invalid'; failure: ListingPublishFailure }
    | { status: 'conflict'; listingId: string; message: string }
    | { status: 'error'; message: string }
  > {
    const reconcile = group.some((row) => resumeNext(row.checkpoint) === 'reconcile_publish');
    const url = CommerceRecordNormalizer.listingUri(this.host.sellerPubky, listingId);
    if (reconcile) {
      const exists = await this.host.listingExists(url);
      if (exists) {
        await this.checkpointGroup(manifestId, group, 'published_unsynced');
        return { status: 'ok' };
      }
    }

    const payloads: CanonicalImportRow[] = [];
    for (const row of group) {
      const json = await this.host.store.getPayloadJson(manifestId, row.rowIdentity);
      if (!json) {
        return { status: 'error', message: IMPORT_PARSE_FAIL_COPY };
      }
      const parsed = payloadRow(json);
      if (!parsed) return { status: 'error', message: IMPORT_PARSE_FAIL_COPY };
      payloads.push(parsed);
    }
    const mapped = mapCanonicalRowsToListing(payloads, this.host.sellerPubky);
    if (!mapped.ok) {
      const failure = classifyListingPublishFailure(mapped.message);
      const failureCode =
        failure.code === 'invalid_listing' ? `${failure.code}: ${failure.message.slice(0, 200)}` : failure.code;
      await this.checkpointGroup(manifestId, group, 'failed');
      await this.annotateGroup(manifestId, group, failureCode);
      return { status: 'invalid', failure };
    }

    const source = { suppliesPackage: rowsSupplyPackage(payloads) };
    let record = mapped.record;
    let pausedBy: ListingPublishBlockReason | undefined;
    let keptLive: { reason: ListingPublishBlockReason; skipped: KeptLiveSkip[] } | undefined;
    const gatedBy =
      blocked !== null && record.state === 'active' && gateBlocksListing(blocked, payloads.some(payloadShips))
        ? blocked
        : null;
    if (gatedBy && existing?.state === 'active') {
      // Already live: it stays live. Only safe content changes; a change the gate guards is skipped.
      const kept = keepLiveRecord(existing, record, new Date().toISOString(), source);
      if (!kept) {
        const failure = classifyListingPublishFailure(KEPT_LIVE_UNSAFE_MESSAGE);
        await this.checkpointGroup(manifestId, group, 'failed');
        const failureCode = `${failure.code}: ${failure.message}`;
        await this.annotateGroup(manifestId, group, failureCode);
        return { status: 'invalid', failure };
      }
      record = kept.record;
      keptLive = { reason: gatedBy, skipped: [...kept.skipped] };
    } else {
      if (existing) record = continueRevision(existing, record, source);
      if (gatedBy) {
        record = { ...record, state: 'paused' };
        pausedBy = gatedBy;
      }
    }

    await this.checkpointGroup(manifestId, group, 'publishing');
    try {
      await this.host.putListing(record);
    } catch (error) {
      if (isAppError(error) && error.code === ClientErrorCode.CONFLICT) {
        await this.checkpointGroup(manifestId, group, 'conflict');
        return { status: 'conflict', listingId, message: IMPORT_CONFLICT_COPY };
      }
      if (isAppError(error) && isNotFound(error)) {
        await this.checkpointGroup(manifestId, group, 'failed');
        return { status: 'error', message: error.message };
      }
      await this.checkpointGroup(manifestId, group, 'failed');
      return { status: 'error', message: error instanceof Error ? error.message : IMPORT_PARSE_FAIL_COPY };
    }
    await this.checkpointGroup(manifestId, group, 'published_unsynced');
    return { status: 'ok', ...(pausedBy ? { pausedBy } : {}), ...(keptLive ? { keptLive } : {}) };
  }

  private async syncPending(
    manifestId: string,
    listings: readonly SyncManyListing[],
    groups: ReadonlyMap<string, readonly HostPlannedImportRow[]>,
  ): Promise<
    | { status: 'ok'; synced: number; failed: number }
    | { status: 'rate-limited'; message: string }
    | { status: 'error'; message: string }
  > {
    let synced = 0;
    let failed = 0;
    for (const chunk of MarketplaceShopClientService.chunkSyncMany(listings)) {
      if (chunk.length === 0) continue;
      const result = await this.host.syncMany(chunk);
      if (!result.ok) {
        if (MarketplaceShopClientService.isRateLimited(result.error)) {
          return { status: 'rate-limited', message: MarketplaceShopClientService.formatRateLimitCopy(result.error) };
        }
        return { status: 'error', message: result.error.message };
      }
      const items = Array.isArray(result.value.results) ? result.value.results : [];
      const classified = items.map((item) => MarketplaceShopClientService.classifySyncItem(item));
      for (const listing of chunk) {
        const match = classified.find((item) => item.listingId === listing.listing_id);
        if (match?.ok) {
          await this.checkpointGroup(manifestId, groups.get(listing.listing_id) ?? [], 'complete');
          synced += 1;
        } else {
          // Leave published_unsynced so resume retries sync without a second PUT.
          failed += 1;
        }
      }
    }
    return { status: 'ok', synced, failed };
  }

  private async checkpointGroup(
    manifestId: string,
    group: readonly HostPlannedImportRow[],
    checkpoint: HostImportCheckpoint,
  ): Promise<void> {
    await this.checkpointRows(manifestId, identitiesOf(group), checkpoint);
  }

  private async annotateGroup(
    manifestId: string,
    group: readonly HostPlannedImportRow[],
    failureCode: string,
  ): Promise<void> {
    await this.annotateRows(manifestId, identitiesOf(group), failureCode);
  }
}

function identitiesOf(rows: readonly HostPlannedImportRow[]): string[] {
  return rows.map((row) => row.rowIdentity);
}

function withRow(
  manifestVersion: number,
  rows: readonly HostPlannedImportRow[],
  row: HostPlannedImportRow,
): HostRowsSnapshot {
  return { manifestVersion, rows: rows.map((entry) => (entry.rowIdentity === row.rowIdentity ? row : entry)) };
}

const CHECKPOINT_HOPS: Readonly<Record<HostImportCheckpoint, readonly HostImportCheckpoint[]>> = {
  planned: ['publishing', 'conflict', 'failed'],
  publishing: ['published_unsynced', 'conflict', 'failed'],
  published_unsynced: ['complete', 'conflict', 'failed'],
  complete: [],
  conflict: [],
  failed: ['publishing', 'conflict'],
};

function addUrl(into: Set<string>, media: unknown): void {
  const url = typeof media === 'object' && media !== null ? (media as Record<string, unknown>).url : undefined;
  if (typeof url === 'string') into.add(url);
}

function isConflictRow(row: HostPlannedImportRow): boolean {
  return row.checkpoint === 'conflict' || row.intendedAction === 'conflict';
}

function isAcknowledgedConflict(row: HostPlannedImportRow): boolean {
  return (
    row.failureCode === CONFLICT_CONFIRMED || row.failureCode === CONFLICT_DISCARDED || row.checkpoint === 'failed'
  );
}

function publishHadStarted(row: HostPlannedImportRow): boolean {
  if (row.checkpoint === 'publishing' || row.checkpoint === 'published_unsynced' || row.checkpoint === 'complete') {
    return true;
  }
  return (row.checkpoint === 'conflict' || row.checkpoint === 'failed') && row.intendedAction !== 'conflict';
}

function remainingDryRunCounts(rows: readonly HostPlannedImportRow[]): DryRunCounts {
  const counts = { create: 0, update: 0, end: 0, unchanged: 0, conflict: 0 };
  for (const row of rows) {
    if (isAcknowledgedConflict(row)) continue;
    if (row.intendedAction === 'create') counts.create += 1;
    else if (row.intendedAction === 'update') counts.update += 1;
    else if (row.intendedAction === 'end') counts.end += 1;
    else if (row.intendedAction === 'unchanged') counts.unchanged += 1;
    else if (row.intendedAction === 'conflict') counts.conflict += 1;
  }
  return counts;
}

function firstUnresolvedConflict(groups: Map<string, HostPlannedImportRow[]>): string | null {
  for (const [listingId, group] of groups) {
    if (group.some((row) => isConflictRow(row) && !isAcknowledgedConflict(row))) return listingId;
  }
  return null;
}

function nextAllowedCheckpoint(from: HostImportCheckpoint, target: HostImportCheckpoint): HostImportCheckpoint | null {
  const allowed = CHECKPOINT_HOPS[from];
  if (allowed.includes(target)) return target;
  if (target === 'published_unsynced' && allowed.includes('publishing')) return 'publishing';
  if (target === 'complete' && allowed.includes('published_unsynced')) return 'published_unsynced';
  if (target === 'complete' && allowed.includes('publishing')) return 'publishing';
  if (target === 'published_unsynced' && allowed.includes('failed')) return null;
  return null;
}
