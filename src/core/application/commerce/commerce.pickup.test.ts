/** @vitest-environment node */
import { Chacha20Poly1305 } from '@hpke/chacha20poly1305';
import { CipherSuite, HkdfSha256 } from '@hpke/core';
import { DhkemX25519HkdfSha256 } from '@hpke/dhkem-x25519';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as commerceConfig from '@/config/commerce';
import { CONNECTOR_SHARE_CONSENT_VERSION } from '@/config/commerce-copy';
import {
  canonicalDeliveryAddressJson,
  type DeliveryKeyPair,
  generateDeliveryKeyPair,
  openDeliveryAddress,
  type SellerDeliveryEnvelope,
} from '@/libs/commerce/delivery-envelope';
import { base64UrlToBytes, bytesToBase64Url } from '@/libs/commerce/priv-envelope';
import { buildMarketplaceListingAggregateId } from '@/libs/commerce/transaction-commands';
import { LocalCommerceService } from '@/services/local/commerce/commerce';
import { MarketplaceGatewayService } from '@/services/marketplace/marketplace';
import { MarketplaceConnectorStatusService } from '@/services/marketplace/marketplace-connector-status';
import { COMMERCE_FIXTURE_SELLER } from '@/test/fixtures/commerce/commerce';
import { CommerceApplication } from './commerce';

const SELLER = COMMERCE_FIXTURE_SELLER;
const LISTING_ID = 'boots_01';
const LISTING_AGGREGATE_ID = buildMarketplaceListingAggregateId(SELLER, LISTING_ID);
const ORDER_ID = '018f47d2-6a27-7c23-a62f-000000000740';

const spotDetails = {
  kind: 'spot' as const,
  spot: 'Central Station, north entrance',
  instructions: 'Ask for the blue backpack.',
  availability: {
    windows: [{ day: 'sat' as const, start: '10:00', end: '14:00' }],
    zone: 'Europe/Berlin',
  },
};

const okResponse = { ok: true as const, result: { kind: 'pickup_details', version: 1 } };

describe('CommerceApplication local pickup (Wave 7)', () => {
  beforeEach(() => {
    vi.spyOn(commerceConfig, 'getCommerceAdapterMode').mockReturnValue('transaction-service');
    // The multi-operator guard fails open when the seller declares no
    // transaction-service authority; keep it out of these tests.
    vi.spyOn(LocalCommerceService, 'getShop').mockResolvedValue({ record: {} } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delegates the capability, reveal, and owner reads to the gateway', async () => {
    const availability = vi.spyOn(MarketplaceGatewayService, 'getPickupAvailability').mockResolvedValue(true);
    const reveal = vi.spyOn(MarketplaceGatewayService, 'getOrderPickupDetails').mockResolvedValue({} as never);
    const ownerRead = vi.spyOn(MarketplaceGatewayService, 'getListingPickupDetails').mockResolvedValue({} as never);

    await expect(CommerceApplication.fetchPickupAvailable()).resolves.toBe(true);
    await CommerceApplication.fetchPickupReveal(SELLER, ORDER_ID);
    await CommerceApplication.fetchSellerPickupDetails(SELLER, LISTING_AGGREGATE_ID);

    expect(reveal).toHaveBeenCalledWith(SELLER, ORDER_ID);
    expect(ownerRead).toHaveBeenCalledWith(SELLER, LISTING_AGGREGATE_ID);
    expect(availability).toHaveBeenCalledTimes(1);
  });

  it('builds pickup_details.set on the listing aggregate with the payload CAS and envelope revision 0', async () => {
    const execute = vi.spyOn(MarketplaceGatewayService, 'execute').mockResolvedValue(okResponse as never);

    const response = await CommerceApplication.commitSetPickupDetails(SELLER, {
      sellerPubky: SELLER,
      listingId: LISTING_ID,
      expectedVersion: 3,
      details: spotDetails,
    });

    expect(response.ok).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    const [actor, command] = execute.mock.calls[0];
    expect(actor).toBe(SELLER);
    expect(command).toMatchObject({
      aggregateId: LISTING_AGGREGATE_ID,
      expectedRevision: 0,
      kind: 'pickup_details.set',
      payload: { expectedVersion: 3, details: spotDetails },
    });
  });

  it('builds pickup_details.clear with the same CAS envelope', async () => {
    const execute = vi.spyOn(MarketplaceGatewayService, 'execute').mockResolvedValue(okResponse as never);

    await CommerceApplication.commitClearPickupDetails(SELLER, {
      sellerPubky: SELLER,
      listingId: LISTING_ID,
      expectedVersion: 4,
    });

    expect(execute.mock.calls[0][1]).toMatchObject({
      aggregateId: LISTING_AGGREGATE_ID,
      expectedRevision: 0,
      kind: 'pickup_details.clear',
      payload: { expectedVersion: 4 },
    });
  });

  it.each(['commitMarkReady', 'commitConfirmPickup'] as const)(
    '%s targets the order aggregate with the order revision',
    async (method) => {
      const execute = vi.spyOn(MarketplaceGatewayService, 'execute').mockResolvedValue(okResponse as never);

      await CommerceApplication[method](SELLER, { orderId: ORDER_ID, expectedRevision: 5 });

      expect(execute.mock.calls[0][1]).toMatchObject({
        aggregateId: `order:${ORDER_ID}`,
        expectedRevision: 5,
        kind: method === 'commitMarkReady' ? 'fulfillment.mark_ready' : 'fulfillment.confirm_pickup',
        payload: { orderId: ORDER_ID },
      });
    },
  );

  it.each(['commitSetPickupDetails', 'commitClearPickupDetails', 'commitMarkReady', 'commitConfirmPickup'] as const)(
    '%s is refused outside durable modes before any command is built (the client-side sandbox boundary)',
    async (method) => {
      vi.spyOn(commerceConfig, 'getCommerceAdapterMode').mockReturnValue('sandbox');
      const execute = vi.spyOn(MarketplaceGatewayService, 'execute');

      const input =
        method === 'commitSetPickupDetails'
          ? { sellerPubky: SELLER, listingId: LISTING_ID, expectedVersion: 0, details: spotDetails }
          : method === 'commitClearPickupDetails'
            ? { sellerPubky: SELLER, listingId: LISTING_ID, expectedVersion: 0 }
            : { orderId: ORDER_ID, expectedRevision: 1 };

      // @ts-expect-error the union of input shapes is exercised per branch above
      await expect(CommerceApplication[method](SELLER, input)).rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'Pickup is unavailable on this deployment.',
        context: { refusal: 'pickup_unavailable' },
      });
      expect(execute).not.toHaveBeenCalled();
    },
  );

  describe('typed command refusals (§A3/§A6/§A7)', () => {
    const refusalResponse = (message: string) => ({
      ok: false as const,
      error: { code: 'INVALID_STATE', message },
    });

    it('pickup_details.set on a listing that does not publish pickup throws the pickup_not_published refusal', async () => {
      vi.spyOn(MarketplaceGatewayService, 'execute').mockResolvedValue(
        refusalResponse('The listing does not publish pickup.') as never,
      );

      await expect(
        CommerceApplication.commitSetPickupDetails(SELLER, {
          sellerPubky: SELLER,
          listingId: LISTING_ID,
          expectedVersion: 0,
          details: spotDetails,
        }),
      ).rejects.toMatchObject({
        category: 'client',
        code: 'CONFLICT',
        message: 'The listing does not publish pickup.',
        context: { refusal: 'pickup_not_published' },
      });
    });

    it('the service-side deployment refusal throws the same pickup_unavailable refusal as the client-side boundary', async () => {
      vi.spyOn(MarketplaceGatewayService, 'execute').mockResolvedValue(
        refusalResponse('Pickup is unavailable on this deployment.') as never,
      );

      await expect(
        CommerceApplication.commitMarkReady(SELLER, { orderId: ORDER_ID, expectedRevision: 1 }),
      ).rejects.toMatchObject({
        category: 'client',
        code: 'CONFLICT',
        context: { refusal: 'pickup_unavailable' },
      });
    });

    it('a seller-actor confirm refused during an unresolved terms change throws the terms_change_unresolved refusal', async () => {
      vi.spyOn(MarketplaceGatewayService, 'execute').mockResolvedValue(
        refusalResponse(
          'The pickup terms changed after payment; the seller cannot confirm the handover until the buyer has seen the change.',
        ) as never,
      );

      await expect(
        CommerceApplication.commitConfirmPickup(SELLER, { orderId: ORDER_ID, expectedRevision: 2 }),
      ).rejects.toMatchObject({
        category: 'client',
        code: 'CONFLICT',
        context: { refusal: 'terms_change_unresolved' },
      });
    });

    it.each(['commitSetPickupDetails', 'commitClearPickupDetails', 'commitMarkReady', 'commitConfirmPickup'] as const)(
      '%s keeps unclassified envelope failures (revision conflicts) on the response, never thrown',
      async (method) => {
        const conflict = {
          ok: false as const,
          error: { code: 'REVISION_CONFLICT', message: 'The aggregate changed.', currentRevision: 5 },
        };
        vi.spyOn(MarketplaceGatewayService, 'execute').mockResolvedValue(conflict as never);

        const input =
          method === 'commitSetPickupDetails'
            ? { sellerPubky: SELLER, listingId: LISTING_ID, expectedVersion: 0, details: spotDetails }
            : method === 'commitClearPickupDetails'
              ? { sellerPubky: SELLER, listingId: LISTING_ID, expectedVersion: 0 }
              : { orderId: ORDER_ID, expectedRevision: 1 };

        // @ts-expect-error the union of input shapes is exercised per branch above
        await expect(CommerceApplication[method](SELLER, input)).resolves.toEqual(conflict);
      },
    );
  });

  describe('commitCreateMarketplaceCheckout (§A2 fulfillment plumbing)', () => {
    const sellerB = 'b'.repeat(52);
    const BUYER = 'c'.repeat(52);
    let sellerKey: DeliveryKeyPair;
    let sellerBKey: DeliveryKeyPair;
    beforeAll(async () => {
      sellerKey = await generateDeliveryKeyPair();
      sellerBKey = await generateDeliveryKeyPair();
    });
    const keysFor = (...pairs: [string, DeliveryKeyPair][]) =>
      new Map(pairs.map(([pubky, pair]) => [pubky, { keyId: pair.keyId, publicKey: pair.publicKey }]));
    const address = {
      name: 'Alice Buyer',
      line1: '1 Market Street',
      line2: '',
      city: 'New York',
      region: 'NY',
      postalCode: '10001',
      countryCode: 'US',
    };
    const lineA = {
      listingAggregateId: LISTING_AGGREGATE_ID,
      sellerPubky: SELLER,
      publishedFulfillmentMethods: ['shipping', 'pickup'],
      expectedRevision: 3,
      quantity: 1,
    } as const;
    const lineB = {
      listingAggregateId: `listing:${sellerB}_chair`,
      sellerPubky: sellerB,
      publishedFulfillmentMethods: ['shipping', 'pickup'],
      expectedRevision: 2,
      quantity: 2,
    } as const;

    it('assigns each seller group its choice and sends no address on a pickup-only checkout', async () => {
      const execute = vi.spyOn(MarketplaceGatewayService, 'execute').mockResolvedValue(okResponse as never);

      await CommerceApplication.commitCreateMarketplaceCheckout(SELLER, {
        lines: [lineA, lineB],
        fulfillmentChoiceBySeller: { [SELLER]: 'pickup', [sellerB]: 'pickup' },
      });

      const command = execute.mock.calls[0][1];
      expect(command.kind).toBe('checkout.create');
      const payload = command.payload as { lines: { fulfillment: string }[]; deliveryAddress?: unknown };
      expect(payload.lines.map((line) => line.fulfillment)).toEqual(['pickup', 'pickup']);
      expect(payload.deliveryAddress).toBeUndefined();
    });

    it('defaults unchosen groups to shipping and seals the address to the shipped seller only', async () => {
      const execute = vi.spyOn(MarketplaceGatewayService, 'execute').mockResolvedValue(okResponse as never);

      await CommerceApplication.commitCreateMarketplaceCheckout(BUYER, {
        lines: [lineA, lineB],
        fulfillmentChoiceBySeller: { [sellerB]: 'pickup' },
        deliveryAddress: address,
        deliveryKeys: keysFor([SELLER, sellerKey], [sellerB, sellerBKey]),
      });

      const command = execute.mock.calls[0][1];
      const payload = command.payload as {
        lines: { fulfillment: string }[];
        deliveryAddress?: unknown;
        deliveryAddressEnvelopes?: SellerDeliveryEnvelope[];
      };
      expect(payload.lines.map((line) => line.fulfillment)).toEqual(['shipping', 'pickup']);
      expect(payload).not.toHaveProperty('deliveryAddress');
      expect(JSON.stringify(payload)).not.toContain('1 Market Street');
      expect(payload.deliveryAddressEnvelopes).toHaveLength(1);
      const [sealed] = payload.deliveryAddressEnvelopes ?? [];
      expect(sealed).toMatchObject({ sellerPubky: SELLER, keyId: sellerKey.keyId });
      await expect(
        openDeliveryAddress({
          envelope: sealed.envelope,
          privateKey: sellerKey.privateKey,
          binding: {
            checkoutCommandId: command.commandId,
            buyerPubky: BUYER,
            sellerPubky: SELLER,
            keyId: sellerKey.keyId,
          },
        }),
      ).resolves.toEqual(address);
    });

    describe('opt-in address sharing with a connected store', () => {
      const STORE_KEY_ID = 'connector-key-1';

      async function storeKey() {
        const pair = await generateDeliveryKeyPair();
        return {
          pair,
          choice: {
            sellerPubky: SELLER,
            shopDomain: 'dezentralshop.ch',
            keyId: STORE_KEY_ID,
            publicKey: pair.publicKey,
          },
        };
      }

      it('seals a second copy of the address to the store key, bound to this checkout, and records the consent', async () => {
        const execute = vi.spyOn(MarketplaceGatewayService, 'execute').mockResolvedValue(okResponse as never);
        const { pair, choice } = await storeKey();

        await CommerceApplication.commitCreateMarketplaceCheckout(BUYER, {
          lines: [lineA],
          deliveryAddress: address,
          deliveryKeys: keysFor([SELLER, sellerKey]),
          connectorShares: [choice],
        });

        const command = execute.mock.calls[0][1];
        const payload = command.payload as {
          deliveryAddressEnvelopes: SellerDeliveryEnvelope[];
          connectorShares: {
            sellerPubky: string;
            shopDomain: string;
            consentVersion: string;
            keyId: string;
            envelope: string;
          }[];
        };
        expect(payload.deliveryAddressEnvelopes).toHaveLength(1);
        expect(payload.connectorShares).toHaveLength(1);
        const [share] = payload.connectorShares;
        expect(Object.keys(share).sort()).toEqual(['consentVersion', 'envelope', 'keyId', 'sellerPubky', 'shopDomain']);
        expect(share).toMatchObject({
          sellerPubky: SELLER,
          shopDomain: 'dezentralshop.ch',
          consentVersion: CONNECTOR_SHARE_CONSENT_VERSION,
          keyId: STORE_KEY_ID,
        });
        expect(share.consentVersion).toBe(CONNECTOR_SHARE_CONSENT_VERSION);
        expect(typeof share.consentVersion).toBe('string');
        expect(share.envelope).not.toBe(payload.deliveryAddressEnvelopes[0]?.envelope);

        expect(payload).not.toHaveProperty('deliveryAddress');
        const wire = JSON.stringify(command);
        for (const value of [address.name, address.line1, address.city, address.postalCode]) {
          expect(wire).not.toContain(value);
        }
        for (const field of ['line1', 'line2', 'postalCode', 'countryCode', 'region', 'city']) {
          expect(wire).not.toContain(`"${field}"`);
        }

        const enc = base64UrlToBytes(share.envelope);
        const opened = await new CipherSuite({
          kem: new DhkemX25519HkdfSha256(),
          kdf: new HkdfSha256(),
          aead: new Chacha20Poly1305(),
        }).open(
          {
            recipientKey: await new DhkemX25519HkdfSha256().deserializePrivateKey(pair.privateKey as BufferSource),
            enc: enc.slice(0, 32) as BufferSource,
            info: new TextEncoder().encode('pubky-marketplace/connector-address/v1'),
          },
          enc.slice(32) as BufferSource,
          new TextEncoder().encode(
            `pubky-marketplace/connector-address/v1|${command.commandId}|${BUYER}|${SELLER}|${STORE_KEY_ID}`,
          ) as BufferSource,
        );
        const padded = new Uint8Array(opened);
        expect(new TextDecoder().decode(padded.subarray(0, padded.lastIndexOf(0x80)))).toBe(
          canonicalDeliveryAddressJson(address),
        );
      });

      it('refuses a share when there is no sealed delivery envelope, and sends nothing', async () => {
        vi.spyOn(commerceConfig, 'getCommerceAdapterMode').mockReturnValue('sandbox');
        const execute = vi.spyOn(MarketplaceGatewayService, 'execute');
        const { choice } = await storeKey();

        await expect(
          CommerceApplication.commitCreateMarketplaceCheckout(BUYER, {
            lines: [lineA],
            deliveryAddress: address,
            connectorShares: [choice],
          }),
        ).rejects.toMatchObject({ category: 'validation', context: { sellerPubky: SELLER } });
        expect(execute).not.toHaveBeenCalled();
      });

      it('sends no share unless the buyer chose one', async () => {
        const execute = vi.spyOn(MarketplaceGatewayService, 'execute').mockResolvedValue(okResponse as never);

        await CommerceApplication.commitCreateMarketplaceCheckout(BUYER, {
          lines: [lineA],
          deliveryAddress: address,
          deliveryKeys: keysFor([SELLER, sellerKey]),
        });

        expect(execute.mock.calls[0][1].payload).not.toHaveProperty('connectorShares');
      });

      it('refuses a share for a seller that does not ship this checkout, and sends nothing', async () => {
        const execute = vi.spyOn(MarketplaceGatewayService, 'execute');
        const { choice } = await storeKey();

        await expect(
          CommerceApplication.commitCreateMarketplaceCheckout(BUYER, {
            lines: [lineA, lineB],
            fulfillmentChoiceBySeller: { [sellerB]: 'pickup' },
            deliveryAddress: address,
            deliveryKeys: keysFor([SELLER, sellerKey]),
            connectorShares: [{ ...choice, sellerPubky: sellerB }],
          }),
        ).rejects.toMatchObject({ category: 'validation', context: { sellerPubky: sellerB } });
        expect(execute).not.toHaveBeenCalled();
      });

      it('offers the connected stores of the sellers whose status can be read, and nothing for the rest', async () => {
        const { pair } = await storeKey();
        vi.spyOn(MarketplaceConnectorStatusService, 'getStores').mockImplementation(async (sellerPubky) => {
          if (sellerPubky === sellerB) throw new Error('offline');
          if (sellerPubky === 'z'.repeat(52)) return [];
          return [
            {
              provider: 'woocommerce',
              domain: 'dezentralshop.ch',
              addressSharing: {
                recipientKey: {
                  keyId: STORE_KEY_ID,
                  publicKey: bytesToBase64Url(pair.publicKey),
                  algorithm: 'hpke-x25519-hkdf-sha256-chacha20poly1305',
                  envelopeContext: 'pubky-marketplace/connector-address/v1',
                  envelopeBytes: 2096,
                },
              },
            },
          ];
        });

        const stores = await CommerceApplication.getConnectorStores([SELLER, sellerB, 'z'.repeat(52)]);

        expect([...stores.keys()]).toEqual([SELLER]);
        expect(stores.get(SELLER)).toMatchObject({ shopDomain: 'dezentralshop.ch', keyId: STORE_KEY_ID });
        expect(stores.get(SELLER)?.publicKey).toEqual(pair.publicKey);
      });
    });

    it('stops a durable shipping checkout whose seller has no resolved delivery key', async () => {
      const execute = vi.spyOn(MarketplaceGatewayService, 'execute');

      await expect(
        CommerceApplication.commitCreateMarketplaceCheckout(BUYER, {
          lines: [lineA],
          deliveryAddress: address,
          deliveryKeys: keysFor([sellerB, sellerBKey]),
        }),
      ).rejects.toMatchObject({ category: 'validation', context: { sellerPubky: SELLER } });
      expect(execute).not.toHaveBeenCalled();
    });

    it('keeps the plaintext address on the sandbox adapter', async () => {
      vi.spyOn(commerceConfig, 'getCommerceAdapterMode').mockReturnValue('sandbox');
      const execute = vi.spyOn(MarketplaceGatewayService, 'execute').mockResolvedValue(okResponse as never);

      await CommerceApplication.commitCreateMarketplaceCheckout(BUYER, {
        lines: [lineA],
        deliveryAddress: address,
      });

      const payload = execute.mock.calls[0]?.[1].payload as Record<string, unknown> | undefined;
      expect(payload?.deliveryAddress).toEqual(address);
      expect(payload).not.toHaveProperty('deliveryAddressEnvelopes');
    });

    it('refuses a choice a line does not publish with a typed validation error — never a silent fallback', async () => {
      const execute = vi.spyOn(MarketplaceGatewayService, 'execute');

      await expect(
        CommerceApplication.commitCreateMarketplaceCheckout(SELLER, {
          lines: [{ ...lineB, publishedFulfillmentMethods: ['shipping'] }],
          fulfillmentChoiceBySeller: { [sellerB]: 'pickup' },
        }),
      ).rejects.toMatchObject({
        category: 'validation',
        code: 'INVALID_INPUT',
        context: { sellerPubky: sellerB, fulfillment: 'pickup', listingAggregateId: lineB.listingAggregateId },
      });
      expect(execute).not.toHaveBeenCalled();
    });

    it('refuses a pickup-only checkout that presents an address (the §A2 smuggling rule)', async () => {
      const execute = vi.spyOn(MarketplaceGatewayService, 'execute');

      await expect(
        CommerceApplication.commitCreateMarketplaceCheckout(SELLER, {
          lines: [lineA],
          fulfillmentChoiceBySeller: { [SELLER]: 'pickup' },
          deliveryAddress: address,
        }),
      ).rejects.toMatchObject({ category: 'validation' });
      expect(execute).not.toHaveBeenCalled();
    });

    it('refuses a shipping checkout without an address', async () => {
      const execute = vi.spyOn(MarketplaceGatewayService, 'execute');

      await expect(
        CommerceApplication.commitCreateMarketplaceCheckout(SELLER, { lines: [lineA] }),
      ).rejects.toMatchObject({ category: 'validation' });
      expect(execute).not.toHaveBeenCalled();
    });

    // Digital delivery design §3 "Checkout", §6 B3, F1.
    const digitalLine = {
      listingAggregateId: `listing:${SELLER}_guide`,
      sellerPubky: SELLER,
      publishedFulfillmentMethods: ['shipping', 'digital'],
      fulfillmentChoice: 'digital',
      expectedRevision: 4,
      quantity: 1,
    } as const;

    it('sends a digital line as digital beside its seller’s shipped line, with the address and the delivery email', async () => {
      const execute = vi.spyOn(MarketplaceGatewayService, 'execute').mockResolvedValue(okResponse as never);

      await CommerceApplication.commitCreateMarketplaceCheckout(SELLER, {
        lines: [lineA, digitalLine],
        fulfillmentChoiceBySeller: { [SELLER]: 'shipping' },
        deliveryAddress: address,
        deliveryKeys: keysFor([SELLER, sellerKey]),
        deliveryEmail: 'buyer@example.com',
      });

      const payload = execute.mock.calls[0][1].payload as {
        lines: { fulfillment: string }[];
        deliveryAddress?: unknown;
        deliveryAddressEnvelopes?: unknown[];
        deliveryEmail?: unknown;
      };
      expect(payload.lines.map((line) => line.fulfillment)).toEqual(['shipping', 'digital']);
      expect(payload.deliveryAddress).toBeUndefined();
      expect(payload.deliveryAddressEnvelopes).toHaveLength(1);
      expect(payload.deliveryEmail).toBe('buyer@example.com');
    });

    it('sends an all-digital checkout with no address and no email unless one is given', async () => {
      const execute = vi.spyOn(MarketplaceGatewayService, 'execute').mockResolvedValue(okResponse as never);

      await CommerceApplication.commitCreateMarketplaceCheckout(SELLER, { lines: [digitalLine] });

      const payload = execute.mock.calls[0][1].payload as Record<string, unknown>;
      expect(payload).not.toHaveProperty('deliveryAddress');
      expect(payload).not.toHaveProperty('deliveryEmail');
    });

    it('refuses a malformed delivery email before sending, without echoing it', async () => {
      const execute = vi.spyOn(MarketplaceGatewayService, 'execute');

      const refusal = await CommerceApplication.commitCreateMarketplaceCheckout(SELLER, {
        lines: [digitalLine],
        deliveryEmail: 'not an email',
      }).catch((error: unknown) => error);

      expect(refusal).toMatchObject({ category: 'validation' });
      expect(JSON.stringify(refusal)).not.toContain('not an email');
      expect(execute).not.toHaveBeenCalled();
    });
  });
});

describe('CommerceApplication USDT payments gate', () => {
  beforeEach(() => {
    vi.spyOn(commerceConfig, 'getCommerceAdapterMode').mockReturnValue('transaction-service');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    { flag: false, capability: false, expected: false },
    { flag: false, capability: true, expected: false },
    { flag: true, capability: false, expected: false },
    { flag: true, capability: true, expected: true },
  ])('flag=$flag capability=$capability -> $expected', async ({ flag, capability, expected }) => {
    vi.spyOn(commerceConfig, 'getUsdtPaymentsEnabled').mockReturnValue(flag);
    const read = vi.spyOn(MarketplaceGatewayService, 'getUsdtPaymentsCapability').mockResolvedValue(capability);

    await expect(CommerceApplication.fetchUsdtPaymentsAvailable()).resolves.toBe(expected);
    expect(read).toHaveBeenCalledTimes(flag ? 1 : 0);
  });
});
