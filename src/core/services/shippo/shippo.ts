import { z } from 'zod';
import { SHIPPO_API_BASE } from '@/config/shippo';
import type { CommerceDeliveryAddressValue } from '@/libs/commerce/postal-address';
import {
  type ShipFromAddress,
  type ShippingLabel,
  type ShippingParcel,
  SHIPPO_FAILURE_REASONS,
  type ShippoFailureReason,
  type ShippoRate,
} from '@/libs/commerce/shipping';
import { ClientErrorCode, ServerErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { safeFetch } from '@/libs/error/error.http';
import { ErrorService } from '@/libs/error/error.types';
import { HttpMethod } from '@/libs/http/http.types';

const messageSchema = z.object({ text: z.string().nullish() });

const rateSchema = z.object({
  object_id: z.string().min(1),
  provider: z.string().nullish(),
  servicelevel: z.object({ name: z.string().nullish() }).nullish(),
  amount: z.string().nullish(),
  currency: z.string().nullish(),
  estimated_days: z.number().int().nullish(),
  duration_terms: z.string().nullish(),
});

const shipmentSchema = z.object({
  rates: z.array(rateSchema).default([]),
  messages: z.array(messageSchema).default([]),
});

const transactionSchema = z.object({
  object_id: z.string().min(1),
  status: z.string(),
  tracking_number: z.string().nullish(),
  tracking_url_provider: z.string().nullish(),
  label_url: z.string().nullish(),
  messages: z.array(messageSchema).default([]),
});

type ShippoAddress = Record<string, string>;

function failure(operation: string, reason: ShippoFailureReason, statusCode?: number) {
  // Neither the token, the address nor Shippo's free-text messages (which can
  // quote the address back) enter the error: only the reason and status.
  const context = { reason, statusCode };
  if (reason === SHIPPO_FAILURE_REASONS.keyInvalid) {
    return Err.client(ClientErrorCode.UNPROCESSABLE, 'Shippo rejected the API token.', {
      service: ErrorService.Shippo,
      operation,
      context,
    });
  }
  if (reason === SHIPPO_FAILURE_REASONS.rejected) {
    return Err.client(ClientErrorCode.UNPROCESSABLE, 'Shippo refused the shipping request.', {
      service: ErrorService.Shippo,
      operation,
      context,
    });
  }
  return Err.server(ServerErrorCode.SERVICE_UNAVAILABLE, 'Shippo could not be reached or answered unexpectedly.', {
    service: ErrorService.Shippo,
    operation,
    context,
  });
}

function refusalReason(status: number): ShippoFailureReason {
  return status >= 500 || status === 429 ? SHIPPO_FAILURE_REASONS.unavailable : SHIPPO_FAILURE_REASONS.rejected;
}

function toShippoAddress(address: {
  name: string;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  countryCode: string;
  phone?: string;
  email?: string;
}): ShippoAddress {
  const shippo: ShippoAddress = {
    name: address.name,
    street1: address.line1,
    city: address.city,
    zip: address.postalCode,
    country: address.countryCode,
  };
  for (const [key, value] of [
    ['street2', address.line2],
    ['state', address.region],
    ['phone', address.phone ?? ''],
    ['email', address.email ?? ''],
  ] as const) {
    if (value) shippo[key] = value;
  }
  return shippo;
}

function toShippoParcel(parcel: ShippingParcel) {
  const cm = (mm: number) => (mm / 10).toFixed(1);
  return {
    length: cm(parcel.lengthMm),
    width: cm(parcel.widthMm),
    height: cm(parcel.heightMm),
    distance_unit: 'cm',
    weight: String(parcel.weightGrams),
    mass_unit: 'g',
  };
}

function toRate(rate: z.infer<typeof rateSchema>): ShippoRate {
  return {
    rateId: rate.object_id,
    provider: rate.provider ?? '',
    servicelevel: rate.servicelevel?.name ?? '',
    amount: rate.amount ?? '',
    currency: rate.currency ?? '',
    estimatedDays: rate.estimated_days ?? null,
    durationTerms: rate.duration_terms ?? null,
  };
}

/**
 * The seller's browser talking to Shippo with the seller's own token. A label
 * purchase is real money charged by Shippo to the seller's own account; the
 * marketplace never touches it. Callers pass the token and the decrypted
 * delivery address in, and nothing here stores, logs or forwards either.
 */
export class ShippoService {
  private constructor() {}

  private static async request(
    operation: string,
    apiKey: string,
    path: string,
    init: { method: HttpMethod; body?: unknown },
  ): Promise<Response> {
    const response = await safeFetch(
      `${SHIPPO_API_BASE}${path}`,
      {
        method: init.method,
        headers: {
          Authorization: `ShippoToken ${apiKey}`,
          ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      },
      ErrorService.Shippo,
      operation,
    );
    if (response.status === 401 || response.status === 403) {
      throw failure(operation, SHIPPO_FAILURE_REASONS.keyInvalid, response.status);
    }
    return response;
  }

  private static async readJson<T>(
    operation: string,
    response: Response,
    schema: z.ZodType<T>,
    allowErrorBody: boolean,
  ): Promise<T> {
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw failure(operation, SHIPPO_FAILURE_REASONS.unavailable, response.status);
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw failure(
        operation,
        response.ok || !allowErrorBody ? SHIPPO_FAILURE_REASONS.unavailable : refusalReason(response.status),
        response.status,
      );
    }
    return result.data;
  }

  /** Quotes a synchronous shipment and returns its purchasable rates. Nothing is bought. */
  static async quoteRates(input: {
    apiKey: string;
    shipFrom: ShipFromAddress;
    destination: CommerceDeliveryAddressValue;
    parcel: ShippingParcel;
  }): Promise<ShippoRate[]> {
    const operation = 'quoteRates';
    const response = await this.request(operation, input.apiKey, '/shipments/', {
      method: HttpMethod.POST,
      body: {
        address_from: toShippoAddress({
          name: input.shipFrom.name,
          line1: input.shipFrom.line1,
          line2: input.shipFrom.line2,
          city: input.shipFrom.city,
          region: input.shipFrom.region,
          postalCode: input.shipFrom.postalCode,
          countryCode: input.shipFrom.countryCode,
          phone: input.shipFrom.phone,
          email: input.shipFrom.email,
        }),
        address_to: toShippoAddress(input.destination),
        parcels: [toShippoParcel(input.parcel)],
        async: false,
      },
    });
    const shipment = await this.readJson(operation, response, shipmentSchema, true);
    if (!response.ok) throw failure(operation, refusalReason(response.status), response.status);
    if (shipment.rates.length === 0) throw failure(operation, SHIPPO_FAILURE_REASONS.rejected, response.status);
    return shipment.rates.map(toRate);
  }

  /**
   * Buys the label for a previously quoted rate. The rate is re-read first so
   * what is stored carries the carrier and price the seller actually bought.
   */
  static async purchaseLabel(input: { apiKey: string; rateId: string }): Promise<Omit<ShippingLabel, 'purchasedAt'>> {
    const operation = 'purchaseLabel';
    const rateResponse = await this.request(operation, input.apiKey, `/rates/${encodeURIComponent(input.rateId)}`, {
      method: HttpMethod.GET,
    });
    if (rateResponse.status === 404) throw failure(operation, SHIPPO_FAILURE_REASONS.rejected, 404);
    if (!rateResponse.ok) throw failure(operation, SHIPPO_FAILURE_REASONS.unavailable, rateResponse.status);
    const rate = toRate(await this.readJson(operation, rateResponse, rateSchema, false));

    const response = await this.request(operation, input.apiKey, '/transactions/', {
      method: HttpMethod.POST,
      body: { rate: input.rateId, label_file_type: 'PDF', async: false },
    });
    const transaction = await this.readJson(operation, response, transactionSchema, true);
    if (!response.ok) throw failure(operation, refusalReason(response.status), response.status);
    if (transaction.status !== 'SUCCESS') throw failure(operation, SHIPPO_FAILURE_REASONS.rejected, response.status);
    if (!transaction.tracking_number || !transaction.label_url) {
      throw failure(operation, SHIPPO_FAILURE_REASONS.unavailable, response.status);
    }
    return {
      transactionId: transaction.object_id,
      carrier: rate.provider,
      servicelevel: rate.servicelevel,
      amount: rate.amount,
      currency: rate.currency,
      trackingNumber: transaction.tracking_number,
      trackingUrl: transaction.tracking_url_provider ?? null,
      labelUrl: transaction.label_url,
    };
  }
}
