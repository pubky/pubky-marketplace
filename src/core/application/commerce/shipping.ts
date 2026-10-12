import { z } from 'zod';
import type { CommerceDeliveryAddressValue } from '@/libs/commerce/postal-address';
import {
  isPlausibleShippoApiKey,
  type SellerShippingConfig,
  type ShipFromAddress,
  shipFromAddressSchema,
  type ShippingLabel,
  shippingLabelSchema,
  type ShippingParcel,
  shippingParcelSchema,
  type ShippoRate,
} from '@/libs/commerce/shipping';
import { deleteDeviceRecord, getDeviceRecord, putDeviceRecord } from '@/libs/crypto/delivery-key-store';
import { ValidationErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { ShippoService } from '@/services/shippo/shippo';

const CONFIG_RECORD = 'shipping-config';
const labelRecord = (orderId: string) => `shipping-label:${orderId}`;

const storedConfigSchema = z.object({
  shippoApiKey: z.string().nullable(),
  shipFrom: shipFromAddressSchema.nullable(),
  updatedAt: z.string(),
});

type StoredConfig = z.infer<typeof storedConfigSchema>;

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

function invalid(operation: string, message: string): never {
  throw Err.validation(ValidationErrorCode.INVALID_INPUT, message, { service: ErrorService.Local, operation });
}

async function readJson<T>(owner: string, recordId: string, schema: z.ZodType<T>): Promise<T | null> {
  const bytes = await getDeviceRecord(owner, recordId);
  if (!bytes) return null;
  try {
    return schema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  } finally {
    bytes.fill(0);
  }
}

async function loadConfig(owner: string): Promise<StoredConfig | null> {
  return await readJson(owner, CONFIG_RECORD, storedConfigSchema);
}

/**
 * The seller's Shippo integration, kept on THIS device only: the token and the
 * ship-from address are wrapped under the device key and sent to nobody but
 * Shippo. The decrypted delivery address is passed in for one quote and never
 * stored here; only the purchased label (carrier, tracking, Shippo-hosted
 * label link) is kept, for the seller to reprint.
 */
export class CommerceShippingApplication {
  private constructor() {}

  static async getMyConfig(owner: string): Promise<SellerShippingConfig | null> {
    const config = await loadConfig(owner);
    if (!config) return null;
    return { shipFrom: config.shipFrom, shippoApiKeySet: config.shippoApiKey !== null, updatedAt: config.updatedAt };
  }

  /** `shippoApiKey` omitted keeps the stored token, an empty string removes it. */
  static async putMyConfig(
    owner: string,
    input: { shippoApiKey?: string; shipFrom: ShipFromAddress | null },
  ): Promise<SellerShippingConfig> {
    const operation = 'putMyConfig';
    const existing = await loadConfig(owner);
    let shippoApiKey = existing?.shippoApiKey ?? null;
    if (input.shippoApiKey !== undefined) {
      const trimmed = input.shippoApiKey.trim();
      if (trimmed === '') shippoApiKey = null;
      else if (!isPlausibleShippoApiKey(trimmed)) invalid(operation, 'A Shippo API token starts with "shippo_".');
      else shippoApiKey = trimmed;
    }
    const shipFrom = input.shipFrom === null ? null : shipFromAddressSchema.parse(input.shipFrom);
    const next: StoredConfig = { shippoApiKey, shipFrom, updatedAt: new Date().toISOString() };
    await putDeviceRecord(owner, CONFIG_RECORD, encode(next));
    return { shipFrom, shippoApiKeySet: shippoApiKey !== null, updatedAt: next.updatedAt };
  }

  private static async credentials(owner: string, operation: string, needShipFrom: boolean) {
    const config = await loadConfig(owner);
    if (!config) invalid(operation, 'Configure your Shippo API token and ship-from address first.');
    if (!config.shippoApiKey) invalid(operation, 'No Shippo API token is configured on this device.');
    if (needShipFrom && !config.shipFrom) invalid(operation, 'No ship-from address is configured on this device.');
    return { apiKey: config.shippoApiKey, shipFrom: config.shipFrom };
  }

  /** Real Shippo rates for the decrypted destination. Nothing is bought. */
  static async quoteRates(input: {
    owner: string;
    destination: CommerceDeliveryAddressValue;
    parcel: ShippingParcel;
  }): Promise<ShippoRate[]> {
    const operation = 'quoteRates';
    const parcel = shippingParcelSchema.safeParse(input.parcel);
    if (!parcel.success) invalid(operation, 'The parcel weight or dimensions are out of range.');
    const { apiKey, shipFrom } = await this.credentials(input.owner, operation, true);
    return await ShippoService.quoteRates({
      apiKey,
      shipFrom: shipFrom as ShipFromAddress,
      destination: input.destination,
      parcel: parcel.data,
    });
  }

  /** Buys the quoted rate on the seller's own Shippo account (real money) and keeps the label. One label per order. */
  static async purchaseLabel(input: { owner: string; orderId: string; rateId: string }): Promise<ShippingLabel> {
    const operation = 'purchaseLabel';
    if (!input.rateId || input.rateId.length > 100) invalid(operation, 'A rate from a previous quote is required.');
    const existing = await this.getLabel(input.owner, input.orderId);
    if (existing) return existing;
    const { apiKey } = await this.credentials(input.owner, operation, false);
    const bought = await ShippoService.purchaseLabel({ apiKey, rateId: input.rateId });
    const label: ShippingLabel = { ...bought, purchasedAt: new Date().toISOString() };
    await putDeviceRecord(input.owner, labelRecord(input.orderId), encode(label));
    return label;
  }

  static async getLabel(owner: string, orderId: string): Promise<ShippingLabel | null> {
    return await readJson(owner, labelRecord(orderId), shippingLabelSchema);
  }

  static async deleteLabel(owner: string, orderId: string): Promise<void> {
    await deleteDeviceRecord(owner, labelRecord(orderId));
  }
}
