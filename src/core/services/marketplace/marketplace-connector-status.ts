import { z } from 'zod';
import { getCommerceAdapterMode, getMarketplaceUrl, isDurableCommerceMode } from '@/config/commerce';
import { toCamelCaseWire } from '@/libs/commerce/wire-casing';
import { ServerErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { httpResponseToError, safeFetch } from '@/libs/error/error.http';
import { ErrorService } from '@/libs/error/error.types';
import { parseResponseOrThrow } from '@/libs/http/response.utils';

const connectorStatusSchema = z.object({
  kind: z.literal('connector_status'),
  sellerPubky: z.string(),
  stores: z.array(
    z.object({
      provider: z.enum(['shopify', 'woocommerce']),
      domain: z.string().min(1),
      addressSharing: z.object({
        recipientKey: z.object({
          keyId: z.string().min(1),
          publicKey: z.string().min(1),
          algorithm: z.literal('hpke-x25519-hkdf-sha256-chacha20poly1305'),
          envelopeContext: z.literal('pubky-marketplace/connector-address/v1'),
          envelopeBytes: z.literal(2096),
        }),
      }),
    }),
  ),
});

export type SellerConnectorStore = z.infer<typeof connectorStatusSchema>['stores'][number];

/**
 * `GET /v0/sellers/{pubky}/connector-status`: the seller's connected stores and
 * the recipient key a buyer may seal an address to. Public and cacheable; it
 * answers an empty list when the seller has none or connectors are off.
 */
export class MarketplaceConnectorStatusService {
  private constructor() {}

  static async getStores(sellerPubky: string): Promise<SellerConnectorStore[]> {
    if (!isDurableCommerceMode(getCommerceAdapterMode())) return [];
    const operation = 'getSellerConnectorStatus';
    const url = `${getMarketplaceUrl()}/v0/sellers/${encodeURIComponent(sellerPubky)}/connector-status`;
    const response = await safeFetch(url, { method: 'GET' }, ErrorService.Marketplace, operation);
    if (!response.ok) throw httpResponseToError(response, ErrorService.Marketplace, operation, url);
    const raw = await parseResponseOrThrow<unknown>(response, ErrorService.Marketplace, operation, url);
    const parsed = connectorStatusSchema.safeParse(toCamelCaseWire(raw));
    if (!parsed.success) {
      throw Err.server(ServerErrorCode.INVALID_RESPONSE, 'Marketplace returned an invalid connector status.', {
        service: ErrorService.Marketplace,
        operation,
      });
    }
    return parsed.data.stores;
  }
}
