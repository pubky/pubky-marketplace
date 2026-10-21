/** @vitest-environment node */
import { Chacha20Poly1305 } from '@hpke/chacha20poly1305';
import { CipherSuite, HkdfSha256 } from '@hpke/core';
import { DhkemX25519HkdfSha256 } from '@hpke/dhkem-x25519';
import { describe, expect, it } from 'vitest';
import {
  buildConnectorAddressAad,
  CONNECTOR_ADDRESS_CONTEXT,
  decodeConnectorRecipientKey,
  sealConnectorAddress,
} from './connector-address-envelope';
import {
  canonicalDeliveryAddressJson,
  DELIVERY_ENVELOPE_BYTES,
  DELIVERY_PLAINTEXT_BUCKET_BYTES,
  generateDeliveryKeyPair,
  sealDeliveryAddress,
} from './delivery-envelope';
import { base64UrlToBytes, bytesToBase64Url } from './priv-envelope';

const suite = new CipherSuite({
  kem: new DhkemX25519HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Chacha20Poly1305(),
});

const ADDRESS = {
  name: 'Test Buyer',
  line1: 'Bahnhofstrasse 1',
  line2: '',
  city: 'Lugano',
  region: 'TI',
  postalCode: '6900',
  countryCode: 'CH',
};

const BINDING = {
  checkoutCommandId: '3f2b8a52-6c1e-4d0a-9a53-7d5d2f0b61aa',
  buyerPubky: 'b'.repeat(52),
  sellerPubky: 's'.repeat(52),
  keyId: 'connector-key-1',
};

async function recipient() {
  const pair = await generateDeliveryKeyPair();
  const privateKey = await suite.kem.deserializePrivateKey(pair.privateKey as BufferSource);
  return { pair, privateKey };
}

describe('connector address envelope', () => {
  it('pins the context and the AAD layout the service checks', () => {
    expect(CONNECTOR_ADDRESS_CONTEXT).toBe('pubky-marketplace/connector-address/v1');
    expect(
      new TextDecoder().decode(
        buildConnectorAddressAad({ ...BINDING, checkoutCommandId: BINDING.checkoutCommandId.toUpperCase() }),
      ),
    ).toBe(
      `pubky-marketplace/connector-address/v1|${BINDING.checkoutCommandId}|${BINDING.buyerPubky}|${BINDING.sellerPubky}|connector-key-1`,
    );
    expect(buildConnectorAddressAad(BINDING)).toEqual(
      new TextEncoder().encode(
        'pubky-marketplace/connector-address/v1|3f2b8a52-6c1e-4d0a-9a53-7d5d2f0b61aa|' +
          `${'b'.repeat(52)}|${'s'.repeat(52)}|connector-key-1`,
      ),
    );
  });

  it('seals to 2,096 bytes the recipient opens with the context and AAD, and only those', async () => {
    const { pair, privateKey } = await recipient();
    const envelope = await sealConnectorAddress({
      address: ADDRESS,
      recipientPublicKey: pair.publicKey,
      binding: BINDING,
    });

    const wire = base64UrlToBytes(envelope);
    expect(wire.byteLength).toBe(DELIVERY_ENVELOPE_BYTES);
    expect(bytesToBase64Url(wire)).toBe(envelope);

    const open = (info: string, aad: Uint8Array) =>
      suite.open(
        { recipientKey: privateKey, enc: wire.slice(0, 32) as BufferSource, info: new TextEncoder().encode(info) },
        wire.slice(32) as BufferSource,
        aad as BufferSource,
      );
    const padded = new Uint8Array(await open(CONNECTOR_ADDRESS_CONTEXT, buildConnectorAddressAad(BINDING)));
    expect(padded.byteLength).toBe(DELIVERY_PLAINTEXT_BUCKET_BYTES);
    const end = padded.lastIndexOf(0x80);
    expect(new TextDecoder().decode(padded.subarray(0, end))).toBe(canonicalDeliveryAddressJson(ADDRESS));
    expect(padded.subarray(end + 1).every((byte) => byte === 0)).toBe(true);

    await expect(open('pubky-marketplace/delivery-address/v1', buildConnectorAddressAad(BINDING))).rejects.toThrow();
    await expect(
      open(CONNECTOR_ADDRESS_CONTEXT, buildConnectorAddressAad({ ...BINDING, keyId: 'other' })),
    ).rejects.toThrow();
    await expect(
      open(CONNECTOR_ADDRESS_CONTEXT, buildConnectorAddressAad({ ...BINDING, sellerPubky: 'x'.repeat(52) })),
    ).rejects.toThrow();
  });

  it('is not the delivery envelope: the same address to the same key does not open under the other context', async () => {
    const { pair, privateKey } = await recipient();
    const delivery = await sealDeliveryAddress({
      address: ADDRESS,
      recipientPublicKey: pair.publicKey,
      binding: { ...BINDING, keyId: pair.keyId },
    });
    const wire = base64UrlToBytes(delivery);
    await expect(
      suite.open(
        {
          recipientKey: privateKey,
          enc: wire.slice(0, 32) as BufferSource,
          info: new TextEncoder().encode(CONNECTOR_ADDRESS_CONTEXT),
        },
        wire.slice(32) as BufferSource,
        buildConnectorAddressAad({ ...BINDING, keyId: pair.keyId }) as BufferSource,
      ),
    ).rejects.toThrow();
  });

  it('is randomized: sealing twice gives different bytes', async () => {
    const { pair } = await recipient();
    const input = { address: ADDRESS, recipientPublicKey: pair.publicKey, binding: BINDING };
    expect(await sealConnectorAddress(input)).not.toBe(await sealConnectorAddress(input));
  });

  it('refuses an address too long for the bucket, and a binding that is not ids', async () => {
    const { pair } = await recipient();
    await expect(
      sealConnectorAddress({
        address: { ...ADDRESS, line1: 'x'.repeat(2100) },
        recipientPublicKey: pair.publicKey,
        binding: BINDING,
      }),
    ).rejects.toThrow('too long');
    await expect(
      sealConnectorAddress({
        address: ADDRESS,
        recipientPublicKey: pair.publicKey,
        binding: { ...BINDING, checkoutCommandId: 'not-a-uuid' },
      }),
    ).rejects.toThrow();
  });

  it('reads the recipient key the service publishes', async () => {
    const { pair } = await recipient();
    expect(decodeConnectorRecipientKey(bytesToBase64Url(pair.publicKey))).toEqual(pair.publicKey);
    expect(() => decodeConnectorRecipientKey(bytesToBase64Url(new Uint8Array(31)))).toThrow('32 bytes');
  });
});
