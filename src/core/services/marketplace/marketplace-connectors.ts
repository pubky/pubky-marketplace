import { z } from 'zod';
import { getCommerceAdapterMode, getMarketplaceUrl, isDurableCommerceMode } from '@/config/commerce';
import {
  type ConnectorAlert,
  connectorAlertsSchema,
  type ConnectorCatalogPage,
  connectorCatalogSchema,
  type ConnectorConnection,
  type ConnectorConnectResult,
  connectorConnectSchema,
  type ConnectorCredentialsResult,
  connectorCredentialsResultSchema,
  connectorListSchema,
  type ConnectorMapping,
  connectorMappingsSchema,
  type ConnectorProvider,
  type ConnectorPush,
  connectorPushesSchema,
  connectorPushRetrySchema,
  type ConnectorPushState,
  connectorSelectionSchema,
} from '@/libs/commerce/connectors';
import { toCamelCaseWire, toSnakeCaseWire } from '@/libs/commerce/wire-casing';
import { AuthErrorCode, ClientErrorCode, ServerErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { httpResponseToError, safeFetch } from '@/libs/error/error.http';
import { ErrorService } from '@/libs/error/error.types';
import { HttpStatusCode } from '@/libs/http/http.types';
import { parseResponseOrThrow } from '@/libs/http/response.utils';
import { MarketplaceSessionService } from './marketplace-session';

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
};

/**
 * The seller's store connections on the durable Rust service
 * (`/v1/connectors`). Every call carries the seller's marketplace session
 * bearer, like the other seller routes.
 *
 * Credentials (a Shopify Client ID and secret, a WooCommerce key and secret)
 * pass through `putCredentials` once and are never kept: no request body is
 * ever put in an error context or a log line, and nothing here reads them back
 * because the service never returns them.
 */
export class MarketplaceConnectorsService {
  private constructor() {}

  static async list(actor: string, options: { signal?: AbortSignal } = {}): Promise<ConnectorConnection[]> {
    const raw = await this.request('listConnections', actor, '/v1/connectors', options);
    return this.parse('listConnections', connectorListSchema, raw).connections;
  }

  static async connect(
    actor: string,
    input: { provider: ConnectorProvider; domain: string },
  ): Promise<ConnectorConnectResult> {
    const raw = await this.request('connectStore', actor, '/v1/connectors', {
      method: 'POST',
      body: { provider: input.provider, domain: input.domain },
    });
    return this.parse('connectStore', connectorConnectSchema, raw);
  }

  /**
   * `PUT /v1/connectors/{id}/credentials`. A Shopify connection takes
   * `clientId` and `clientSecret`; a WooCommerce key pair takes `consumerKey`
   * and `consumerSecret` (sent snake_case on the wire).
   */
  static async putCredentials(
    actor: string,
    connectionId: string,
    credentials: Readonly<Record<string, string>>,
  ): Promise<ConnectorCredentialsResult> {
    const raw = await this.request('putConnectorCredentials', actor, `${this.path(connectionId)}/credentials`, {
      method: 'PUT',
      body: credentials,
    });
    return this.parse('putConnectorCredentials', connectorCredentialsResultSchema, raw ?? {});
  }

  static async disconnect(actor: string, connectionId: string): Promise<void> {
    await this.request('disconnectStore', actor, this.path(connectionId), { method: 'DELETE' });
  }

  static async catalog(
    actor: string,
    connectionId: string,
    options: { page?: string | null; selected?: boolean; signal?: AbortSignal } = {},
  ): Promise<ConnectorCatalogPage> {
    const query = new URLSearchParams();
    if (options.page) query.set('page', options.page);
    if (options.selected !== undefined) query.set('selected', String(options.selected));
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    const raw = await this.request('getConnectorCatalog', actor, `${this.path(connectionId)}/catalog${suffix}`, {
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return this.parse('getConnectorCatalog', connectorCatalogSchema, raw);
  }

  static async selection(actor: string, connectionId: string): Promise<string[]> {
    const raw = await this.request('getConnectorSelection', actor, `${this.path(connectionId)}/selection`);
    return this.parse('getConnectorSelection', connectorSelectionSchema, raw).productIds;
  }

  static async putSelection(actor: string, connectionId: string, productIds: readonly string[]): Promise<string[]> {
    const raw = await this.request('putConnectorSelection', actor, `${this.path(connectionId)}/selection`, {
      method: 'PUT',
      body: { productIds },
    });
    return this.parse('putConnectorSelection', connectorSelectionSchema, raw).productIds;
  }

  static async mappings(actor: string, connectionId: string): Promise<ConnectorMapping[]> {
    const raw = await this.request('getConnectorMappings', actor, `${this.path(connectionId)}/mappings`);
    return this.parse('getConnectorMappings', connectorMappingsSchema, raw).mappings;
  }

  /** Replaces the whole mapping set; callers merge with {@link mappings} first. */
  static async putMappings(
    actor: string,
    connectionId: string,
    mappings: readonly ConnectorMapping[],
  ): Promise<ConnectorMapping[]> {
    const raw = await this.request('putConnectorMappings', actor, `${this.path(connectionId)}/mappings`, {
      method: 'PUT',
      body: {
        mappings: mappings.map((mapping) => ({
          listingId: mapping.listingId,
          ...(mapping.variantId ? { variantId: mapping.variantId } : {}),
          providerProductId: mapping.providerProductId,
          ...(mapping.providerVariantId ? { providerVariantId: mapping.providerVariantId } : {}),
          ...(mapping.sku ? { sku: mapping.sku } : {}),
        })),
      },
    });
    return this.parse('putConnectorMappings', connectorMappingsSchema, raw).mappings;
  }

  static async pushes(
    actor: string,
    connectionId: string,
    options: { state?: ConnectorPushState; limit?: number; cursor?: string | null } = {},
  ): Promise<{ pushes: ConnectorPush[]; nextCursor: string | null }> {
    const query = new URLSearchParams();
    if (options.state) query.set('state', options.state);
    if (options.limit) query.set('limit', String(options.limit));
    if (options.cursor) query.set('cursor', options.cursor);
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    const raw = await this.request('getConnectorPushes', actor, `${this.path(connectionId)}/pushes${suffix}`);
    const parsed = this.parse('getConnectorPushes', connectorPushesSchema, raw);
    return { pushes: parsed.pushes, nextCursor: parsed.nextCursor ?? null };
  }

  static async retryPush(actor: string, connectionId: string, orderId: string): Promise<ConnectorPush> {
    const raw = await this.request(
      'retryConnectorPush',
      actor,
      `${this.path(connectionId)}/pushes/${encodeURIComponent(orderId)}/retry`,
      { method: 'POST' },
    );
    return this.parse('retryConnectorPush', connectorPushRetrySchema, raw).push;
  }

  static async alerts(actor: string, options: { unresolved?: boolean } = {}): Promise<ConnectorAlert[]> {
    const suffix = options.unresolved === undefined ? '' : `?unresolved=${options.unresolved}`;
    const raw = await this.request('getConnectorAlerts', actor, `/v1/connectors/alerts${suffix}`);
    return this.parse('getConnectorAlerts', connectorAlertsSchema, raw).alerts;
  }

  static async resolveAlert(actor: string, alertId: string): Promise<void> {
    await this.request('resolveConnectorAlert', actor, `/v1/connectors/alerts/${encodeURIComponent(alertId)}/resolve`, {
      method: 'POST',
    });
  }

  /** The service origin the per-connection Shopify URLs hang off when the response omits them. */
  static serviceBaseUrl(): string {
    return getMarketplaceUrl();
  }

  private static path(connectionId: string): string {
    return `/v1/connectors/${encodeURIComponent(connectionId)}`;
  }

  private static async request(
    operation: string,
    actor: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<unknown> {
    if (!isDurableCommerceMode(getCommerceAdapterMode())) {
      throw Err.client(ClientErrorCode.BAD_REQUEST, 'Store connections need the marketplace service.', {
        service: ErrorService.Marketplace,
        operation,
      });
    }
    const session = this.requireSession(operation, actor);
    const url = `${getMarketplaceUrl()}${path}`;
    const hasBody = options.body !== undefined;
    const response = await safeFetch(
      url,
      {
        method: options.method ?? 'GET',
        headers: {
          authorization: `Bearer ${session.token}`,
          ...(hasBody ? { 'content-type': 'application/json' } : {}),
        },
        cache: 'no-store',
        ...(hasBody ? { body: JSON.stringify(toSnakeCaseWire(options.body)) } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      },
      ErrorService.Marketplace,
      operation,
    );
    if (response.status === HttpStatusCode.UNAUTHORIZED) {
      MarketplaceSessionService.clearSessionIfBearer(session.token, 'rejected');
      throw Err.auth(
        AuthErrorCode.SESSION_EXPIRED,
        'The marketplace session expired. Approve the marketplace connection on your signer and try again.',
        { service: ErrorService.Marketplace, operation },
      );
    }
    if (!response.ok) {
      const refusal = await this.refusal(response);
      throw httpResponseToError(response, ErrorService.Marketplace, operation, path, {
        reason: refusal.code,
        ...(refusal.listingId ? { listingId: refusal.listingId } : {}),
      });
    }
    if (response.status === HttpStatusCode.NO_CONTENT) return null;
    const text = await response.clone().text();
    if (text.trim() === '' && options.method !== undefined && options.method !== 'GET') return null;
    const raw = await parseResponseOrThrow<unknown>(response, ErrorService.Marketplace, operation, path);
    return toCamelCaseWire(raw);
  }

  /**
   * The service's own error code (`credentials_rejected`, `already_connected`,
   * ...) and, for `listing_not_found`, the listing it names. Never the message
   * or the rest of the body.
   */
  private static async refusal(response: Response): Promise<{ code?: string; listingId?: string }> {
    try {
      const body = (await response.clone().json()) as { error?: { code?: unknown; listing_id?: unknown } };
      const code = body.error?.code;
      const listingId = body.error?.listing_id;
      return {
        ...(typeof code === 'string' && /^[a-z0-9_]{1,64}$/.test(code) ? { code } : {}),
        ...(typeof listingId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(listingId) ? { listingId } : {}),
      };
    } catch {
      return {};
    }
  }

  private static parse<Schema extends z.ZodTypeAny>(operation: string, schema: Schema, raw: unknown): z.infer<Schema> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw Err.server(ServerErrorCode.INVALID_RESPONSE, 'The marketplace service returned an unexpected response.', {
        service: ErrorService.Marketplace,
        operation,
      });
    }
    return parsed.data;
  }

  private static requireSession(operation: string, actor: string): { token: string; pubky: string } {
    const session = MarketplaceSessionService.getActiveSession();
    if (!session) {
      throw Err.auth(
        AuthErrorCode.SESSION_EXPIRED,
        'A marketplace session is required. Approve the marketplace connection on your signer and try again.',
        { service: ErrorService.Marketplace, operation },
      );
    }
    if (session.pubky !== actor) {
      MarketplaceSessionService.clearSessionIfBearer(session.token, 'rejected');
      throw Err.auth(AuthErrorCode.FORBIDDEN, 'The marketplace session belongs to a different pubky.', {
        service: ErrorService.Marketplace,
        operation,
      });
    }
    return session;
  }
}
