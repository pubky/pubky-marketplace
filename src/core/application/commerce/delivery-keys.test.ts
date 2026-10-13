/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deliveryKeyRecordUrl, openDeliveryAddress, sealDeliveryAddress } from '@/libs/commerce/delivery-envelope';
import {
  getDeliveryKeyPin,
  getDeliveryPrivateKey,
  resetDeliveryKeyStoreForTests,
} from '@/libs/crypto/delivery-key-store';
import { CommerceDeliveryKeysApplication } from './delivery-keys';

const homeserver = vi.hoisted(() => ({ files: new Map<string, unknown>(), failPut: false }));

vi.mock('@/services/homeserver/commerce/commerce', () => ({
  CommerceHomeserverService: {
    fetchJsonIfFound: async (url: string) =>
      homeserver.files.has(url) ? { found: true, json: homeserver.files.get(url) } : { found: false },
    putJson: async (url: string, body: unknown) => {
      if (homeserver.failPut) throw new Error('homeserver unavailable');
      homeserver.files.set(url, JSON.parse(JSON.stringify(body)));
    },
  },
}));

const SELLER = 's'.repeat(52);
const BUYER = 'b'.repeat(52);
const COMMAND_ID = '5b0c2f3e-8a4d-4c1e-9f6a-7d2b1e0a3c44';
const ADDRESS = {
  name: 'Ada Buyer',
  line1: '1 Example Street',
  line2: '',
  city: 'Lisbon',
  region: '',
  postalCode: '1000-001',
  countryCode: 'PT',
};

describe('CommerceDeliveryKeysApplication', () => {
  beforeEach(async () => {
    homeserver.files.clear();
    homeserver.failPut = false;
    await resetDeliveryKeyStoreForTests();
  });

  it('reports a seller with no key as missing', async () => {
    expect(await CommerceDeliveryKeysApplication.getSellerKeyStatus(SELLER)).toEqual({
      local: null,
      publication: 'missing',
      publishedKeyId: null,
    });
  });

  it('creates, publishes and reads back a key the buyer can seal to and the seller can open', async () => {
    const status = await CommerceDeliveryKeysApplication.commitCreateKey(SELLER);
    expect(status.publication).toBe('matches');
    expect(status.local?.current).toBe(true);
    expect(homeserver.files.has(deliveryKeyRecordUrl(SELLER))).toBe(true);

    const resolved = await CommerceDeliveryKeysApplication.resolveKeyForCheckout(BUYER, SELLER);
    if (resolved.kind !== 'ready') throw new Error(`expected a ready key, got ${resolved.kind}`);
    const binding = { checkoutCommandId: COMMAND_ID, buyerPubky: BUYER, sellerPubky: SELLER, keyId: resolved.keyId };
    const envelope = await sealDeliveryAddress({ address: ADDRESS, recipientPublicKey: resolved.publicKey, binding });

    const privateKey = await getDeliveryPrivateKey(SELLER, resolved.keyId);
    expect(privateKey).not.toBeNull();
    expect(await openDeliveryAddress({ envelope, privateKey: privateKey!, binding })).toEqual(ADDRESS);
  });

  it('pins on first sight and keeps accepting the same key', async () => {
    await CommerceDeliveryKeysApplication.commitCreateKey(SELLER);
    const first = await CommerceDeliveryKeysApplication.resolveKeyForCheckout(BUYER, SELLER);
    const second = await CommerceDeliveryKeysApplication.resolveKeyForCheckout(BUYER, SELLER);
    expect(first).toMatchObject({ kind: 'ready', newlyPinned: true });
    expect(second).toMatchObject({ kind: 'ready', newlyPinned: false });
  });

  it('blocks a changed key until the buyer accepts it', async () => {
    const created = await CommerceDeliveryKeysApplication.commitCreateKey(SELLER);
    await CommerceDeliveryKeysApplication.resolveKeyForCheckout(BUYER, SELLER);

    const rotated = await CommerceDeliveryKeysApplication.commitCreateKey(SELLER);
    expect(rotated.local?.keyId).not.toBe(created.local?.keyId);
    const blocked = await CommerceDeliveryKeysApplication.resolveKeyForCheckout(BUYER, SELLER);
    expect(blocked).toEqual({
      kind: 'changed',
      pinnedKeyId: created.local?.keyId,
      currentKeyId: rotated.local?.keyId,
    });
    expect((await getDeliveryKeyPin(BUYER, SELLER))?.keyId).toBe(created.local?.keyId);

    await CommerceDeliveryKeysApplication.commitAcceptKeyChange(BUYER, SELLER, rotated.local!.keyId);
    expect(await CommerceDeliveryKeysApplication.resolveKeyForCheckout(BUYER, SELLER)).toMatchObject({
      kind: 'ready',
      keyId: rotated.local?.keyId,
    });
  });

  it('keeps earlier private keys after rotation so earlier orders still open', async () => {
    const first = await CommerceDeliveryKeysApplication.commitCreateKey(SELLER);
    await CommerceDeliveryKeysApplication.commitCreateKey(SELLER);
    expect(await getDeliveryPrivateKey(SELLER, first.local!.keyId)).not.toBeNull();
  });

  it('keeps the new key local and retryable when publishing fails', async () => {
    homeserver.failPut = true;
    await expect(CommerceDeliveryKeysApplication.commitCreateKey(SELLER)).rejects.toThrow('homeserver unavailable');
    const pending = await CommerceDeliveryKeysApplication.getSellerKeyStatus(SELLER);
    expect(pending.local).not.toBeNull();
    expect(pending.publication).toBe('missing');

    homeserver.failPut = false;
    expect((await CommerceDeliveryKeysApplication.commitPublishCurrentKey(SELLER)).publication).toBe('matches');
  });

  it('refuses to publish when the device holds no key', async () => {
    await expect(CommerceDeliveryKeysApplication.commitPublishCurrentKey(SELLER)).rejects.toThrow(
      'no delivery key to publish',
    );
  });

  it('reports no_key and invalid records to a buyer without pinning them', async () => {
    expect(await CommerceDeliveryKeysApplication.resolveKeyForCheckout(BUYER, SELLER)).toEqual({ kind: 'no_key' });
    homeserver.files.set(deliveryKeyRecordUrl(SELLER), {
      v: 1,
      keyId: 'a'.repeat(32),
      publicKey: 'AAAA',
      createdAt: 'x',
    });
    expect(await CommerceDeliveryKeysApplication.resolveKeyForCheckout(BUYER, SELLER)).toEqual({ kind: 'invalid' });
    expect(await getDeliveryKeyPin(BUYER, SELLER)).toBeNull();
  });

  it('flags a published key this device does not hold', async () => {
    await CommerceDeliveryKeysApplication.commitCreateKey(SELLER);
    await resetDeliveryKeyStoreForTests();
    const status = await CommerceDeliveryKeysApplication.getSellerKeyStatus(SELLER);
    expect(status.local).toBeNull();
    expect(status.publication).toBe('different');
  });

  it('resolves every shipped seller once and keys them by pubky', async () => {
    const sellerB = 't'.repeat(52);
    const a = await CommerceDeliveryKeysApplication.commitCreateKey(SELLER);
    const b = await CommerceDeliveryKeysApplication.commitCreateKey(sellerB);

    const resolution = await CommerceDeliveryKeysApplication.resolveKeysForCheckout(BUYER, [SELLER, sellerB, SELLER]);

    if (!resolution.ok) throw new Error(`expected keys, got ${resolution.problem.kind}`);
    expect([...resolution.keys.keys()]).toEqual([SELLER, sellerB]);
    expect(resolution.keys.get(SELLER)?.keyId).toBe(a.local?.keyId);
    expect(resolution.keys.get(sellerB)?.keyId).toBe(b.local?.keyId);
  });

  it('names the first seller that has no usable key', async () => {
    const sellerB = 't'.repeat(52);
    await CommerceDeliveryKeysApplication.commitCreateKey(SELLER);

    const resolution = await CommerceDeliveryKeysApplication.resolveKeysForCheckout(BUYER, [SELLER, sellerB]);

    expect(resolution).toEqual({ ok: false, sellerPubky: sellerB, problem: { kind: 'no_key' } });
  });

  it('seals one envelope per seller that only that seller can open', async () => {
    const sellerB = 't'.repeat(52);
    await CommerceDeliveryKeysApplication.commitCreateKey(SELLER);
    await CommerceDeliveryKeysApplication.commitCreateKey(sellerB);
    const resolution = await CommerceDeliveryKeysApplication.resolveKeysForCheckout(BUYER, [SELLER, sellerB]);
    if (!resolution.ok) throw new Error('expected keys');

    const envelopes = await CommerceDeliveryKeysApplication.sealForCheckout({
      buyerPubky: BUYER,
      checkoutCommandId: COMMAND_ID,
      address: ADDRESS,
      keys: resolution.keys,
    });

    expect(envelopes.map((entry) => entry.sellerPubky)).toEqual([SELLER, sellerB]);
    const own = envelopes[0];
    const privateKey = (await getDeliveryPrivateKey(SELLER, own.keyId))!;
    const binding = { checkoutCommandId: COMMAND_ID, buyerPubky: BUYER, sellerPubky: SELLER, keyId: own.keyId };
    expect(await openDeliveryAddress({ envelope: own.envelope, privateKey, binding })).toEqual(ADDRESS);
    await expect(
      openDeliveryAddress({
        envelope: envelopes[1].envelope,
        privateKey,
        binding: { ...binding, sellerPubky: sellerB },
      }),
    ).rejects.toThrow();
  });

  describe('getOrderDeliveryAddress', () => {
    const SELLER_SESSION = { sellerPubky: SELLER, buyerPubky: BUYER };

    async function sealedOrder(keyId?: string) {
      await CommerceDeliveryKeysApplication.commitCreateKey(SELLER);
      const resolved = await CommerceDeliveryKeysApplication.resolveKeyForCheckout(BUYER, SELLER);
      if (resolved.kind !== 'ready') throw new Error('expected a ready key');
      const [sealed] = await CommerceDeliveryKeysApplication.sealForCheckout({
        buyerPubky: BUYER,
        checkoutCommandId: COMMAND_ID,
        address: ADDRESS,
        keys: new Map([[SELLER, { keyId: resolved.keyId, publicKey: resolved.publicKey }]]),
      });
      return { keyId: keyId ?? sealed.keyId, commandId: COMMAND_ID, envelope: sealed.envelope };
    }

    it('opens the address the buyer sealed to this seller on this device', async () => {
      const sealed = await sealedOrder();

      expect(await CommerceDeliveryKeysApplication.getOrderDeliveryAddress({ ...SELLER_SESSION, sealed })).toEqual({
        kind: 'address',
        address: ADDRESS,
      });
    });

    it('reports a missing key when this device never held the envelope key', async () => {
      const sealed = await sealedOrder();
      await resetDeliveryKeyStoreForTests();

      expect(await CommerceDeliveryKeysApplication.getOrderDeliveryAddress({ ...SELLER_SESSION, sealed })).toEqual({
        kind: 'undecryptable',
        reason: 'key_missing',
      });
    });

    it.each([
      ['another buyer', { buyerPubky: 'x'.repeat(52) }, {}],
      ['another checkout command', {}, { commandId: '6c1d9a52-0b8e-4f7a-8d3c-2e5f4a9b7c01' }],
    ])('rejects an envelope bound to %s', async (_name, session, sealedOverride) => {
      const sealed = await sealedOrder();

      expect(
        await CommerceDeliveryKeysApplication.getOrderDeliveryAddress({
          ...SELLER_SESSION,
          ...session,
          sealed: { ...sealed, ...sealedOverride },
        }),
      ).toEqual({ kind: 'undecryptable', reason: 'rejected' });
    });

    it('rejects a damaged envelope instead of returning an address', async () => {
      const sealed = await sealedOrder();
      const damaged = `${sealed.envelope.slice(0, 100)}${sealed.envelope[100] === 'A' ? 'B' : 'A'}${sealed.envelope.slice(101)}`;

      expect(
        await CommerceDeliveryKeysApplication.getOrderDeliveryAddress({
          ...SELLER_SESSION,
          sealed: { ...sealed, envelope: damaged },
        }),
      ).toEqual({ kind: 'undecryptable', reason: 'rejected' });
    });
  });
});
