import { CommerceApplication } from '@/application/commerce/commerce';
import { CommerceDeliveryKeysApplication } from '@/application/commerce/delivery-keys';
import {
  type CanonicalImportRow,
  listingToCanonicalRows,
  mapCanonicalRowsToListing,
} from '@/application/commerce/inventory-listing-map';
import { getCommerceAdapterMode, isDurableCommerceMode } from '@/config/commerce';
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
  continueRevision,
  keepLiveRecord,
  type KeptLiveSkip,
  keptLiveSkipText,
  rowsSupplyPackage,
} from '@/pipes/commerce/import-keep-live';
import type { ImportLossReport, ImportSourceFormat } from '@/pipes/commerce/import-loss-report';
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
import { CommerceHomeserverService } from '@/services/homeserver/commerce/commerce';
import { LocalCommerceService } from '@/services/local/commerce/commerce';
import {
  DexieManifestStore,
  type HostImportCheckpoint,
  type HostPlannedImportRow,
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
  PubkyShopError,
  type SdkResult,
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
  putListing: (record: CommerceListingRecord) => Promise<void>;
  listingExists: (url: string) => Promise<boolean>;
  syncMany: (listings: readonly SyncManyListing[]) => Promise<SdkResult<SyncManyEnvelope>>;
  currentItems: () => Promise<Readonly<Record<string, CurrentImportItem>>>;
  localRecords: () => Promise<readonly CommerceListingRecord[]>;
  loadPaymentConfig: (sellerPubky: string) => Promise<SellerPaymentConfig>;
  loadDeliveryKeyPublication: (sellerPubky: string) => Promise<SellerDeliveryKeyPublication>;
  loadShop: (sellerPubky: string) => Promise<CommerceShopRecord | null>;
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
    if (!planned.ok) {
      return {
        status: 'parse-failed',
        message: MarketplaceShopClientService.formatPlanFailure(planned.error),
        puts: 0,
      };
    }
    const manifest = await this.host.store.load(planned.value.manifestId);
    if (!manifest) {
      return { status: 'parse-failed', message: IMPORT_PARSE_FAIL_COPY, puts: 0 };
    }
    return {
      status: 'planned',
      manifestId: planned.value.manifestId,
      rowCount: planned.value.rowCount,
      publishGate: planned.value.rowCount === 0 ? NO_PUBLISH_GATE : await this.publishGate(planned.value.manifestId),
      counts: MarketplaceShopClientService.dryRunCounts(manifest as ImportManifest),
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
          for (const row of group) await this.annotateRowFailure(manifestId, row.rowIdentity, note);
        }
      }
      if (needsSync) {
        pendingSync.push({ seller_pubky: this.host.sellerPubky, listing_id: listingId });
      }
    }

    const sync = await this.syncPending(manifestId, pendingSync);
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
    const lines = ['listing_id,row_identity,checkpoint,result'];
    for (const row of manifest?.rows ?? []) {
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
      lines.push([row.listingId, row.rowIdentity, row.checkpoint, result].map(csvCell).join(','));
    }
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
          await this.checkpointRow(manifestId, row.rowIdentity, hop);
        }
      }
      await this.annotateRowFailure(manifestId, row.rowIdentity, failureCode);
    }
  }

  private async annotateRowFailure(manifestId: string, rowIdentity: string, failureCode: string): Promise<void> {
    for (;;) {
      const manifest = await this.host.store.load(manifestId);
      if (!manifest) return;
      const row = manifest.rows.find((entry) => entry.rowIdentity === rowIdentity);
      if (!row || row.failureCode === failureCode) return;
      try {
        await this.host.store.compareAndSwap(manifestId, manifest.manifestVersion, (current) => ({
          ...current,
          manifestVersion: current.manifestVersion + 1,
          rows: current.rows.map((entry) => (entry.rowIdentity === rowIdentity ? { ...entry, failureCode } : entry)),
        }));
        return;
      } catch (error) {
        if (!isManifestConflict(error)) return;
      }
    }
  }

  private async checkpointRow(
    manifestId: string,
    rowIdentity: string,
    checkpoint: HostImportCheckpoint,
  ): Promise<void> {
    for (;;) {
      const manifest = await this.host.store.load(manifestId);
      if (!manifest) return;
      const row = manifest.rows.find((entry) => entry.rowIdentity === rowIdentity);
      if (!row || row.checkpoint === checkpoint) return;
      const hop = nextAllowedCheckpoint(row.checkpoint, checkpoint);
      if (hop === null) return;
      const result = await MarketplaceShopClientService.checkpointRow(
        this.host.store,
        manifestId,
        manifest.manifestVersion,
        row.rowIdentity,
        hop,
      );
      if (!result.ok) return;
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
        await this.checkpointGroup(manifestId, listingId, 'published_unsynced');
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
      await this.checkpointGroup(manifestId, listingId, 'failed');
      for (const row of group) await this.annotateRowFailure(manifestId, row.rowIdentity, failureCode);
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
        await this.checkpointGroup(manifestId, listingId, 'failed');
        const failureCode = `${failure.code}: ${failure.message}`;
        for (const row of group) await this.annotateRowFailure(manifestId, row.rowIdentity, failureCode);
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

    await this.checkpointGroup(manifestId, listingId, 'publishing');
    try {
      await this.host.putListing(record);
    } catch (error) {
      if (isAppError(error) && error.code === ClientErrorCode.CONFLICT) {
        await this.checkpointGroup(manifestId, listingId, 'conflict');
        return { status: 'conflict', listingId, message: IMPORT_CONFLICT_COPY };
      }
      if (isAppError(error) && isNotFound(error)) {
        await this.checkpointGroup(manifestId, listingId, 'failed');
        return { status: 'error', message: error.message };
      }
      await this.checkpointGroup(manifestId, listingId, 'failed');
      return { status: 'error', message: error instanceof Error ? error.message : IMPORT_PARSE_FAIL_COPY };
    }
    await this.checkpointGroup(manifestId, listingId, 'published_unsynced');
    return { status: 'ok', ...(pausedBy ? { pausedBy } : {}), ...(keptLive ? { keptLive } : {}) };
  }

  private async syncPending(
    manifestId: string,
    listings: readonly SyncManyListing[],
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
          await this.checkpointGroup(manifestId, listing.listing_id, 'complete');
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
    listingId: string,
    checkpoint: HostImportCheckpoint,
  ): Promise<void> {
    for (;;) {
      const manifest = await this.host.store.load(manifestId);
      if (!manifest) return;
      const row = manifest.rows.find((entry) => entry.listingId === listingId && entry.checkpoint !== checkpoint);
      if (!row) return;
      const hop = nextAllowedCheckpoint(row.checkpoint, checkpoint);
      if (hop === null) return;
      const result = await MarketplaceShopClientService.checkpointRow(
        this.host.store,
        manifestId,
        manifest.manifestVersion,
        row.rowIdentity,
        hop,
      );
      if (!result.ok) return;
    }
  }
}

const CHECKPOINT_HOPS: Readonly<Record<HostImportCheckpoint, readonly HostImportCheckpoint[]>> = {
  planned: ['publishing', 'conflict', 'failed'],
  publishing: ['published_unsynced', 'conflict', 'failed'],
  published_unsynced: ['complete', 'conflict', 'failed'],
  complete: [],
  conflict: [],
  failed: ['publishing', 'conflict'],
};

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
