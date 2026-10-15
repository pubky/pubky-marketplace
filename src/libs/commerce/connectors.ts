import { z } from 'zod';
import { isAppError } from '@/libs/error/error';

/**
 * Store connections (WooCommerce, Shopify). Shapes follow the service's
 * connector contract (`/v1/connectors`, `internal/integrations/connector-contract.md`
 * read against `pubky-marketplace-service` `connectors/routes.rs`), after
 * `toCamelCaseWire`. `variantMode`, the settings route, the check route and the
 * alert `action` are stage 2 (the Shopify provider branch); everything else is
 * on the framework branch (#132).
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
export const SHOPIFY_DEV_DASHBOARD_URL = 'https://dev.shopify.com/dashboard';
export const CONNECTOR_MAX_CONNECTIONS = 5;

const isoTimestamp = z.string().min(1);

const connectionPushCountsSchema = z.object({
  pending: z.number().int().nonnegative().default(0),
  sending: z.number().int().nonnegative().default(0),
  created: z.number().int().nonnegative().default(0),
  quarantined: z.number().int().nonnegative().default(0),
});

export type ConnectorPushCounts = z.infer<typeof connectionPushCountsSchema>;

/** The URLs a merchant configures their store with; `launch` is Shopify's App URL and absent for WooCommerce. */
export const connectorUrlsSchema = z.object({
  launch: z.string().min(1).optional(),
  oauthCallback: z.string().min(1),
  webhooks: z.string().min(1),
});

export type ConnectorUrls = z.infer<typeof connectorUrlsSchema>;

export const CONNECTOR_STATUSES = ['draft', 'connected', 'needs_attention', 'error'] as const;
export const VARIANT_MODES = ['native', 'split'] as const;
export type VariantMode = (typeof VARIANT_MODES)[number];

export const connectorConnectionSchema = z.object({
  id: z.string().min(1),
  provider: z.enum(CONNECTOR_PROVIDERS),
  domain: z.string().min(1),
  appKind: z.enum(['none', 'custom', 'public']),
  /** Stage 2. `native` is the documented default when the service has no setting yet. */
  variantMode: z.enum(VARIANT_MODES).default('native'),
  status: z.enum(CONNECTOR_STATUSES),
  scopes: z.array(z.string()).default([]),
  missingScopes: z.array(z.string()).default([]),
  credentialsSaved: z.boolean(),
  urls: connectorUrlsSchema,
  expiresAt: isoTimestamp.nullable().optional(),
  connectedAt: isoTimestamp.nullable().optional(),
  createdAt: isoTimestamp.optional(),
  updatedAt: isoTimestamp.optional(),
  lastError: z.object({ message: z.string(), at: isoTimestamp.nullable().optional() }).nullable().optional(),
  mappingCount: z.number().int().nonnegative().default(0),
  pushes: connectionPushCountsSchema.default({ pending: 0, sending: 0, created: 0, quarantined: 0 }),
});

export type ConnectorConnection = z.infer<typeof connectorConnectionSchema>;

export const connectorListSchema = z.object({
  kind: z.literal('connector_list'),
  connections: z.array(connectorConnectionSchema),
});

export const connectorConnectSchema = z.object({
  kind: z.literal('connector_connect'),
  connection: connectorConnectionSchema,
  authorizeUrl: z.string().nullable(),
});

export type ConnectorConnectResult = z.infer<typeof connectorConnectSchema>;

/** `PUT /credentials` and `PUT /settings` answer with the updated connection. */
export const connectorCredentialsResultSchema = z.object({
  kind: z.literal('connector_credentials'),
  connection: connectorConnectionSchema,
});

export const connectorSettingsResultSchema = z.object({
  kind: z.literal('connector_settings'),
  connection: connectorConnectionSchema,
});

export const connectorCheckSchema = z.object({
  kind: z.literal('connector_check'),
  connectionId: z.string().min(1),
  shopName: z.string().nullable(),
  grantedScopes: z.array(z.string()).default([]),
  missingScopes: z.array(z.string()).default([]),
  locationCount: z.number().int().nonnegative().nullable(),
  catalogReadable: z.boolean(),
});

export type ConnectorCheck = z.infer<typeof connectorCheckSchema>;

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

/** The existing Pubky flow a store-side cancel or refund alert leads to (C13); `null` when none applies. */
export const connectorAlertActionSchema = z.object({
  kind: z.string().min(1),
  command: z.string().min(1),
  orderId: z.string().min(1),
  label: z.string().min(1),
});

export type ConnectorAlertAction = z.infer<typeof connectorAlertActionSchema>;

export const connectorAlertSchema = z.object({
  id: z.string().min(1),
  connectionId: z.string().min(1),
  kind: z.string().min(1),
  pubkyOrderId: z.string().nullable().optional(),
  orderState: z.string().nullable().optional(),
  action: connectorAlertActionSchema.nullable().optional(),
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

/** `last_error.message` values the service sets (`webhook_registration_failed` and `credentials_rejected`). */
export function connectorErrorCopy(message: string | null | undefined, provider: ConnectorProvider): string {
  const store = CONNECTOR_PROVIDER_LABELS[provider];
  if (message === 'credentials_rejected') {
    return `${store} rejected the saved keys. Replace them below, then install again and check the connection.`;
  }
  if (message === 'webhook_registration_failed') {
    return `Pubky could not register its updates with ${store}, so stock and tracking from the store may not arrive. Install the app again to retry.`;
  }
  return `${store} reported a problem with this connection. Install again or replace the keys.`;
}

/**
 * The health a seller sees for a connection, from the service's own status
 * (`draft`, `connected`, `needs_attention`, `error`) and its `missing_scopes`.
 * The service omits disconnected connections, so `disconnected` only arises for
 * one disconnected in this visit (`disconnectedLocally`).
 */
export function connectionHealth(
  connection: ConnectorConnection,
  options: { disconnectedLocally?: boolean } = {},
): ConnectionHealth {
  if (options.disconnectedLocally) return { state: 'disconnected', reasons: [], missingScopes: [] };
  if (connection.status === 'draft') return { state: 'connecting', reasons: [], missingScopes: [] };
  const reasons: string[] = [];
  const missingScopes = connection.missingScopes;
  if (connection.status === 'error') {
    reasons.push(connectorErrorCopy(connection.lastError?.message, connection.provider));
  } else if (connection.status === 'needs_attention') {
    if (missingScopes.length > 0) {
      reasons.push(`Missing permissions: ${missingScopes.join(', ')}. Add them to the app and install it again.`);
    } else {
      reasons.push(connectorErrorCopy(connection.lastError?.message, connection.provider));
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

/**
 * The one-click entry a store-side cancel or refund alert offers into the
 * existing Pubky flow (C13). Only the two commands the service names are
 * honoured; the seller still takes the step in the order itself, and nothing
 * here cancels or refunds.
 */
const ALERT_ACTION_LABELS: Readonly<Record<string, { command: string; label: string }>> = {
  approve_cancellation: { command: 'order.cancel_approve', label: "Approve the buyer's cancellation request" },
  record_refund: { command: 'refund.record_external', label: 'Record the refund you sent the buyer' },
};

export function connectorAlertAction(alert: Pick<ConnectorAlert, 'action'>): { label: string; orderId: string } | null {
  const action = alert.action;
  if (!action) return null;
  const known = ALERT_ACTION_LABELS[action.kind];
  if (!known || known.command !== action.command || !/^[A-Za-z0-9_-]{1,128}$/.test(action.orderId)) return null;
  return { label: known.label, orderId: action.orderId };
}

export function connectorAlertCopy(kind: string): string {
  return ALERT_KIND_COPY[kind] ?? 'Something needs your attention in your store connection.';
}

/** Service refusal codes the connection screens explain; anything else gets generic copy. */
const CONNECT_REFUSAL_COPY: Readonly<Record<string, string>> = {
  connectors_disabled: 'Store connections are not switched on for this shop yet.',
  invalid_domain: 'That store address was not accepted. Check it and try again.',
  invalid_provider: 'That store type is not supported.',
  already_connected: 'That store is already connected.',
  connection_limit: `You can have up to ${CONNECTOR_MAX_CONNECTIONS} store connections. Disconnect one first.`,
  provider_rejected: 'The store refused the request. Check the address and that the store is online.',
  provider_rate_limited: 'The store is busy. Wait a minute, then try again.',
  invalid_credentials: 'The store did not accept those keys. Check them and try again.',
  credentials_not_supported:
    'This store type cannot take pasted keys here yet. Disconnect it, then connect again through the store approval screen.',
  connection_not_available: 'This connection expired or was disconnected. Start again.',
  invalid_variant_mode: 'That setting was not accepted.',
  mappings_conflict:
    'Some of your listings combine several variants of one product, so this cannot be switched yet. End those listings, then switch.',
  credentials_rejected: 'The store did not accept those keys. Check them and try again.',
  connection_not_found: 'This connection no longer exists. Start again.',
  connection_not_connected: 'This connection is not finished yet.',
  invalid_request: 'That request was not accepted. Check the fields and try again.',
};

export function connectorFailureCopy(reason: string | null | undefined, fallback: string): string {
  if (reason && CONNECT_REFUSAL_COPY[reason]) return CONNECT_REFUSAL_COPY[reason];
  return fallback;
}

/**
 * Seller copy for a failed connector call. `provider_unavailable` is a 404 when
 * the store type is not built into the service and a 502 when the store itself
 * cannot be reached, so the status decides which one it means.
 */
export function connectorErrorMessage(error: unknown, fallback: string): string {
  const reason = connectorRefusalReason(error);
  if (reason === 'provider_unavailable' && isAppError(error) && error.context?.statusCode === 404) {
    return 'This store type is not available yet. Try again later.';
  }
  return connectorFailureCopy(reason, fallback);
}

export const SHOPIFY_RETURN_ERROR_COPY: Readonly<Record<string, string>> = {
  invalid_state: 'That install link expired or was already used. Install the app again from the Dev Dashboard.',
  connect_rejected: 'Shopify did not approve the install. Check the Client ID and secret, then install again.',
  credentials_missing: "Save the app's Client ID and secret here first, then install the app.",
  credentials_unreadable: 'The saved keys could not be read. Replace them here, then install again.',
  provider_unavailable: 'Shopify could not be reached. Try again in a moment.',
  shop_in_use: 'That store is already connected to another Pubky shop.',
  invalid_launch:
    "Shopify's install request could not be verified. Check that the Client secret saved here is the app's current one, then install again.",
  shop_mismatch:
    'The app was opened for a different store than the one you entered. Use the same store address in both places.',
  draft_expired: 'This connection expired or was disconnected. Start again from step 1.',
};

export function shopifyReturnErrorCopy(code: string | null): string {
  return (code && SHOPIFY_RETURN_ERROR_COPY[code]) || 'The install did not finish. Install the app again.';
}

/** The service's refusal code on an error thrown by the connector calls, when it sent one. */
export function connectorRefusalReason(error: unknown): string | null {
  if (!isAppError(error)) return null;
  const reason = error.context?.reason;
  return typeof reason === 'string' ? reason : null;
}

export type ConnectionReturn =
  | { kind: 'connected'; connectionId: string | null; provider: ConnectorProvider | null; needsAttention: boolean }
  | { kind: 'error'; connectionId: string | null; provider: ConnectorProvider | null; code: string | null }
  | { kind: 'woo_returned'; approved: boolean };

function providerParam(value: string | null): ConnectorProvider | null {
  return value === 'shopify' || value === 'woocommerce' ? value : null;
}

/**
 * What the store connections page was opened for. The service redirects here
 * after a Shopify install (`status` is `connected`, `needs_attention` or
 * `error`, with `connector`, and `code` on an error), and WooCommerce sends the
 * seller back with `success` and `user_id` after the approval screen. Only the
 * status words are read; the ids in the query are never trusted for anything
 * but picking a connection from the seller's own list.
 */
export function parseConnectionReturn(params: URLSearchParams): ConnectionReturn | null {
  const status = params.get('status');
  const provider = providerParam(params.get('provider'));
  const connectionId = params.get('connector');
  if (status === 'connected' || status === 'needs_attention') {
    return { kind: 'connected', connectionId, provider, needsAttention: status === 'needs_attention' };
  }
  if (status === 'error') return { kind: 'error', connectionId, provider, code: params.get('code') };
  const success = params.get('success');
  if (success === '1' || success === '0') return { kind: 'woo_returned', approved: success === '1' };
  return null;
}
