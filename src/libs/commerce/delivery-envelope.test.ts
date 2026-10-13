/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import {
  buildDeliveryAad,
  buildDeliveryKeyRecord,
  decodeDeliveryEnvelope,
  DELIVERY_ENVELOPE_BYTES,
  DELIVERY_ENVELOPE_CONTEXT,
  DeliveryEnvelopeError,
  deliveryKeyId,
  deliveryKeyRecordUrl,
  formatDeliveryKeyFingerprint,
  generateDeliveryKeyPair,
  openDeliveryAddress,
  parseDeliveryKeyRecord,
  sealDeliveryAddress,
} from './delivery-envelope';
import vector from './delivery-envelope.vectors.json';
import { base64UrlToBytes, bytesToBase64Url } from './priv-envelope';

const BUYER = 'b'.repeat(52);
const SELLER = 's'.repeat(52);
const COMMAND_ID = '5b0c2f3e-8a4d-4c1e-9f6a-7d2b1e0a3c44';
const ADDRESS = {
  name: 'Ada Buyer',
  line1: '1 Example Street',
  line2: 'Flat 2',
  city: 'Lisbon',
  region: '',
  postalCode: '1000-001',
  countryCode: 'PT',
};

async function sealed() {
  const pair = await generateDeliveryKeyPair();
  const binding = { checkoutCommandId: COMMAND_ID, buyerPubky: BUYER, sellerPubky: SELLER, keyId: pair.keyId };
  const envelope = await sealDeliveryAddress({ address: ADDRESS, recipientPublicKey: pair.publicKey, binding });
  return { pair, binding, envelope };
}

async function expectCode(promise: Promise<unknown>, code: DeliveryEnvelopeError['code']) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(DeliveryEnvelopeError);
  expect((error as DeliveryEnvelopeError).code).toBe(code);
}

describe('delivery envelope', () => {
  it('round-trips an address through seal and open', async () => {
    const { pair, binding, envelope } = await sealed();
    const opened = await openDeliveryAddress({ envelope, privateKey: pair.privateKey, binding });
    expect(opened).toEqual(ADDRESS);
  });

  it('produces a fixed-size base64url envelope that hides the address length', async () => {
    const { envelope } = await sealed();
    expect(decodeDeliveryEnvelope(envelope).enc.byteLength).toBe(32);
    expect(base64UrlToBytes(envelope).byteLength).toBe(DELIVERY_ENVELOPE_BYTES);
    expect(envelope).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('uses a fresh ephemeral key per seal', async () => {
    const pair = await generateDeliveryKeyPair();
    const binding = { checkoutCommandId: COMMAND_ID, buyerPubky: BUYER, sellerPubky: SELLER, keyId: pair.keyId };
    const a = await sealDeliveryAddress({ address: ADDRESS, recipientPublicKey: pair.publicKey, binding });
    const b = await sealDeliveryAddress({ address: ADDRESS, recipientPublicKey: pair.publicKey, binding });
    expect(a).not.toBe(b);
  });

  it('rejects an address that cannot fit one bucket', async () => {
    const pair = await generateDeliveryKeyPair();
    const binding = { checkoutCommandId: COMMAND_ID, buyerPubky: BUYER, sellerPubky: SELLER, keyId: pair.keyId };
    await expectCode(
      sealDeliveryAddress({
        address: { ...ADDRESS, line1: 'x'.repeat(2100) },
        recipientPublicKey: pair.publicKey,
        binding,
      }),
      'address_too_long',
    );
  });

  it('refuses to open with a different key', async () => {
    const { binding, envelope } = await sealed();
    const other = await generateDeliveryKeyPair();
    await expectCode(openDeliveryAddress({ envelope, privateKey: other.privateKey, binding }), 'open_failed');
  });

  it.each([
    ['checkout command', { checkoutCommandId: '6c1d3f4a-9b5e-4d2f-8a7b-8e3c2f1b4d55' }],
    ['buyer', { buyerPubky: 'c'.repeat(52) }],
    ['seller', { sellerPubky: 't'.repeat(52) }],
  ])('refuses to open when the %s binding differs', async (_label, override) => {
    const { pair, binding, envelope } = await sealed();
    await expectCode(
      openDeliveryAddress({ envelope, privateKey: pair.privateKey, binding: { ...binding, ...override } }),
      'open_failed',
    );
  });

  it('refuses to open a tampered envelope', async () => {
    const { pair, binding, envelope } = await sealed();
    const bytes = base64UrlToBytes(envelope);
    bytes[100] ^= 0x01;
    await expectCode(
      openDeliveryAddress({ envelope: bytesToBase64Url(bytes), privateKey: pair.privateKey, binding }),
      'open_failed',
    );
  });

  it.each([
    ['too short', (envelope: string) => envelope.slice(0, -4)],
    ['too long', (envelope: string) => `${envelope}AAAA`],
    ['not base64url', (envelope: string) => `${envelope.slice(0, -1)}*`],
    ['empty', () => ''],
  ])('rejects a malformed envelope (%s)', async (_label, mutate) => {
    const { pair, binding, envelope } = await sealed();
    await expectCode(
      openDeliveryAddress({ envelope: mutate(envelope), privateKey: pair.privateKey, binding }),
      'malformed_envelope',
    );
  });

  it('refuses to seal when the key id does not match the public key', async () => {
    const { pair, binding } = await sealed();
    const other = await generateDeliveryKeyPair();
    await expectCode(
      sealDeliveryAddress({
        address: ADDRESS,
        recipientPublicKey: other.publicKey,
        binding: { ...binding, keyId: pair.keyId },
      }),
      'key_id_mismatch',
    );
  });

  it('binds the AAD to the documented context string', () => {
    const aad = new TextDecoder().decode(
      buildDeliveryAad({
        checkoutCommandId: COMMAND_ID,
        buyerPubky: BUYER,
        sellerPubky: SELLER,
        keyId: 'a'.repeat(32),
      }),
    );
    expect(aad).toBe(`${DELIVERY_ENVELOPE_CONTEXT}|${COMMAND_ID}|${BUYER}|${SELLER}|${'a'.repeat(32)}`);
  });

  it('opens the shared known-answer vector that the service also verifies', async () => {
    const opened = await openDeliveryAddress({
      envelope: vector.envelope,
      privateKey: base64UrlToBytes(vector.privateKey),
      binding: vector.binding,
    });
    expect(opened).toEqual(vector.address);
    expect(deliveryKeyId(base64UrlToBytes(vector.publicKey))).toBe(vector.binding.keyId);
    expect(vector.context).toBe(DELIVERY_ENVELOPE_CONTEXT);
  });
});

describe('delivery key record', () => {
  it('derives a stable key id and a spaced fingerprint', async () => {
    const pair = await generateDeliveryKeyPair();
    expect(pair.keyId).toMatch(/^[0-9a-f]{32}$/);
    expect(deliveryKeyId(pair.publicKey)).toBe(pair.keyId);
    expect(formatDeliveryKeyFingerprint(pair.keyId)).toMatch(/^([0-9a-f]{4} ){7}[0-9a-f]{4}$/);
  });

  it('round-trips a published record through the strict parser', async () => {
    const pair = await generateDeliveryKeyPair();
    const record = buildDeliveryKeyRecord(pair, new Date('2026-10-12T10:00:00.000Z'));
    const parsed = parseDeliveryKeyRecord(JSON.parse(JSON.stringify(record)));
    expect(parsed?.record).toEqual(record);
    expect(parsed?.publicKey).toEqual(pair.publicKey);
  });

  it('rejects records whose key id does not match their key', async () => {
    const pair = await generateDeliveryKeyPair();
    const record = buildDeliveryKeyRecord(pair, new Date('2026-10-12T10:00:00.000Z'));
    expect(parseDeliveryKeyRecord({ ...record, keyId: 'f'.repeat(32) })).toBeNull();
  });

  it.each([
    ['unknown field', { extra: true }],
    ['wrong version', { v: 2 }],
    ['bad key length', { publicKey: 'AAAA' }],
    ['bad date', { createdAt: 'yesterday' }],
  ])('rejects a record with %s', async (_label, override) => {
    const pair = await generateDeliveryKeyPair();
    const record = buildDeliveryKeyRecord(pair, new Date('2026-10-12T10:00:00.000Z'));
    expect(parseDeliveryKeyRecord({ ...record, ...override })).toBeNull();
  });

  it('rejects non-objects', () => {
    expect(parseDeliveryKeyRecord(null)).toBeNull();
    expect(parseDeliveryKeyRecord('x')).toBeNull();
  });

  it('builds the record URL under the existing pub grant', () => {
    expect(deliveryKeyRecordUrl(SELLER)).toBe(`pubky://${SELLER}/pub/pubky.app/marketplace/v1/delivery-keys/current`);
  });
});
