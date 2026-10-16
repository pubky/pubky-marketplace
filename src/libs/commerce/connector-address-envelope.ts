/**
 * The buyer's opt-in copy of the delivery address for the seller's connected
 * store (plan §8, "Buyer opt-in address sharing"). It is the same padded address
 * JSON and the same HPKE suite as the delivery envelope, sealed to the
 * connection's recipient key instead of the seller's delivery key, under its
 * own context so neither envelope can be replayed as the other:
 *
 * - `info` is `pubky-marketplace/connector-address/v1`;
 * - the AAD is `<context>|<checkout command id>|<buyer pubky>|<seller pubky>|<key id>`;
 * - the wire is the 32-byte encapsulated key and the ciphertext, 2,096 bytes,
 *   base64url without padding.
 *
 * The service opens it only to push the order to the store, then deletes it.
 */

import { z } from 'zod';
import { sealAddressToRecipient } from '@/libs/commerce/delivery-envelope';
import type { CommerceDeliveryAddressValue } from '@/libs/commerce/postal-address';
import { base64UrlToBytes } from '@/libs/commerce/priv-envelope';
import { commercePubkySchema } from '@/libs/commerce/transaction-contracts';

export const CONNECTOR_ADDRESS_CONTEXT = 'pubky-marketplace/connector-address/v1';

/** The wording version the buyer agreed to, stored with the order. Bump it when the checkbox copy changes. */
export const CONNECTOR_SHARE_CONSENT_VERSION = 1;

const RECIPIENT_PUBLIC_KEY_BYTES = 32;

export type ConnectorAddressBinding = {
  checkoutCommandId: string;
  buyerPubky: string;
  sellerPubky: string;
  keyId: string;
};

const bindingSchema = z.object({
  checkoutCommandId: z.uuid(),
  buyerPubky: commercePubkySchema,
  sellerPubky: commercePubkySchema,
  keyId: z.string().min(1).max(128),
});

export function buildConnectorAddressAad(binding: ConnectorAddressBinding): Uint8Array {
  const parsed = bindingSchema.parse(binding);
  return new TextEncoder().encode(
    `${CONNECTOR_ADDRESS_CONTEXT}|${parsed.checkoutCommandId.toLowerCase()}|${parsed.buyerPubky}|${parsed.sellerPubky}|${parsed.keyId}`,
  );
}

/** The recipient key as the service publishes it (base64url, 32 bytes). */
export function decodeConnectorRecipientKey(publicKey: string): Uint8Array {
  const bytes = base64UrlToBytes(publicKey);
  if (bytes.byteLength !== RECIPIENT_PUBLIC_KEY_BYTES) {
    throw new Error('A connector recipient key is 32 bytes.');
  }
  return bytes;
}

export async function sealConnectorAddress(input: {
  address: CommerceDeliveryAddressValue;
  recipientPublicKey: Uint8Array;
  binding: ConnectorAddressBinding;
}): Promise<string> {
  return await sealAddressToRecipient({
    address: input.address,
    recipientPublicKey: input.recipientPublicKey,
    context: CONNECTOR_ADDRESS_CONTEXT,
    aad: buildConnectorAddressAad(input.binding),
  });
}
