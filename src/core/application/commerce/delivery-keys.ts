import {
  buildDeliveryKeyRecord,
  type DeliveryKeyRecord,
  deliveryKeyRecordUrl,
  generateDeliveryKeyPair,
  parseDeliveryKeyRecord,
} from '@/libs/commerce/delivery-envelope';
import {
  getCurrentDeliveryKey,
  getDeliveryKeyPin,
  putDeliveryKeyPin,
  type StoredDeliveryKey,
  storeDeliveryKey,
} from '@/libs/crypto/delivery-key-store';
import { ClientErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { CommerceHomeserverService } from '@/services/homeserver/commerce/commerce';

/** What a seller's homeserver holds, compared with the key this device holds. */
export type DeliveryKeyPublication = 'matches' | 'missing' | 'different' | 'invalid';

export type SellerDeliveryKeyStatus = {
  local: StoredDeliveryKey | null;
  publication: DeliveryKeyPublication;
  publishedKeyId: string | null;
};

export type SellerDeliveryKeyLookup =
  | { kind: 'no_key' }
  | { kind: 'invalid' }
  | { kind: 'key'; record: DeliveryKeyRecord; publicKey: Uint8Array };

export type CheckoutDeliveryKey =
  | { kind: 'ready'; keyId: string; publicKey: Uint8Array; newlyPinned: boolean }
  | { kind: 'no_key' }
  | { kind: 'invalid' }
  | { kind: 'changed'; pinnedKeyId: string; currentKeyId: string };

/**
 * The seller delivery key lifecycle and the buyer's view of it. The private
 * half never leaves the device (`@/libs/crypto/delivery-key-store`); the
 * public record is a Shop-owned file under the grant the Shop already holds.
 */
export class CommerceDeliveryKeysApplication {
  private constructor() {}

  /** Reads one seller's published record straight from their homeserver. */
  static async fetchSellerDeliveryKey(sellerPubky: string): Promise<SellerDeliveryKeyLookup> {
    const stored = await CommerceHomeserverService.fetchJsonIfFound(deliveryKeyRecordUrl(sellerPubky));
    if (!stored.found) return { kind: 'no_key' };
    const parsed = parseDeliveryKeyRecord(stored.json);
    return parsed ? { kind: 'key', ...parsed } : { kind: 'invalid' };
  }

  /** This device's current key and whether the homeserver publishes it. */
  static async getSellerKeyStatus(ownerPubky: string): Promise<SellerDeliveryKeyStatus> {
    const local = await getCurrentDeliveryKey(ownerPubky);
    const lookup = await this.fetchSellerDeliveryKey(ownerPubky);
    if (lookup.kind === 'no_key') return { local, publication: 'missing', publishedKeyId: null };
    if (lookup.kind === 'invalid') return { local, publication: 'invalid', publishedKeyId: null };
    const publication = local && local.keyId === lookup.record.keyId ? 'matches' : 'different';
    return { local, publication, publishedKeyId: lookup.record.keyId };
  }

  /**
   * Creates a fresh keypair on this device and publishes it as the seller's
   * current key. Used for first setup and for rotation: earlier private keys
   * stay on the device so earlier orders still open. If publishing fails the
   * new key stays local and {@link commitPublishCurrentKey} retries it.
   */
  static async commitCreateKey(ownerPubky: string): Promise<SellerDeliveryKeyStatus> {
    const pair = await generateDeliveryKeyPair();
    try {
      await storeDeliveryKey(ownerPubky, pair, new Date());
    } finally {
      pair.privateKey.fill(0);
    }
    return await this.commitPublishCurrentKey(ownerPubky);
  }

  /** Publishes the current local key and reads the record back before reporting success. */
  static async commitPublishCurrentKey(ownerPubky: string): Promise<SellerDeliveryKeyStatus> {
    const local = await getCurrentDeliveryKey(ownerPubky);
    if (!local) {
      throw Err.client(ClientErrorCode.BAD_REQUEST, 'This device has no delivery key to publish.', {
        service: ErrorService.Local,
        operation: 'commitPublishCurrentKey',
      });
    }
    const record = buildDeliveryKeyRecord(local, new Date(local.createdAt));
    await CommerceHomeserverService.putJson(deliveryKeyRecordUrl(ownerPubky), { ...record });
    const status = await this.getSellerKeyStatus(ownerPubky);
    if (status.publication !== 'matches') {
      throw Err.client(ClientErrorCode.CONFLICT, 'The published delivery key did not read back as written.', {
        service: ErrorService.Homeserver,
        operation: 'commitPublishCurrentKey',
      });
    }
    return status;
  }

  /**
   * The key a buyer may seal to for `sellerPubky`: read from the seller's
   * homeserver, never through the marketplace service, and checked against
   * the pin for that seller. First sight pins the key. A different key from
   * the pin is `changed` and blocks sealing until the buyer accepts it with
   * {@link commitAcceptKeyChange}.
   */
  static async resolveKeyForCheckout(buyerPubky: string, sellerPubky: string): Promise<CheckoutDeliveryKey> {
    const lookup = await this.fetchSellerDeliveryKey(sellerPubky);
    if (lookup.kind !== 'key') return { kind: lookup.kind };
    const pin = await getDeliveryKeyPin(buyerPubky, sellerPubky);
    if (!pin) {
      await putDeliveryKeyPin(buyerPubky, sellerPubky, lookup.record.keyId, new Date());
      return { kind: 'ready', keyId: lookup.record.keyId, publicKey: lookup.publicKey, newlyPinned: true };
    }
    if (pin.keyId !== lookup.record.keyId) {
      return { kind: 'changed', pinnedKeyId: pin.keyId, currentKeyId: lookup.record.keyId };
    }
    return { kind: 'ready', keyId: lookup.record.keyId, publicKey: lookup.publicKey, newlyPinned: false };
  }

  /** The buyer confirmed the seller's new key; pin it. */
  static async commitAcceptKeyChange(buyerPubky: string, sellerPubky: string, keyId: string): Promise<void> {
    await putDeliveryKeyPin(buyerPubky, sellerPubky, keyId, new Date());
  }
}
