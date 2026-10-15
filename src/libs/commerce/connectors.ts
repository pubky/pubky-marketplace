import { z } from 'zod';
import { isAppError } from '@/libs/error/error';

/**
 * Store connections (WooCommerce, Shopify). Shapes follow the service's
 * connector contract (`/v1/connectors`), read after `toCamelCaseWire`.
 *
 * Fields the contract does not name yet are `.optional()` here and listed in
 * the lane report: `urls` and `credentialsSet` on a Shopify draft connection
 * (per-connection app, C7), `authorizeUrl` on the credentials response, and
 * `shopName` / `locationCount` on a connection. A service that omits them still
 * parses, and the UI falls back to the fixed C7 paths.
 */

export const CONNECTOR_PROVIDERS = ['shopify', 'woocommerce'] as const;
export type ConnectorProvider = (typeof CONNECTOR_PROVIDERS)[number];

export const CONNECTOR_PROVIDER_LABELS: Readonly<Record<ConnectorProvider, string>> = {
  shopify: 'Shopify',
  woocommerce: 'WooCommerce',
};

/** The exact scopes the Shopify app must be released with (plan §10). */
export const SHOPIFY_REQUIRED_SCOPES = [
  'read_products',
  'read_inventory',
  'read_locations',
  'read_fulfillments',
  'write_orders',
] as const;

export const SHOPIFY_API_VERSION = '2026-10';
export const WOOCOMMERCE_REQUIRED_SCOPE = 'read_write';

export const CONNECTOR_MAX_CONNECTIONS = 5;

const isoTimestamp = z.string().min(1);

const connectionPushCountsSchema = z.object({
  pending: z.number().int().nonnegative().default(0),
  sending: z.number().int().nonnegative().default(0),
  created: z.number().int().nonnegative().default(0),
  quarantined: z.number().int().nonnegative().default(0),
});

export type ConnectorPushCounts = z.infer<typeof connectionPushCountsSchema>;

export const connectorUrlsSchema = z.object({
  appUrl: z.string().min(1),
  allowedRedirectionUrl: z.string().min(1),
  webhookUrl: z.string().min(1).nullable().optional(),
});

export type ConnectorUrls = z.infer<typeof connectorUrlsSchema>;

export const connectorConnectionSchema = z.object({
  id: z.string().min(1),
  provider: z.enum(CONNECTOR_PROVIDERS),
  domain: z.string().min(1),
  appKey: z.string().nullable().optional(),
  status: z.enum(['draft', 'pending', 'connected', 'error']),
  scopes: z.array(z.string()).default([]),
  expiresAt: isoTimestamp.nullable().optional(),
  connectedAt: isoTimestamp.nullable().optional(),
  createdAt: isoTimestamp.optional(),
  updatedAt: isoTimestamp.optional(),
  lastError: z.object({ message: z.string(), at: isoTimestamp.optional() }).nullable().optional(),
  mappingCount: z.number().int().nonnegative().default(0),
  pushes: connectionPushCountsSchema.default({ pending: 0, sending: 0, created: 0, quarantined: 0 }),
  credentialsSet: z.boolean().optional(),
  shopName: z.string().nullable().optional(),
  locationCount: z.number().int().nonnegative().nullable().optional(),
  urls: connectorUrlsSchema.nullable().optional(),
});

export type ConnectorConnection = z.infer<typeof connectorConnectionSchema>;

export const connectorListSchema = z.object({
  kind: z.literal('connector_list'),
  connections: z.array(connectorConnectionSchema),
});

export const connectorConnectSchema = z.object({
  kind: z.literal('connector_connect'),
  connection: connectorConnectionSchema,
  authorizeUrl: z.string().nullable().optional(),
  urls: connectorUrlsSchema.nullable().optional(),
});

export type ConnectorConnectResult = z.infer<typeof connectorConnectSchema>;

export const connectorCredentialsResultSchema = z
  .object({
    connection: connectorConnectionSchema.optional(),
    authorizeUrl: z.string().nullable().optional(),
  })
  .default({});

export type ConnectorCredentialsResult = z.infer<typeof connectorCredentialsResultSchema>;

const catalogVariantSchema = z.object({
  providerVariantId: z.string().min(1),
  sku: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  optionValues: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
  price: z.object({
    amountMinor: z.number().int().nonnegative(),
    currency: z.string().min(1),
    exponent: z.number().int().min(0).max(8),
  }),
  stock: z.number().int().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
});

export type ConnectorCatalogVariant = z.infer<typeof catalogVariantSchema>;

export const connectorCatalogProductSchema = z.object({
  providerProductId: z.string().min(1),
  title: z.string(),
  description: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  options: z.array(z.object({ name: z.string(), values: z.array(z.string()) })).default([]),
  imageUrls: z.array(z.string()).default([]),
  variants: z.array(catalogVariantSchema).default([]),
  selected: z.boolean().default(false),
});

export type ConnectorCatalogProduct = z.infer<typeof connectorCatalogProductSchema>;

export const connectorCatalogSchema = z.object({
  kind: z.literal('connector_catalog'),
  connectionId: z.string().min(1),
  products: z.array(connectorCatalogProductSchema),
  nextPage: z.string().nullable().optional(),
});

export type ConnectorCatalogPage = z.infer<typeof connectorCatalogSchema>;

export const connectorSelectionSchema = z.object({
  kind: z.literal('connector_selection'),
  connectionId: z.string().min(1),
  productIds: z.array(z.string()),
});

export const connectorMappingSchema = z.object({
  listingId: z.string().min(1),
  variantId: z.string().nullable().optional(),
  providerProductId: z.string().min(1),
  providerVariantId: z.string().nullable().optional(),
  sku: z.string().nullable().optional(),
});

export type ConnectorMapping = z.infer<typeof connectorMappingSchema>;

export const connectorMappingsSchema = z.object({
  kind: z.literal('connector_mappings'),
  connectionId: z.string().min(1),
  mappings: z.array(connectorMappingSchema),
});

const PUSH_STATES = ['pending', 'sending', 'created', 'quarantined'] as const;
export type ConnectorPushState = (typeof PUSH_STATES)[number];

export const connectorPushSchema = z.object({
  id: z.string().min(1),
  pubkyOrderId: z.string().min(1),
  provider: z.enum(CONNECTOR_PROVIDERS),
  state: z.enum(PUSH_STATES),
  externalId: z.string().nullable().optional(),
  quarantineReason: z.string().nullable().optional(),
  quarantineSeverity: z.enum(['info', 'action_required']).nullable().optional(),
  attempts: z.number().int().nonnegative().default(0),
  nextAttemptAt: isoTimestamp.nullable().optional(),
  lastError: z.string().nullable().optional(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
  actions: z
    .array(
      z.object({
        kind: z.enum(['cancel', 'refund']),
        key: z.string(),
        state: z.enum(['pending', 'sending', 'done', 'quarantined']),
        attempts: z.number().int().nonnegative().default(0),
        quarantineReason: z.string().nullable().optional(),
        lastError: z.string().nullable().optional(),
        updatedAt: isoTimestamp.optional(),
      }),
    )
    .default([]),
});

export type ConnectorPush = z.infer<typeof connectorPushSchema>;

export const connectorPushesSchema = z.object({
  kind: z.literal('connector_pushes'),
  connectionId: z.string().min(1),
  pushes: z.array(connectorPushSchema),
  nextCursor: z.string().nullable().optional(),
});

export const connectorPushRetrySchema = z.object({
  kind: z.literal('connector_push'),
  push: connectorPushSchema,
});

export const CONNECTOR_ALERT_KINDS = [
  'push_quarantined',
  'action_quarantined',
  'merchant_cancelled',
  'merchant_refunded',
  'store_uninstalled',
  'credentials_rejected',
  'inbound_failed',
] as const;

export const connectorAlertSchema = z.object({
  id: z.string().min(1),
  connectionId: z.string().min(1),
  kind: z.string().min(1),
  pubkyOrderId: z.string().nullable().optional(),
  detail: z.string().nullable().optional(),
  createdAt: isoTimestamp,
  resolvedAt: isoTimestamp.nullable().optional(),
});

export type ConnectorAlert = z.infer<typeof connectorAlertSchema>;

export const connectorAlertsSchema = z.object({
  kind: z.literal('connector_alerts'),
  alerts: z.array(connectorAlertSchema),
});

export type ConnectionState = 'connected' | 'needs_attention' | 'connecting' | 'disconnected';

export type ConnectionHealth = {
  state: ConnectionState;
  /** Why the connection needs attention, in seller copy; empty unless `needs_attention`. */
  reasons: string[];
  missingScopes: string[];
};

const STORE_GONE_ERRORS: ReadonlySet<string> = new Set(['app_uninstalled', 'store_uninstalled', 'disconnected']);

export function missingScopesFor(provider: ConnectorProvider, granted: readonly string[]): string[] {
  if (provider === 'shopify') {
    const have = new Set(granted);
    return SHOPIFY_REQUIRED_SCOPES.filter((scope) => !have.has(scope));
  }
  if (granted.length === 0) return [];
  const have = new Set(granted);
  return have.has(WOOCOMMERCE_REQUIRED_SCOPE) || (have.has('read') && have.has('write'))
    ? []
    : [WOOCOMMERCE_REQUIRED_SCOPE];
}

export function connectorErrorCopy(message: string | null | undefined, provider: ConnectorProvider): string {
  const store = CONNECTOR_PROVIDER_LABELS[provider];
  if (message === 'credentials_rejected') {
    return `${store} rejected the saved keys. Replace them below, then check the connection again.`;
  }
  return `${store} reported a problem with this connection. Replace the keys or reconnect.`;
}

/**
 * The health a seller sees for a connection. Disconnected connections are not
 * listed by the service, so `disconnected` only arises for a store that
 * uninstalled the app or removed the key (`lastError`), or when the caller
 * passes `disconnectedLocally` for one disconnected in this session.
 */
export function connectionHealth(
  connection: ConnectorConnection,
  options: { disconnectedLocally?: boolean } = {},
): ConnectionHealth {
  if (options.disconnectedLocally) return { state: 'disconnected', reasons: [], missingScopes: [] };
  const message = connection.lastError?.message;
  if (message && STORE_GONE_ERRORS.has(message)) {
    return { state: 'disconnected', reasons: [], missingScopes: [] };
  }
  if (connection.status === 'draft' || connection.status === 'pending') {
    return { state: 'connecting', reasons: [], missingScopes: [] };
  }
  const reasons: string[] = [];
  let missingScopes: string[] = [];
  if (connection.status === 'error') {
    reasons.push(connectorErrorCopy(message, connection.provider));
  } else {
    missingScopes = missingScopesFor(connection.provider, connection.scopes);
    if (missingScopes.length > 0) {
      reasons.push(`Missing permissions: ${missingScopes.join(', ')}. Add them to the app and install it again.`);
    }
  }
  if (connection.pushes.quarantined > 0) {
    const count = connection.pushes.quarantined;
    reasons.push(`${count} ${count === 1 ? 'order needs' : 'orders need'} your attention in Orders.`);
  }
  return {
    state: reasons.length > 0 ? 'needs_attention' : 'connected',
    reasons,
    missingScopes,
  };
}

export const CONNECTION_STATE_LABELS: Readonly<Record<ConnectionState, string>> = {
  connected: 'Connected',
  needs_attention: 'Needs attention',
  connecting: 'Not finished',
  disconnected: 'Disconnected',
};

const HOST_LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

function stripToHost(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '');
}

/** `your-store`, `your-store.myshopify.com` or a pasted admin URL, as the canonical `*.myshopify.com` domain. */
export function normalizeShopifyDomain(raw: string): string | null {
  const host = stripToHost(raw);
  if (host === '') return null;
  const full = host.includes('.') ? host : `${host}.myshopify.com`;
  if (!full.endsWith('.myshopify.com')) return null;
  const handle = full.slice(0, -'.myshopify.com'.length);
  return HOST_LABEL.test(handle) && handle.length <= 60 ? full : null;
}

export type WooStoreAddress = { ok: true; domain: string } | { ok: false; reason: 'invalid' | 'insecure' };

/**
 * A WooCommerce store address: https only (wc-auth sends keys to a callback
 * and the REST API needs a secure transport). The path of a subdirectory
 * install is kept; the scheme, query and trailing slash are not.
 */
export function normalizeWooStoreAddress(raw: string): WooStoreAddress {
  const trimmed = raw.trim();
  if (/^http:\/\//i.test(trimmed)) return { ok: false, reason: 'insecure' };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return { ok: false, reason: 'invalid' };
  const host = parsed.hostname.toLowerCase();
  const labels = host.split('.');
  if (labels.length < 2 || !labels.every((label) => HOST_LABEL.test(label))) return { ok: false, reason: 'invalid' };
  const path = parsed.pathname.replace(/\/+$/, '');
  return { ok: true, domain: `${host}${parsed.port ? `:${parsed.port}` : ''}${path}` };
}

/**
 * The wc-auth URL the service hands back must lead to the store the seller
 * typed. Anything else is refused, so a bad response cannot send the seller
 * to another site.
 */
export function isWooAuthorizeUrlFor(url: string, domain: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const expectedHost = domain.split('/')[0] ?? '';
  const host = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
  return host === expectedHost && parsed.pathname.endsWith('/wc-auth/v1/authorize');
}

/** The Shopify admin entry point of the guide: the store's own admin, never a pasted URL. */
export function shopifyAdminUrl(domain: string): string {
  const handle = domain.replace(/\.myshopify\.com$/, '');
  return `https://admin.shopify.com/store/${handle}`;
}

/** The fixed C7 paths, used when the service omits `urls` on a draft connection. */
export function shopifyConnectionUrls(serviceBaseUrl: string, connectionId: string): ConnectorUrls {
  const base = `${serviceBaseUrl.replace(/\/+$/, '')}/v1/connectors/shopify/c/${encodeURIComponent(connectionId)}`;
  return {
    appUrl: `${base}/launch`,
    allowedRedirectionUrl: `${base}/oauth/callback`,
    webhookUrl: `${base}/webhooks`,
  };
}

const PUSH_STATE_LABELS: Readonly<Record<ConnectorPushState, string>> = {
  pending: 'Waiting to send',
  sending: 'Sending',
  created: 'In your store',
  quarantined: 'Needs attention',
};

export function pushStateLabel(push: Pick<ConnectorPush, 'state' | 'quarantineSeverity'>): string {
  if (push.state === 'quarantined' && push.quarantineSeverity === 'info') return 'Not sent';
  return PUSH_STATE_LABELS[push.state];
}

const QUARANTINE_REASON_COPY: Readonly<Record<string, string>> = {
  order_cancelled_before_push: 'The order was cancelled before it reached your store. Nothing to do.',
  order_not_paid: 'The order is not paid, so it was not sent to your store.',
  order_not_found: 'The order could not be read to send it. Try again in a moment.',
  unmapped_variant:
    'An item in this order is not linked to a product in your store. Publish it from your store catalog, then retry.',
  connection_unavailable: 'Your store could not be reached. Check the connection, then retry.',
  credentials_rejected: 'Your store rejected the saved keys. Replace them in Store connections, then retry.',
  max_attempts_exceeded: 'We tried several times and your store did not take the order. Check it, then retry.',
  provider_rejected: 'Your store refused the order. Check the product and stock there, then retry.',
  validation: 'Your store refused the order details. Check the product there, then retry.',
  out_of_stock: 'Your store reports the item as out of stock. Add stock there, then retry.',
};

export function quarantineReasonCopy(reason: string | null | undefined): string {
  if (!reason) return 'Your store did not take this order. Check it there, then retry.';
  return QUARANTINE_REASON_COPY[reason] ?? `Your store refused this order (${reason}). Check it there, then retry.`;
}

/** A quarantined push the seller can act on; `info` ones (cancelled before the push) need nothing. */
export function pushNeedsAction(push: Pick<ConnectorPush, 'state' | 'quarantineSeverity'>): boolean {
  return push.state === 'quarantined' && push.quarantineSeverity !== 'info';
}

const ALERT_KIND_COPY: Readonly<Record<string, string>> = {
  push_quarantined: 'An order could not be sent to your store.',
  action_quarantined: 'A cancel or refund could not be mirrored in your store.',
  merchant_cancelled:
    'You cancelled this order in your store. Cancel it in Pubky too, and send the refund yourself: nothing is refunded automatically.',
  merchant_refunded:
    'You refunded this order in your store. Record the refund in Pubky: nothing is refunded automatically.',
  store_uninstalled: 'The app was removed from your store, so the connection is closed.',
  credentials_rejected: 'Your store rejected the saved keys. Replace them in Store connections.',
  inbound_failed: 'An update from your store could not be applied.',
};

export function connectorAlertCopy(kind: string): string {
  return ALERT_KIND_COPY[kind] ?? 'Something needs your attention in your store connection.';
}

/** Service refusal codes the connection screens explain; anything else gets generic copy. */
const CONNECT_REFUSAL_COPY: Readonly<Record<string, string>> = {
  connectors_disabled: 'Store connections are not switched on for this shop yet.',
  provider_unavailable: 'This store type is not available yet. Try again later.',
  invalid_domain: 'That store address was not accepted. Check it and try again.',
  invalid_provider: 'That store type is not supported.',
  already_connected: 'That store is already connected.',
  connection_limit: `You can have up to ${CONNECTOR_MAX_CONNECTIONS} store connections. Disconnect one first.`,
  provider_rejected: 'The store refused the request. Check the address and that the store is online.',
  provider_rate_limited: 'The store is busy. Wait a minute, then try again.',
  invalid_credentials: 'The store did not accept those keys. Check them and try again.',
  credentials_rejected: 'The store did not accept those keys. Check them and try again.',
  connection_not_found: 'This connection no longer exists. Start again.',
  connection_not_connected: 'This connection is not finished yet.',
  invalid_request: 'That request was not accepted. Check the fields and try again.',
};

export function connectorFailureCopy(reason: string | null | undefined, fallback: string): string {
  if (reason && CONNECT_REFUSAL_COPY[reason]) return CONNECT_REFUSAL_COPY[reason];
  return fallback;
}

export const SHOPIFY_RETURN_ERROR_COPY: Readonly<Record<string, string>> = {
  invalid_state: 'That install link expired or was already used. Click Install in Shopify again.',
  connect_rejected: 'Shopify did not approve the install. Check the Client ID and secret, then install again.',
  provider_unavailable: 'Shopify could not be reached. Try again in a moment.',
  shop_in_use: 'That store is already connected to another Pubky shop.',
};

export function shopifyReturnErrorCopy(code: string | null): string {
  return (code && SHOPIFY_RETURN_ERROR_COPY[code]) || 'The install did not finish. Start the install again.';
}

/** The service's refusal code on an error thrown by the connector calls, when it sent one. */
export function connectorRefusalReason(error: unknown): string | null {
  if (!isAppError(error)) return null;
  const reason = error.context?.reason;
  return typeof reason === 'string' ? reason : null;
}

export type ConnectionReturn =
  | { kind: 'connected'; connectionId: string | null; provider: ConnectorProvider | null }
  | { kind: 'error'; provider: ConnectorProvider | null; code: string | null }
  | { kind: 'unclaimed'; domain: string | null }
  | { kind: 'woo_returned'; approved: boolean };

function providerParam(value: string | null): ConnectorProvider | null {
  return value === 'shopify' || value === 'woocommerce' ? value : null;
}

/**
 * What the store connections page was opened for. The service redirects here
 * after a Shopify install (`status`, `connector`, `code`), and WooCommerce
 * sends the seller back with `success` and `user_id` after the approval screen.
 * Only the status words are read; the ids in the query are never trusted for
 * anything but picking a connection from the seller's own list.
 */
export function parseConnectionReturn(params: URLSearchParams): ConnectionReturn | null {
  const status = params.get('status');
  const provider = providerParam(params.get('provider'));
  if (status === 'connected') {
    return { kind: 'connected', connectionId: params.get('connector'), provider };
  }
  if (status === 'error') return { kind: 'error', provider, code: params.get('code') };
  if (status === 'install_unclaimed') return { kind: 'unclaimed', domain: params.get('domain') };
  const success = params.get('success');
  if (success === '1' || success === '0') return { kind: 'woo_returned', approved: success === '1' };
  return null;
}
