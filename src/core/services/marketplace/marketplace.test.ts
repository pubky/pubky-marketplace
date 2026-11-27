import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IMAGE_MAX_UPLOAD_SIZE } from '@/config/images';
import { buildMarketplaceListingAggregateId } from '@/libs/commerce/transaction-commands';
import { Logger } from '@/libs/logger/logger';
import { createOrderFixture, createPaymentFixture } from '@/test/fixtures/commerce/orders';
import { MarketplaceGatewayService } from './marketplace';

const SELLER = 'y'.repeat(52);
const AGGREGATE_ID = buildMarketplaceListingAggregateId(SELLER, 'boots_01');
const config = vi.hoisted(() => ({
  mode: 'sandbox' as string,
}));

// These transport tests do not exercise homeserver IO. Avoid the SDK's global fetch wrapper.
vi.mock('@/services/homeserver/homeserver', () => ({ HomeserverService: {} }));

vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return {
    ...actual,
    getCommerceAdapterMode: () => config.mode,
    getMarketplaceUrl: () => 'http://localhost:3100',
  };
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function command() {
  return {
    version: 1 as const,
    commandId: '00000000-0000-4000-8000-000000000700',
    aggregateId: AGGREGATE_ID,
    expectedRevision: 1,
    issuedAt: '2026-08-19T23:00:00.000Z',
    kind: 'auction.place_bid' as const,
    payload: {
      maximumAmount: { amountMinor: 10_000, currency: 'USD', exponent: 2 },
    },
  };
}

describe('MarketplaceGatewayService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.mode = 'sandbox';
  });

  it('executes a closed sandbox command with the Pubky actor header', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, {
        ok: true,
        version: 1,
        commandId: command().commandId,
        aggregateId: AGGREGATE_ID,
        revision: 2,
        eventIds: ['00000000-0000-4000-8000-000000000701'],
        result: { kind: 'bid' },
      }),
    );

    await expect(MarketplaceGatewayService.execute(SELLER, command())).resolves.toMatchObject({
      ok: true,
      result: { kind: 'bid' },
    });
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3100/v1/commands',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-pubky-actor': SELLER }),
      }),
    );
  });

  it('fails closed when sandbox mode is not explicit', async () => {
    config.mode = 'unavailable';

    await expect(MarketplaceGatewayService.execute(SELLER, command())).rejects.toMatchObject({
      name: 'AppError',
      code: 'BAD_REQUEST',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('routes command execution to the transaction-service transport in transaction-service mode', async () => {
    config.mode = 'transaction-service';

    // The real transport authenticates with a bearer session, never with the
    // sandbox actor header — with no session established it must refuse to send.
    await expect(MarketplaceGatewayService.execute(SELLER, command())).rejects.toMatchObject({
      name: 'AppError',
      code: 'SESSION_EXPIRED',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('routes the durable read projections to the transaction-service transport in transaction-service mode', async () => {
    config.mode = 'transaction-service';

    // The transport authenticates every read with a bearer session — with no
    // session established each read must refuse before any bytes leave.
    await expect(MarketplaceGatewayService.getListing(SELLER, AGGREGATE_ID)).rejects.toMatchObject({
      code: 'SESSION_EXPIRED',
    });
    await expect(MarketplaceGatewayService.getOffers(SELLER)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    await expect(MarketplaceGatewayService.getOrders(SELLER)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    await expect(MarketplaceGatewayService.getNotifications(SELLER)).rejects.toMatchObject({
      code: 'SESSION_EXPIRED',
    });
    await expect(MarketplaceGatewayService.getPayment(SELLER, 'payment-id')).rejects.toMatchObject({
      code: 'SESSION_EXPIRED',
    });
    await expect(MarketplaceGatewayService.getReceipt(SELLER, 'receipt-id')).rejects.toMatchObject({
      code: 'SESSION_EXPIRED',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses durable listing reads without a signed-in actor to bind the session', async () => {
    config.mode = 'transaction-service';

    await expect(MarketplaceGatewayService.getListing(null, AGGREGATE_ID)).rejects.toMatchObject({
      code: 'SESSION_EXPIRED',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('routes single-order reads to the transaction-service transport in transaction-service mode', async () => {
    config.mode = 'transaction-service';

    // The transport authenticates every read with a bearer session — with no
    // session established each read must refuse before any bytes leave.
    await expect(MarketplaceGatewayService.getOrder(SELLER, 'order-id')).rejects.toMatchObject({
      code: 'SESSION_EXPIRED',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the projections without a durable counterpart sandbox-only in transaction-service mode', async () => {
    config.mode = 'transaction-service';

    await expect(MarketplaceGatewayService.getConversations(SELLER)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(MarketplaceGatewayService.getNotificationPreferences(SELLER)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(
      MarketplaceGatewayService.uploadAttachment(SELLER, 'b'.repeat(52), new File([], 'proof.jpg')),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(MarketplaceGatewayService.fetchAttachment(SELLER, 'attachment-id')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns null for an unknown authoritative listing projection', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(404, { error: { code: 'NOT_FOUND' } }));

    // The sandbox projection is public: no actor is required to read it.
    await expect(MarketplaceGatewayService.getListing(null, AGGREGATE_ID)).resolves.toBeNull();
  });

  it('validates private conversation and notification query projections', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse(200, {
          conversations: [
            {
              id: `conversation:${SELLER}_${'b'.repeat(52)}_boots_01`,
              listingAggregateId: AGGREGATE_ID,
              sellerPubky: SELLER,
              buyerPubky: 'b'.repeat(52),
              revision: 1,
              lastMessageAt: '2026-08-19T23:00:00.000Z',
              messages: [
                {
                  id: '00000000-0000-4000-8000-000000000930',
                  senderPubky: 'b'.repeat(52),
                  recipientPubky: SELLER,
                  text: 'Hello',
                  attachments: [],
                  createdAt: '2026-08-19T23:00:00.000Z',
                },
              ],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          notifications: [
            {
              id: '00000000-0000-4000-8000-000000000931',
              revision: 1,
              recipientPubky: SELLER,
              actorPubky: 'b'.repeat(52),
              type: 'message_received',
              aggregateId: `conversation:${SELLER}_${'b'.repeat(52)}_boots_01`,
              createdAt: '2026-08-19T23:00:00.000Z',
              readAt: null,
            },
          ],
        }),
      );

    await expect(MarketplaceGatewayService.getConversations(SELLER)).resolves.toHaveLength(1);
    await expect(MarketplaceGatewayService.getNotifications(SELLER)).resolves.toHaveLength(1);
  });

  it('validates revisioned notification preferences', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, {
        ownerPubky: SELLER,
        revision: 2,
        messages: true,
        offers: false,
        bids: true,
        auctions: true,
        updatedAt: '2026-08-19T23:00:00.000Z',
      }),
    );

    await expect(MarketplaceGatewayService.getNotificationPreferences(SELLER)).resolves.toMatchObject({
      revision: 2,
      offers: false,
    });
  });

  it('uploads and integrity-checks participant attachments', async () => {
    const recipient = 'b'.repeat(52);
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x01, 0x02]);
    const contentHash = bytesToHex(blake3(bytes));
    const file = new File([bytes], 'proof.jpg', { type: 'image/jpeg' });
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse(201, {
          id: '00000000-0000-4000-8000-000000000990',
          senderPubky: SELLER,
          recipientPubky: recipient,
          mimeType: 'image/jpeg',
          byteSize: bytes.byteLength,
          contentHash,
          createdAt: '2026-08-19T23:00:00.000Z',
        }),
      )
      .mockResolvedValueOnce(
        new Response(bytes, {
          status: 200,
          headers: { 'content-type': 'image/jpeg', 'x-content-hash': contentHash },
        }),
      );

    await expect(MarketplaceGatewayService.uploadAttachment(SELLER, recipient, file)).resolves.toMatchObject({
      contentHash,
    });
    const downloaded = await MarketplaceGatewayService.fetchAttachment(SELLER, '00000000-0000-4000-8000-000000000990');
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(bytes);
  });

  it('types a downloaded attachment from its bytes, not the declared type', async () => {
    const bytes = new Uint8Array(
      await sharp({ create: { width: 2, height: 2, channels: 3, background: '#0a78c8' } })
        .png()
        .toBuffer(),
    );
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(bytes, {
        status: 200,
        headers: { 'content-type': 'text/html', 'x-content-hash': bytesToHex(blake3(bytes)) },
      }),
    );

    const downloaded = await MarketplaceGatewayService.fetchAttachment(SELLER, 'attachment-id');

    expect(downloaded.type).toBe('image/png');
  });

  it('refuses an attachment whose bytes are not a raster image', async () => {
    const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="document.title=1"/>');
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(bytes, {
        status: 200,
        headers: { 'content-type': 'image/png', 'x-content-hash': bytesToHex(blake3(bytes)) },
      }),
    );

    await expect(MarketplaceGatewayService.fetchAttachment(SELLER, 'attachment-id')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      message: 'Marketplace attachment is not a supported image.',
    });
  });

  it('refuses an attachment over the upload limit before reading it', async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled += 1;
          controller.enqueue(new Uint8Array(1024));
        },
      },
      { highWaterMark: 0 },
    );
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(body, { status: 200, headers: { 'content-length': String(IMAGE_MAX_UPLOAD_SIZE + 1) } }),
    );

    await expect(MarketplaceGatewayService.fetchAttachment(SELLER, 'attachment-id')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      message: 'Marketplace attachment is larger than the upload limit.',
    });
    expect(pulled).toBe(0);
  });
});

describe('MarketplaceGatewayService local pickup facade (Wave 7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.mode = 'sandbox';
  });

  it.each(['sandbox', 'unavailable'])('reports pickup unavailable in %s mode without a network read', async (mode) => {
    config.mode = mode;
    await expect(MarketplaceGatewayService.getPickupAvailability()).resolves.toBe(false);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('reads the capability from the durable service /health surface', async () => {
    config.mode = 'transaction-service';
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { status: 'ok', pickup_available: true }));

    await expect(MarketplaceGatewayService.getPickupAvailability()).resolves.toBe(true);

    const [url] = vi.mocked(fetch).mock.calls[0] as [string];
    expect(url).toBe('http://localhost:3100/health');
  });

  it.each([
    [
      'getOrderPickupDetails',
      () => MarketplaceGatewayService.getOrderPickupDetails(SELLER, '00000000-0000-4000-8000-000000000920'),
    ],
    ['getListingPickupDetails', () => MarketplaceGatewayService.getListingPickupDetails(SELLER, AGGREGATE_ID)],
  ] as const)('refuses %s outside durable modes before any bytes leave the client', async (operation, call) => {
    config.mode = 'sandbox';
    await expect(call()).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});

describe('MarketplaceGatewayService USDT payments capability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.mode = 'sandbox';
  });

  it.each(['sandbox', 'unavailable'])('reports USDT unavailable in %s mode without a network read', async (mode) => {
    config.mode = mode;
    await expect(MarketplaceGatewayService.getUsdtPaymentsCapability()).resolves.toBe(false);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it.each([
    ['usdt_payments.available is true', { status: 'ok', usdt_payments: { available: true } }, true],
    ['usdt_payments.available is false', { status: 'ok', usdt_payments: { available: false } }, false],
    ['the usdt_payments key is absent (flag off)', { status: 'ok', pickup_available: true }, false],
    ['usdt_payments is malformed', { status: 'ok', usdt_payments: 'on' }, false],
  ])('reads /health when %s', async (_label, body, expected) => {
    config.mode = 'transaction-service';
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, body));

    await expect(MarketplaceGatewayService.getUsdtPaymentsCapability()).resolves.toBe(expected);

    const [url] = vi.mocked(fetch).mock.calls[0] as [string];
    expect(url).toBe('http://localhost:3100/health');
  });
});

describe('MarketplaceGatewayService Paykit rail status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.mode = 'sandbox';
  });

  it.each(['sandbox', 'unavailable'])('is unknown in %s mode without a network read', async (mode) => {
    config.mode = mode;
    await expect(MarketplaceGatewayService.getPaykitRailStatus()).resolves.toBe('unknown');
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it.each([
    ['a fresh good probe', { status: 'ok', paykit_rail: { bitcoin_offer_available: true, age_seconds: 8 } }, 'ready'],
    [
      'a probe that says down',
      { status: 'ok', paykit_rail: { bitcoin_offer_available: false, age_seconds: 2 } },
      'unreachable',
    ],
    [
      'a last good probe long ago',
      { status: 'ok', paykit_rail: { bitcoin_offer_available: true, age_seconds: 900 } },
      'unreachable',
    ],
    [
      'a rail that never succeeded',
      { status: 'ok', paykit_rail: { bitcoin_offer_available: null, age_seconds: null } },
      'unknown',
    ],
    ['no paykit_rail key', { status: 'ok' }, 'unknown'],
  ])('reads /health: %s', async (_label, body, expected) => {
    config.mode = 'transaction-service';
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, body));

    await expect(MarketplaceGatewayService.getPaykitRailStatus()).resolves.toBe(expected);
    expect((vi.mocked(fetch).mock.calls[0] as [string])[0]).toBe('http://localhost:3100/health');
  });
});

describe('MarketplaceGatewayService sandbox order-list resilience (#581)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.mode = 'sandbox';
  });

  it('parses each sandbox order individually and returns inline parse errors for malformed rows', async () => {
    const valid = createOrderFixture('pending_payment', {
      id: '06cc87e9-60f8-4942-b1f2-1ca6c24b4535',
      payment: createPaymentFixture('manual_review', {
        orderId: '06cc87e9-60f8-4942-b1f2-1ca6c24b4535',
        reviewReason: 'upstream_inconsistent',
      }),
    });
    const malformed = {
      ...createOrderFixture('cancelled', { id: '470c02d8-9326-4d89-98f6-199df5a2ffcb' }),
      payment: {
        ...createPaymentFixture('manual_review', { orderId: '470c02d8-9326-4d89-98f6-199df5a2ffcb' }),
        reviewReason: 'unexpected_sandbox_reason',
      },
    };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { orders: [valid, malformed] }));

    const result = await MarketplaceGatewayService.getOrderList(SELLER);

    expect(result.orders).toHaveLength(1);
    expect(result.orders[0]?.id).toBe(valid.id);
    expect(result.orders[0]?.payment?.reviewReason).toBe('upstream_inconsistent');
    expect(result.parseErrors).toEqual([
      expect.objectContaining({
        kind: 'parse_error',
        index: 1,
        orderId: '470c02d8-9326-4d89-98f6-199df5a2ffcb',
        issues: [
          expect.objectContaining({
            path: 'orders[1].payment.reviewReason',
            message: expect.stringContaining('invalid value "unexpected_sandbox_reason"'),
          }),
        ],
      }),
    ]);
  });

  it('reports the invalid sandbox payment field without participant identifiers or wire values', async () => {
    const payment = createPaymentFixture('manual_review');
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { ...payment, reviewReason: 'private rejected text' }));
    using loggerError = vi.spyOn(Logger, 'error');
    await expect(MarketplaceGatewayService.getPayment(SELLER, payment.id)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    expect(loggerError.mock.calls.map(([, , context]) => context)).toStrictEqual([
      { statusCode: 200, parseIssues: ['payment.reviewReason: invalid_value'] },
    ]);
  });

  it('throws INVALID_RESPONSE when sandbox /v1/orders omits the top-level orders array', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { orders: 'not-an-array' }));

    await expect(MarketplaceGatewayService.getOrderList(SELLER)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});
