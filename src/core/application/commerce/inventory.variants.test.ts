import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INVENTORY_GRANT } from '@/services/marketplace/marketplace-inventory-grant';
import { MarketplaceInventorySessionService } from '@/services/marketplace/marketplace-inventory-session';
import { MarketplaceSessionService } from '@/services/marketplace/marketplace-session';
import { MarketplaceShopClientService, PubkyShopError } from '@/services/marketplace/marketplace-shop-client';
import {
  CommerceInventoryApplication,
  type InventoryBoardRow,
  planInventoryAdjust,
} from './inventory';

const PUBKY = 'y'.repeat(52);
const TOKEN = 'A'.repeat(43);

vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return {
    ...actual,
    getCommerceAdapterMode: () => 'transaction-service',
    getMarketplaceUrl: () => 'https://staging-api.pubky.app',
    isDurableCommerceMode: () => true,
  };
});

vi.mock('@/services/marketplace/marketplace-shop-client', () => {
  class MockPubkyShopError extends Error {
    readonly code: string;
    readonly details: { status?: number; serviceCode?: string };
    constructor(code: string, details: { status?: number; serviceCode?: string } = {}) {
      super(code);
      this.code = code;
      this.details = details;
    }
  }
  return {
    PubkyShopError: MockPubkyShopError,
    MarketplaceShopClientService: {
      createInventoryClient: vi.fn(() => ({ token: 'inventory' })),
      listSellerListings: vi.fn(),
      getInventoryProjection: vi.fn(),
      adjustInventory: vi.fn(),
      syncMany: vi.fn(),
      isCapabilityRequired: (error: InstanceType<typeof MockPubkyShopError>) =>
        error.code === 'service_error' && error.details.serviceCode === 'capability_required',
      isRevisionConflict: (error: InstanceType<typeof MockPubkyShopError>) =>
        error.code === 'service_error' && error.details.serviceCode === 'revision_conflict',
      isSessionRejected: (error: InstanceType<typeof MockPubkyShopError>) => error.code === 'session_rejected',
    },
  };
});

function row(overrides: Partial<InventoryBoardRow> = {}): InventoryBoardRow {
  return {
    listingId: 'boots',
    sellerPubky: PUBKY,
    aggregateId: `listing:${PUBKY}_boots`,
    title: 'Boots',
    thumbUrl: null,
    state: 'available',
    listingState: 'active',
    format: 'fixed_price',
    dropId: null,
    available: 4,
    reserved: 1,
    sold: 2,
    total: 7,
    serverRevision: 3,
    sync: 'synced',
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(MarketplaceSessionService, 'getActiveSession').mockReturnValue({
    token: TOKEN,
    pubky: PUBKY,
    capabilities: '',
    expiresAt: '2099-01-01T00:00:00.000Z',
    expiresAtMs: Date.parse('2099-01-01T00:00:00.000Z'),
    issuedAt: '2026-09-21T00:00:00.000Z',
  });
  vi.spyOn(MarketplaceInventorySessionService, 'getActiveSession').mockReturnValue({
    token: 'I'.repeat(43),
    pubky: PUBKY,
    capabilities: INVENTORY_GRANT,
    expiresAt: '2099-01-01T00:00:00.000Z',
    expiresAtMs: Date.parse('2099-01-01T00:00:00.000Z'),
    issuedAt: '2026-09-21T00:00:00.000Z',
  });
  vi.mocked(MarketplaceShopClientService.listSellerListings).mockReset();
  vi.mocked(MarketplaceShopClientService.getInventoryProjection).mockReset();
  vi.mocked(MarketplaceShopClientService.adjustInventory).mockReset();
  vi.mocked(MarketplaceShopClientService.syncMany).mockReset();
});

const KEY = '11111111-1111-4111-8111-111111111111';
type Projection = Awaited<ReturnType<typeof MarketplaceShopClientService.getInventoryProjection>>;

const sizeRow = (id: string, available: number, extra: Record<string, unknown> = {}) => ({
  variant_id: id,
  enabled: true,
  total: available + 1,
  available,
  reserved: 1,
  sold: 0,
  sold_out: available === 0,
  ...extra,
});

function projection(variants: unknown[] | undefined, available = 4, revision = 3): Projection {
  return {
    ok: true,
    value: {
      schema_version: BigInt(1),
      kind: 'inventory_projection',
      aggregate_id: `listing:${PUBKY}_boots`,
      seller_pubky: PUBKY,
      listing_id: 'boots',
      server_revision: BigInt(revision),
      stock: {
        authority: 'listing_total',
        available: BigInt(available),
        reserved: BigInt(2),
        sold: BigInt(0),
        total: BigInt(available + 2),
      },
      ...(variants ? { variants } : {}),
    },
  } as Projection;
}

const sizedRow = (): InventoryBoardRow =>
  row({
    variants: [
      { variantId: 'size_s', label: 'S', enabled: true, available: 0, reserved: 1, sold: 0, total: 1, soldOut: true },
      { variantId: 'size_m', label: 'M', enabled: true, available: 3, reserved: 1, sold: 0, total: 4, soldOut: false },
    ],
  });

const setSize = (overrides: { variantId?: string; row?: InventoryBoardRow; target?: number } = {}) =>
  CommerceInventoryApplication.setAvailable({
    sellerPubky: PUBKY,
    row: overrides.row ?? sizedRow(),
    variantId: 'variantId' in overrides ? overrides.variantId : 'size_m',
    targetAvailable: overrides.target ?? 5,
    idempotencyKey: KEY,
  });

describe('planInventoryAdjust per size', () => {
  it('names the size on the request', () => {
    const plan = planInventoryAdjust({
      listingId: 'boots',
      aggregateId: `listing:${PUBKY}_boots`,
      variantId: 'size_m',
      currentAvailable: 3,
      targetAvailable: 5,
      expectedRevision: 3,
      idempotencyKey: KEY,
    });
    expect(plan).toMatchObject({ ok: true, request: { delta: BigInt(2), variant: { id: 'size_m' } } });
  });

  it('sends no variant for a single-variant listing', () => {
    const plan = planInventoryAdjust({
      listingId: 'boots',
      aggregateId: `listing:${PUBKY}_boots`,
      currentAvailable: 3,
      targetAvailable: 5,
      expectedRevision: 3,
      idempotencyKey: KEY,
    });
    expect(plan.ok && plan.request).not.toHaveProperty('variant');
  });
});

describe('inventory board per size', () => {
  const listings = (record: Record<string, unknown>) =>
    ({
      ok: true as const,
      value: {
        kind: 'seller_listing_export',
        listings: [{ projection: { listing_id: 'boots', title: 'Boots', state: 'active' }, record }],
      },
    }) as never;

  it('reads one row per size, labelled from the record options', async () => {
    vi.mocked(MarketplaceShopClientService.listSellerListings).mockResolvedValue(
      listings({
        listingId: 'boots',
        variants: [
          { id: 'size_s', options: { size: 'S' } },
          { id: 'size_m', options: { size: 'M', color: 'Red' }, sku: 'BOOT-M' },
        ],
      }),
    );
    vi.mocked(MarketplaceShopClientService.getInventoryProjection).mockResolvedValue(
      projection([
        sizeRow('size_s', 0),
        sizeRow('size_m', 3, { sku: 'BOOT-M' }),
        sizeRow('size_x', 2, { enabled: false }),
      ]),
    );

    const board = await CommerceInventoryApplication.loadBoard(PUBKY);

    expect(board.status === 'ready' && board.rows[0].variants).toEqual([
      { variantId: 'size_s', label: 'S', enabled: true, available: 0, reserved: 1, sold: 0, total: 1, soldOut: true },
      {
        variantId: 'size_m',
        label: 'M · Red',
        sku: 'BOOT-M',
        enabled: true,
        available: 3,
        reserved: 1,
        sold: 0,
        total: 4,
        soldOut: false,
      },
      {
        variantId: 'size_x',
        label: 'size_x',
        enabled: false,
        available: 2,
        reserved: 1,
        sold: 0,
        total: 3,
        soldOut: false,
      },
    ]);
  });

  it('leaves a single-variant listing exactly as before', async () => {
    vi.mocked(MarketplaceShopClientService.listSellerListings).mockResolvedValue(listings({ listingId: 'boots' }));
    vi.mocked(MarketplaceShopClientService.getInventoryProjection).mockResolvedValue(projection(undefined));

    const board = await CommerceInventoryApplication.loadBoard(PUBKY);

    expect(board.status === 'ready' && board.rows[0]).not.toHaveProperty('variants');
  });
});

describe('set stock for a size', () => {
  it('sends the size and the delta from that size, then shows the re-read counts', async () => {
    vi.mocked(MarketplaceShopClientService.adjustInventory).mockResolvedValue({
      ok: true,
      value: { result: { stock: {}, server_revision: BigInt(4) } },
    } as never);
    vi.mocked(MarketplaceShopClientService.getInventoryProjection).mockResolvedValue(
      projection([sizeRow('size_s', 0), sizeRow('size_m', 5)], 5, 4),
    );

    const result = await setSize();

    expect(MarketplaceShopClientService.adjustInventory).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ delta: BigInt(2), variant: { id: 'size_m' }, expected_revision: BigInt(3) }),
    );
    expect(result.status).toBe('updated');
    if (result.status === 'updated') {
      expect(result.row.serverRevision).toBe(4);
      expect(result.row.variants?.find((size) => size.variantId === 'size_m')?.available).toBe(5);
    }
  });

  it('confirms by re-reading when the SDK cannot decode the size answer', async () => {
    vi.mocked(MarketplaceShopClientService.adjustInventory).mockResolvedValue({
      ok: false,
      error: new PubkyShopError('invalid_response'),
    });
    vi.mocked(MarketplaceShopClientService.getInventoryProjection).mockResolvedValue(
      projection([sizeRow('size_s', 0), sizeRow('size_m', 5)], 5, 4),
    );

    expect((await setSize()).status).toBe('updated');
  });

  it('says so when the re-read does not show the new stock', async () => {
    vi.mocked(MarketplaceShopClientService.adjustInventory).mockResolvedValue({
      ok: false,
      error: new PubkyShopError('invalid_response'),
    });
    vi.mocked(MarketplaceShopClientService.getInventoryProjection).mockResolvedValue(
      projection([sizeRow('size_s', 0), sizeRow('size_m', 3)]),
    );

    await expect(setSize()).resolves.toEqual({
      status: 'error',
      message: 'The stock change could not be confirmed. Refresh and check the size.',
    });
  });

  it('refuses a per-size listing without a size before calling the service', async () => {
    await expect(setSize({ variantId: undefined })).resolves.toEqual({
      status: 'error',
      message: 'Choose a size to set its stock.',
    });
    expect(MarketplaceShopClientService.adjustInventory).not.toHaveBeenCalled();
  });

  it('refuses a size that left the listing before calling the service', async () => {
    expect((await setSize({ variantId: 'size_gone' })).status).toBe('error');
    expect(MarketplaceShopClientService.adjustInventory).not.toHaveBeenCalled();
  });

  it('keeps the revision conflict path for a size', async () => {
    vi.mocked(MarketplaceShopClientService.adjustInventory).mockResolvedValue({
      ok: false,
      error: new PubkyShopError('service_error', { status: 409, serviceCode: 'revision_conflict' }),
    });

    await expect(setSize()).resolves.toEqual({ status: 'revision_conflict' });
  });

  it('explains a stale size mapping in plain words', async () => {
    vi.mocked(MarketplaceShopClientService.adjustInventory).mockResolvedValue({
      ok: false,
      error: new PubkyShopError('service_error', { status: 409, serviceCode: 'variant_assertion_mismatch' }),
    });

    await expect(setSize()).resolves.toEqual({
      status: 'error',
      message: 'This listing’s sizes changed. Refresh and try again.',
    });
  });
});
