/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceDeliveryKeysApplication } from '@/application/commerce/delivery-keys';
import { resetDeliveryKeyStoreForTests } from '@/libs/crypto/delivery-key-store';
import { useAuthStore } from '@/stores/auth/auth.store';
import { createOrderFixture, ORDER_FIXTURE_BUYER, ORDER_FIXTURE_SELLER } from '@/test/fixtures/commerce/orders';
import { CommerceController } from './commerce';

const homeserver = vi.hoisted(() => ({ files: new Map<string, unknown>() }));

vi.mock('@/services/homeserver/commerce/commerce', () => ({
  CommerceHomeserverService: {
    fetchJsonIfFound: async (url: string) =>
      homeserver.files.has(url) ? { found: true, json: homeserver.files.get(url) } : { found: false },
    putJson: async (url: string, body: unknown) => {
      homeserver.files.set(url, JSON.parse(JSON.stringify(body)));
    },
  },
}));

const ADDRESS = {
  name: 'Ada Buyer',
  line1: '1 Example Street',
  line2: '',
  city: 'Lisbon',
  region: '',
  postalCode: '1000-001',
  countryCode: 'PT',
};

/**
 * An auction winner's order has no checkout command, so the winner's client
 * binds the sealed address to the order id and the service hands the seller
 * that same id as `command_id`. The seller's packing slip opens it the same
 * way as any sealed order.
 */
describe('the seller opens the address an auction winner sealed to the order', () => {
  beforeEach(async () => {
    homeserver.files.clear();
    await resetDeliveryKeyStoreForTests();
  });

  it('decrypts it for the seller and for nobody else', async () => {
    const order = createOrderFixture('paid', { auctionAggregateId: 'listing:seller_boots' });
    await CommerceDeliveryKeysApplication.commitCreateKey(ORDER_FIXTURE_SELLER);
    const resolved = await CommerceDeliveryKeysApplication.resolveKeyForCheckout(
      ORDER_FIXTURE_BUYER,
      ORDER_FIXTURE_SELLER,
    );
    if (resolved.kind !== 'ready') throw new Error('expected a ready key');
    const [sealed] = await CommerceDeliveryKeysApplication.sealForCheckout({
      buyerPubky: ORDER_FIXTURE_BUYER,
      checkoutCommandId: order.id,
      address: ADDRESS,
      keys: new Map([[ORDER_FIXTURE_SELLER, { keyId: resolved.keyId, publicKey: resolved.publicKey }]]),
    });
    const sellerProjection = {
      ...order,
      deliveryAddress: {
        format: 'hpke_v1' as const,
        keyId: sealed.keyId,
        commandId: order.id,
        envelope: sealed.envelope,
      },
    };

    useAuthStore.setState({ currentUserPubky: ORDER_FIXTURE_SELLER });
    await expect(CommerceController.getOrderDeliveryAddress(sellerProjection)).resolves.toEqual({
      kind: 'address',
      address: ADDRESS,
    });

    useAuthStore.setState({ currentUserPubky: 'z'.repeat(52) });
    await expect(CommerceController.getOrderDeliveryAddress(sellerProjection)).resolves.toEqual({ kind: 'none' });
  });
});
