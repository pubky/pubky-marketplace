import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as commerceConfig from '@/config/commerce';
import { ClientErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { CommerceHomeserverService } from '@/services/homeserver/commerce/commerce';
import { LocalCommerceService } from '@/services/local/commerce/commerce';
import { MarketplaceGatewayService } from '@/services/marketplace/marketplace';
import { COMMERCE_FIXTURE_SELLER, createCommerceListingFixture } from '@/test/fixtures/commerce/commerce';
import { installWebLocks, removeWebLocks } from '@/test-utils/web-locks';
import { CommerceApplication } from './commerce';

const AGGREGATE_ID = `listing:${COMMERCE_FIXTURE_SELLER}_boots_01`;
const variant = (id: string, quantity: number, extra: Record<string, unknown> = {}) => ({
  id,
  options: { size: id },
  quantity,
  mediaIds: ['image_01'],
  enabled: true,
  ...extra,
});

const registeredResponse = (command: { commandId: string; aggregateId: string }) => ({
  ok: true as const,
  version: 1 as const,
  commandId: command.commandId,
  aggregateId: command.aggregateId,
  revision: 1,
  eventIds: [],
  result: { kind: 'listing' as const },
});

describe('listing.register per-variant stock', () => {
  beforeEach(() => {
    installWebLocks();
    vi.spyOn(commerceConfig, 'getCommerceAdapterMode').mockReturnValue('sandbox');
    vi.spyOn(CommerceHomeserverService, 'fetchJson').mockImplementation(async (url) => {
      const latest = vi
        .mocked(CommerceHomeserverService.putJson)
        .mock.calls.toReversed()
        .find(([writtenUrl]) => writtenUrl === url);
      if (latest) return latest[1];
      throw Err.client(ClientErrorCode.NOT_FOUND, 'Not found', {
        service: ErrorService.Homeserver,
        operation: 'fetchJson',
      });
    });
    vi.spyOn(CommerceHomeserverService, 'fetchJsonIfFound').mockImplementation(async (url) => {
      const latest = vi
        .mocked(CommerceHomeserverService.putJson)
        .mock.calls.toReversed()
        .find(([writtenUrl]) => writtenUrl === url);
      return latest ? { found: true, json: latest[1] } : { found: false };
    });
    vi.spyOn(LocalCommerceService, 'stageListingSync');
    vi.spyOn(CommerceHomeserverService, 'putJson').mockResolvedValue(undefined);
    vi.spyOn(LocalCommerceService, 'completeSyncJob').mockResolvedValue(undefined);
    vi.spyOn(MarketplaceGatewayService, 'getListing').mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    removeWebLocks();
  });

  async function registeredPayload(variants: ReturnType<typeof variant>[]) {
    const execute = vi
      .spyOn(MarketplaceGatewayService, 'execute')
      .mockImplementation(async (_actor, command) => registeredResponse(command));
    await CommerceApplication.commitUpsertListing(createCommerceListingFixture({ variants }));
    const command = execute.mock.calls.map(([, sent]) => sent).find((sent) => sent.kind === 'listing.register');
    return command?.payload as Record<string, unknown>;
  }

  it('sends the enabled variants in record order, with the sum of all variants as the quantity', async () => {
    const payload = await registeredPayload([
      variant('size_s', 1, { sku: 'SHIRT-S' }),
      variant('size_off', 5, { enabled: false }),
      variant('size_m', 4),
    ]);

    expect(payload.variants).toEqual([
      { id: 'size_s', quantity: 1, sku: 'SHIRT-S' },
      { id: 'size_m', quantity: 4 },
    ]);
    expect(payload.quantity).toBe(10);
  });

  it('keeps a sold-out size in the registered rows', async () => {
    const payload = await registeredPayload([variant('size_s', 0), variant('size_m', 4)]);

    expect(payload.variants).toEqual([
      { id: 'size_s', quantity: 0 },
      { id: 'size_m', quantity: 4 },
    ]);
  });

  it('sends no variants for a single variant record', async () => {
    const payload = await registeredPayload([variant('size_m', 4)]);

    expect(payload).not.toHaveProperty('variants');
    expect(payload.quantity).toBe(4);
  });

  it('sends no variants when only one variant is enabled', async () => {
    const payload = await registeredPayload([variant('size_s', 2, { enabled: false }), variant('size_m', 4)]);

    expect(payload).not.toHaveProperty('variants');
  });
});

describe('checkout lines and listing sync refusal copy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('carries variantId on every checkout line that has one', async () => {
    vi.spyOn(commerceConfig, 'getCommerceAdapterMode').mockReturnValue('transaction-service');
    vi.spyOn(LocalCommerceService, 'getShop').mockResolvedValue({ record: {} } as never);
    const execute = vi
      .spyOn(MarketplaceGatewayService, 'execute')
      .mockResolvedValue({ ok: true, result: { kind: 'checkout' } } as never);

    await CommerceApplication.commitCreateMarketplaceCheckout(COMMERCE_FIXTURE_SELLER, {
      lines: [
        {
          listingAggregateId: AGGREGATE_ID,
          sellerPubky: COMMERCE_FIXTURE_SELLER,
          publishedFulfillmentMethods: ['pickup'],
          expectedRevision: 3,
          quantity: 1,
          variantId: 'size_m',
          variantOptions: [{ name: 'size', value: 'size_m' }],
        },
      ],
      fulfillmentChoiceBySeller: { [COMMERCE_FIXTURE_SELLER]: 'pickup' },
    });

    const payload = execute.mock.calls[0][1].payload as { lines: Record<string, unknown>[] };
    expect(payload.lines[0]).toMatchObject({ listingAggregateId: AGGREGATE_ID, variantId: 'size_m' });
  });
});
