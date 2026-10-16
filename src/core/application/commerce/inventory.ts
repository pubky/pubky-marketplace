import type { InventoryAdjustRequest } from '@bitcoinerrorlog/pubky-shop';
import { getCommerceAdapterMode, isDurableCommerceMode } from '@/config/commerce';
import { effectiveListingState } from '@/libs/commerce/auction-phase';
import type { CommerceListingRecord } from '@/libs/commerce/marketplace-records';
import { buildMarketplaceListingAggregateId } from '@/libs/commerce/transaction-commands';
import { isUnlimitedStock } from '@/libs/commerce/unlimited-stock';
import { ClientErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import {
  type InventoryBearer,
  MarketplaceInventorySessionService,
} from '@/services/marketplace/marketplace-inventory-session';
import { MarketplaceSessionService } from '@/services/marketplace/marketplace-session';
import { MarketplaceShopClientService, PubkyShopError } from '@/services/marketplace/marketplace-shop-client';

/** One size of a per-size listing, from the seller inventory read. */
export type InventoryBoardVariant = {
  variantId: string;
  /** The size as the buyer reads it: the record's options, else the SKU, else the id. */
  label: string;
  sku?: string;
  /** False for a size the seller withdrew from the record; it keeps its counts. */
  enabled: boolean;
  available: number;
  reserved: number;
  sold: number;
  total: number;
  soldOut: boolean;
};

export type InventoryBoardRow = {
  listingId: string;
  sellerPubky: string;
  aggregateId: string;
  title: string;
  thumbUrl: string | null;
  /** The service's stock state (`available`, `reserved`, `sold`), not whether buyers can see the listing. */
  state: string;
  /**
   * The owner-signed record's lifecycle state (`active`, `paused`, `ended`, `removed`), the state My shop
   * shows. An active auction past its end time reads `ended`. Null when the export carries no record.
   */
  listingState: string | null;
  format: string;
  dropId: string | null;
  available: number;
  reserved: number;
  sold: number;
  total: number;
  serverRevision: number;
  /** Present only for a listing the service tracks per size. Counts above are then the listing sums. */
  variants?: InventoryBoardVariant[];
  /** Set when the listing record itself is unlimited. Available may be lower while a hold reserves units. */
  unlimited?: boolean;
  sync: 'synced' | 'missing';
  syncMessage?: string | null;
  recordStatus?: 'unavailable';
};

export type InventoryBoardLoad =
  | { status: 'durable-unavailable' }
  | { status: 'unauthenticated' }
  | { status: 'session-required' }
  | { status: 'grant-needed' }
  | { status: 'empty'; rows: [] }
  | { status: 'ready'; rows: InventoryBoardRow[] }
  | { status: 'error'; message: string };

export type InventoryAdjustPlan =
  | { ok: true; request: InventoryAdjustRequest }
  | { ok: false; reason: 'delta_zero' | 'negative_available' };

export type InventorySetResult =
  | { status: 'updated'; row: InventoryBoardRow }
  | { status: 'grant-needed' }
  | { status: 'revision_conflict' }
  | { status: 'session-required' }
  | { status: 'error'; message: string };

export type InventoryRetryResult =
  | { status: 'synced'; listingId: string }
  | { status: 'missing'; listingId: string; message: string }
  | { status: 'grant-needed' }
  | { status: 'error'; message: string };

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asInt(value: unknown): number | null {
  if (typeof value === 'bigint') {
    if (value < BigInt(0) || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  return null;
}

function variantsField(variants: InventoryBoardVariant[] | undefined): { variants?: InventoryBoardVariant[] } {
  return variants ? { variants } : {};
}

function thumbUrl(record: Record<string, unknown> | null): string | null {
  const media = record?.media;
  if (!Array.isArray(media) || media.length === 0) return null;
  const first = media[0];
  if (typeof first === 'string') return first;
  const object = asObject(first);
  return asString(object?.url) ?? asString(object?.src);
}

function dropIdFromRecord(record: Record<string, unknown> | null): string | null {
  const edition = asObject(record?.edition);
  return asString(edition?.dropId) ?? asString(record?.dropId);
}

function listingStateFromRecord(record: Record<string, unknown> | null, nowMs: number): string | null {
  const state = asString(record?.state);
  if (!state) return null;
  const sale = asObject(record?.sale);
  const auctionEndsAt = asString(sale?.format) === 'auction' ? asString(sale?.endsAt) : null;
  return effectiveListingState(state, auctionEndsAt, nowMs);
}

function recordStatusFromExport(entry: Record<string, unknown>): 'unavailable' | undefined {
  return entry.record_status === 'unavailable' ? 'unavailable' : undefined;
}

const EXPORT_FULFILLMENT_METHODS = ['physical', 'shipping', 'pickup', 'digital'] as const;

function exportRecordIsUnlimited(record: Record<string, unknown> | null): boolean {
  if (!record) return false;
  const methods = Array.isArray(record.fulfillmentMethods)
    ? record.fulfillmentMethods.filter(
        (method): method is CommerceListingRecord['fulfillmentMethods'][number] =>
          typeof method === 'string' && (EXPORT_FULFILLMENT_METHODS as readonly string[]).includes(method),
      )
    : [];
  const variants = Array.isArray(record.variants) ? record.variants : [];
  return variants.some((entry) => {
    const object = asObject(entry);
    const quantity = object ? asInt(object.quantity) : null;
    return quantity !== null && isUnlimitedStock({ fulfillmentMethods: methods }, quantity);
  });
}

function recordVariantLabels(record: Record<string, unknown> | null): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  const variants = Array.isArray(record?.variants) ? record.variants : [];
  for (const entry of variants) {
    const object = asObject(entry);
    const id = asString(object?.id);
    if (!id) continue;
    const options = asObject(object?.options);
    const text = options
      ? Object.values(options)
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
          .join(' · ')
      : '';
    labels.set(id, text || asString(object?.sku) || id);
  }
  return labels;
}

/** The per-size rows of one inventory read; undefined when the service sends none (a single-variant listing). */
function parseBoardVariants(value: unknown, labels: ReadonlyMap<string, string>): InventoryBoardVariant[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const rows: InventoryBoardVariant[] = [];
  for (const entry of value) {
    const object = asObject(entry);
    const variantId = asString(object?.variant_id);
    const available = asInt(object?.available);
    const reserved = asInt(object?.reserved);
    const sold = asInt(object?.sold);
    const total = asInt(object?.total);
    if (!object || !variantId || available === null || reserved === null || sold === null || total === null) continue;
    const sku = asString(object.sku);
    rows.push({
      variantId,
      label: labels.get(variantId) ?? sku ?? variantId,
      ...(sku ? { sku } : {}),
      enabled: object.enabled !== false,
      available,
      reserved,
      sold,
      total,
      soldOut: object.sold_out === true || available === 0,
    });
  }
  return rows.length > 0 ? rows : undefined;
}

export function planInventoryAdjust(input: {
  listingId: string;
  aggregateId: string;
  currentAvailable: number;
  targetAvailable: number;
  expectedRevision: number;
  idempotencyKey: string;
  /** Names the size on a per-size listing; the service refuses an adjust without one. */
  variantId?: string;
}): InventoryAdjustPlan {
  if (!Number.isSafeInteger(input.targetAvailable) || input.targetAvailable < 0) {
    return { ok: false, reason: 'negative_available' };
  }
  if (input.targetAvailable === input.currentAvailable) {
    return { ok: false, reason: 'delta_zero' };
  }
  const delta = BigInt(input.targetAvailable - input.currentAvailable);
  return {
    ok: true,
    request: {
      schema_version: 1,
      kind: 'inventory.adjust',
      aggregate_id: input.aggregateId,
      listing_id: input.listingId,
      expected_revision: BigInt(input.expectedRevision),
      delta,
      idempotency_key: input.idempotencyKey,
      ...(input.variantId ? { variant: { id: input.variantId } } : {}),
    },
  };
}

function syncManyHttpOk(status: unknown): boolean {
  if (typeof status === 'number') return status >= 200 && status < 300;
  if (typeof status === 'bigint') return status >= BigInt(200) && status < BigInt(300);
  if (typeof status === 'string') {
    if (status === 'success' || status === 'ok') return true;
    const parsed = Number(status);
    return Number.isInteger(parsed) && parsed >= 200 && parsed < 300;
  }
  return false;
}

function syncManyItemError(item: Record<string, unknown>): string {
  const result = asObject(item.result);
  const error = asObject(result?.error) ?? asObject(item.error);
  return asString(error?.message) ?? asString(item.message) ?? 'Published, not yet registered for checkout';
}

/** Classify one 207 `listing.sync_many` result. HTTP 207 is the envelope, not success. */
export function classifySyncManyItem(item: unknown): { listingId: string | null; ok: boolean; message: string } {
  const object = asObject(item);
  if (!object) {
    return { listingId: null, ok: false, message: 'The service returned an invalid sync result.' };
  }
  const listingId = asString(object.listing_id);
  if (syncManyHttpOk(object.status)) {
    return { listingId, ok: true, message: 'Synced' };
  }
  return { listingId, ok: false, message: syncManyItemError(object) };
}

function classifyClientError(error: PubkyShopError): InventoryBoardLoad['status'] | 'revision_conflict' {
  if (MarketplaceShopClientService.isSessionRejected(error)) return 'session-required';
  if (MarketplaceShopClientService.isCapabilityRequired(error)) return 'grant-needed';
  if (MarketplaceShopClientService.isRevisionConflict(error)) return 'revision_conflict';
  return 'error';
}

const VARIANT_ADJUST_COPY = {
  required: 'Choose a size to set its stock.',
  unknown: 'That size is no longer on this listing. Refresh and try again.',
  stale: 'This listing’s sizes changed. Refresh and try again.',
  unconfirmed: 'The stock change could not be confirmed. Refresh and check the size.',
} as const;

/** Plain copy for the service refusals a size adjust adds; null for any other error. */
function variantAdjustRefusal(error: PubkyShopError): string | null {
  const serviceCode = (error.details as { serviceCode?: string }).serviceCode;
  if (serviceCode === 'variant_required') return VARIANT_ADJUST_COPY.required;
  if (serviceCode === 'variant_assertion_mismatch' || serviceCode === 'variant_lookup_unavailable') {
    return VARIANT_ADJUST_COPY.stale;
  }
  return null;
}

export class CommerceInventoryApplication {
  private constructor() {}

  static restoreInventorySession(pubky: string) {
    return MarketplaceInventorySessionService.restorePersistedSession(pubky);
  }

  static clearInventorySession(): void {
    MarketplaceInventorySessionService.clearSession('cleared');
  }

  static clearInventorySessionForSignOut(): void {
    MarketplaceInventorySessionService.clearForSignOut();
  }

  static clearInventorySessionsOfOtherAccounts(keepPubky: string): void {
    MarketplaceInventorySessionService.clearOtherAccounts(keepPubky);
  }

  static onInventorySessionEnded(
    listener: Parameters<typeof MarketplaceInventorySessionService.onSessionEnded>[0],
  ): () => void {
    return MarketplaceInventorySessionService.onSessionEnded(listener);
  }

  static beginInventorySessionFlow(expectedPubky: string) {
    return MarketplaceInventorySessionService.beginInventorySessionFlow(expectedPubky);
  }

  static async loadBoard(sellerPubky: string): Promise<InventoryBoardLoad> {
    if (!isDurableCommerceMode(getCommerceAdapterMode())) {
      return { status: 'durable-unavailable' };
    }
    if (!sellerPubky) {
      return { status: 'unauthenticated' };
    }
    if (!MarketplaceSessionService.getActiveSession()) {
      return { status: 'session-required' };
    }
    const inventory = MarketplaceInventorySessionService.getCoveringBearer(sellerPubky);
    if (!inventory) {
      return { status: 'grant-needed' };
    }

    const client = MarketplaceShopClientService.createInventoryClient(inventory.token);
    const rows: InventoryBoardRow[] = [];
    const nowMs = Date.now();
    let cursor: string | undefined;
    for (;;) {
      const page = await MarketplaceShopClientService.listSellerListings(client, sellerPubky, {
        limit: 100,
        cursor,
      });
      if (!page.ok) {
        return this.boardError(page.error, inventory);
      }
      const listings = page.value.listings;
      if (!Array.isArray(listings)) {
        return { status: 'error', message: 'The service returned an invalid listings page.' };
      }
      for (const entry of listings) {
        const object = asObject(entry);
        if (!object) continue;
        const projection = asObject(object.projection);
        const record = asObject(object.record);
        const listingId = asString(projection?.listing_id) ?? asString(record?.listingId);
        if (!listingId) continue;
        const unlimited = exportRecordIsUnlimited(record);
        const aggregateId =
          asString(projection?.aggregate_id) ?? buildMarketplaceListingAggregateId(sellerPubky, listingId);
        const inventoryResult = await MarketplaceShopClientService.getInventoryProjection(client, aggregateId);
        if (!inventoryResult.ok) {
          if (MarketplaceShopClientService.isCapabilityRequired(inventoryResult.error)) {
            return { status: 'grant-needed' };
          }
          if (MarketplaceShopClientService.isSessionRejected(inventoryResult.error)) {
            MarketplaceInventorySessionService.clearRejectedBearer(inventory);
            return { status: 'grant-needed' };
          }
          rows.push({
            listingId,
            sellerPubky,
            aggregateId,
            title: asString(projection?.title) ?? asString(record?.title) ?? listingId,
            thumbUrl: thumbUrl(record),
            state: asString(projection?.state) ?? 'unknown',
            listingState: listingStateFromRecord(record, nowMs),
            format: asString(projection?.sale_format) ?? asString(asObject(record?.sale)?.format) ?? 'fixed_price',
            dropId: dropIdFromRecord(record),
            available: asInt(projection?.available_quantity) ?? 0,
            reserved: asInt(projection?.reserved_quantity) ?? 0,
            sold: asInt(projection?.sold_quantity) ?? 0,
            total: asInt(projection?.total_quantity) ?? 0,
            serverRevision: asInt(projection?.server_revision) ?? 0,
            ...(unlimited ? { unlimited: true as const } : {}),
            sync: 'missing',
            ...(recordStatusFromExport(object) ? { recordStatus: 'unavailable' as const } : {}),
          });
          continue;
        }
        const stock = inventoryResult.value.stock;
        rows.push({
          listingId,
          sellerPubky,
          aggregateId,
          title: asString(projection?.title) ?? asString(record?.title) ?? listingId,
          thumbUrl: thumbUrl(record),
          state: asString(projection?.state) ?? 'unknown',
          listingState: listingStateFromRecord(record, nowMs),
          format: asString(projection?.sale_format) ?? asString(asObject(record?.sale)?.format) ?? 'fixed_price',
          dropId: dropIdFromRecord(record),
          available: Number(stock.available),
          reserved: Number(stock.reserved),
          sold: Number(stock.sold),
          total: Number(stock.total),
          serverRevision: Number(inventoryResult.value.server_revision),
          ...variantsField(parseBoardVariants(inventoryResult.value.variants, recordVariantLabels(record))),
          ...(unlimited ? { unlimited: true as const } : {}),
          sync: 'synced',
          ...(recordStatusFromExport(object) ? { recordStatus: 'unavailable' as const } : {}),
        });
      }
      const next = asString(page.value.next_cursor);
      if (!next) break;
      cursor = next;
    }
    if (rows.length === 0) {
      return { status: 'empty', rows: [] };
    }
    return { status: 'ready', rows };
  }

  static async setAvailable(input: {
    sellerPubky: string;
    row: InventoryBoardRow;
    targetAvailable: number;
    idempotencyKey: string;
    /** The size to set on a per-size listing. */
    variantId?: string;
  }): Promise<InventorySetResult> {
    const inventory = MarketplaceInventorySessionService.getCoveringBearer(input.sellerPubky);
    if (!inventory) {
      return { status: 'grant-needed' };
    }
    const variant = input.variantId
      ? input.row.variants?.find(({ variantId }) => variantId === input.variantId)
      : undefined;
    if (input.variantId && !variant) {
      return { status: 'error', message: VARIANT_ADJUST_COPY.unknown };
    }
    if (!input.variantId && input.row.variants) {
      return { status: 'error', message: VARIANT_ADJUST_COPY.required };
    }
    const plan = planInventoryAdjust({
      listingId: input.row.listingId,
      aggregateId: input.row.aggregateId,
      variantId: input.variantId,
      currentAvailable: variant ? variant.available : input.row.available,
      targetAvailable: input.targetAvailable,
      expectedRevision: input.row.serverRevision,
      idempotencyKey: input.idempotencyKey,
    });
    if (!plan.ok) {
      return { status: 'error', message: plan.reason };
    }
    const client = MarketplaceShopClientService.createInventoryClient(inventory.token);
    const result = await MarketplaceShopClientService.adjustInventory(client, plan.request);
    if (!result.ok) {
      const classified = classifyClientError(result.error);
      if (classified === 'grant-needed') {
        if (MarketplaceShopClientService.isSessionRejected(result.error)) {
          MarketplaceInventorySessionService.clearRejectedBearer(inventory);
        }
        return { status: 'grant-needed' };
      }
      if (classified === 'revision_conflict') {
        return { status: 'revision_conflict' };
      }
      if (classified === 'session-required') {
        MarketplaceInventorySessionService.clearRejectedBearer(inventory);
        return { status: 'grant-needed' };
      }
      return { status: 'error', message: variantAdjustRefusal(result.error) ?? result.error.message };
    }
    const stock = result.value.result.stock;
    if (variant) {
      if (stock.authority !== 'variant' || stock.variant_id !== variant.variantId) {
        return { status: 'error', message: VARIANT_ADJUST_COPY.unconfirmed };
      }
      const available = Number(stock.available);
      return {
        status: 'updated',
        row: {
          ...input.row,
          available: Number(stock.listing_total.available),
          reserved: Number(stock.listing_total.reserved),
          sold: Number(stock.listing_total.sold),
          total: Number(stock.listing_total.total),
          serverRevision: Number(result.value.result.server_revision),
          sync: 'synced',
          variants: input.row.variants?.map((entry) =>
            entry.variantId === variant.variantId
              ? {
                  ...entry,
                  available,
                  reserved: Number(stock.reserved),
                  sold: Number(stock.sold),
                  total: Number(stock.total),
                  soldOut: available === 0,
                }
              : entry,
          ),
        },
      };
    }
    return {
      status: 'updated',
      row: {
        ...input.row,
        available: Number(stock.available),
        reserved: Number(stock.reserved),
        sold: Number(stock.sold),
        total: Number(stock.total),
        serverRevision: Number(result.value.result.server_revision),
        sync: 'synced',
      },
    };
  }

  static async retrySync(sellerPubky: string, listingId: string): Promise<InventoryRetryResult> {
    const inventory = MarketplaceInventorySessionService.getCoveringBearer(sellerPubky);
    if (!inventory) return { status: 'grant-needed' };
    const client = MarketplaceShopClientService.createInventoryClient(inventory.token);
    const result = await MarketplaceShopClientService.syncMany(client, [
      { seller_pubky: sellerPubky, listing_id: listingId },
    ]);
    if (!result.ok) {
      const classified = classifyClientError(result.error);
      if (classified === 'grant-needed' || classified === 'session-required') {
        if (MarketplaceShopClientService.isSessionRejected(result.error)) {
          MarketplaceInventorySessionService.clearRejectedBearer(inventory);
        }
        return { status: 'grant-needed' };
      }
      return { status: 'error', message: result.error.message };
    }
    const items = Array.isArray(result.value.results) ? result.value.results : [];
    const match = items.map((item) => classifySyncManyItem(item)).find((item) => item.listingId === listingId);
    if (!match) {
      return {
        status: 'missing',
        listingId,
        message: 'The service did not return a sync result for this listing.',
      };
    }
    if (match.ok) {
      return { status: 'synced', listingId };
    }
    return { status: 'missing', listingId, message: match.message };
  }

  private static boardError(error: PubkyShopError, bearer: InventoryBearer): InventoryBoardLoad {
    const classified = classifyClientError(error);
    if (classified === 'grant-needed') return { status: 'grant-needed' };
    if (classified === 'session-required') {
      MarketplaceInventorySessionService.clearRejectedBearer(bearer);
      return { status: 'grant-needed' };
    }
    return { status: 'error', message: error.message };
  }

  static requireDurable(): void {
    if (!isDurableCommerceMode(getCommerceAdapterMode())) {
      throw Err.client(ClientErrorCode.BAD_REQUEST, 'Inventory Studio requires the durable transaction service.', {
        service: ErrorService.Marketplace,
        operation: 'inventory',
      });
    }
  }
}
