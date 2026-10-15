import { describe, expect, it } from 'vitest';
import { connectionFixture } from '@/test-utils/connector-fixtures';
import {
  connectionHealth,
  CONNECTOR_ALERT_KINDS,
  connectorAlertAction,
  connectorAlertCatalogRoute,
  connectorAlertCopy,
  connectorAlertSchema,
  connectorCatalogSchema,
  type ConnectorConnection,
  connectorFailureCopy,
  connectorListingRouteId,
  connectorListSchema,
  connectorSettingsResultSchema,
  isWooAuthorizeUrlFor,
  normalizeShopifyDomain,
  normalizeWooStoreAddress,
  parseConnectionReturn,
  pushNeedsAction,
  pushStateLabel,
  quarantineReasonCopy,
  SHOPIFY_REQUIRED_SCOPES,
  shopifyAdminUrl,
  shopifyReturnErrorCopy,
} from './connectors';
import { toCamelCaseWire } from './wire-casing';

function connection(overrides: Record<string, unknown> = {}): ConnectorConnection {
  return connectionFixture({
    id: '11111111-1111-4111-8111-111111111111',
    provider: 'shopify',
    domain: 'shop.myshopify.com',
    status: 'connected',
    scopes: [...SHOPIFY_REQUIRED_SCOPES],
    ...overrides,
  });
}

describe('normalizeShopifyDomain', () => {
  it.each([
    ['your-store.myshopify.com', 'your-store.myshopify.com'],
    ['  Your-Store  ', 'your-store.myshopify.com'],
    ['https://Your-Store.myshopify.com/admin/settings', 'your-store.myshopify.com'],
    ['your-store.myshopify.com:443', 'your-store.myshopify.com'],
  ])('reads %s', (input, expected) => {
    expect(normalizeShopifyDomain(input)).toBe(expected);
  });

  it.each([
    '',
    '   ',
    'example.com',
    'evil.com/.myshopify.com',
    'a b.myshopify.com',
    '-bad.myshopify.com',
    '.myshopify.com',
  ])('refuses %j', (input) => {
    expect(normalizeShopifyDomain(input)).toBeNull();
  });
});

describe('normalizeWooStoreAddress', () => {
  it('accepts a host, an https URL and a subdirectory install', () => {
    expect(normalizeWooStoreAddress('Shop.Example.com')).toEqual({ ok: true, domain: 'shop.example.com' });
    expect(normalizeWooStoreAddress('https://dezentralshop.ch/')).toEqual({ ok: true, domain: 'dezentralshop.ch' });
    expect(normalizeWooStoreAddress('https://example.com/store/?x=1#y')).toEqual({
      ok: true,
      domain: 'example.com/store',
    });
  });

  it('refuses plain http and says why', () => {
    expect(normalizeWooStoreAddress('http://shop.example.com')).toEqual({ ok: false, reason: 'insecure' });
  });

  it.each(['', 'localhost', 'not a url', 'https://user:pw@shop.example.com', 'ftp://shop.example.com', 'a..b'])(
    'refuses %j',
    (input) => {
      expect(normalizeWooStoreAddress(input)).toMatchObject({ ok: false });
    },
  );
});

describe('isWooAuthorizeUrlFor', () => {
  const url = 'https://shop.example.com/wc-auth/v1/authorize?app_name=Pubky+Shop&scope=read_write';

  it('accepts the store own wc-auth URL', () => {
    expect(isWooAuthorizeUrlFor(url, 'shop.example.com')).toBe(true);
    expect(isWooAuthorizeUrlFor('https://example.com/store/wc-auth/v1/authorize?x=1', 'example.com/store')).toBe(true);
  });

  it('refuses another host, plain http, another path and junk', () => {
    expect(isWooAuthorizeUrlFor(url, 'other.example.com')).toBe(false);
    expect(isWooAuthorizeUrlFor(url.replace('https', 'http'), 'shop.example.com')).toBe(false);
    expect(isWooAuthorizeUrlFor('https://shop.example.com/login', 'shop.example.com')).toBe(false);
    expect(isWooAuthorizeUrlFor('https://shop.example.com.evil.test/wc-auth/v1/authorize', 'shop.example.com')).toBe(
      false,
    );
    expect(isWooAuthorizeUrlFor('', 'shop.example.com')).toBe(false);
  });
});

describe('Shopify guide', () => {
  it('opens the store admin by handle', () => {
    expect(shopifyAdminUrl('your-store.myshopify.com')).toBe('https://admin.shopify.com/store/your-store');
  });

  it('lists the five scopes of the approved copy', () => {
    expect(SHOPIFY_REQUIRED_SCOPES.join(', ')).toBe(
      'read_products, read_inventory, read_locations, read_fulfillments, write_orders',
    );
  });
});

describe('connectionHealth', () => {
  it('is connected when the service says so and nothing is stuck', () => {
    expect(connectionHealth(connection())).toEqual({ state: 'connected', reasons: [], missingScopes: [] });
  });

  it('needs attention with the permissions the service says are missing', () => {
    const health = connectionHealth(
      connection({
        status: 'needs_attention',
        scopes: ['read_products'],
        missingScopes: ['read_inventory', 'read_locations', 'read_fulfillments', 'write_orders'],
      }),
    );
    expect(health.state).toBe('needs_attention');
    expect(health.missingScopes).toEqual(['read_inventory', 'read_locations', 'read_fulfillments', 'write_orders']);
    expect(health.reasons[0]).toContain('Missing permissions: read_inventory');
  });

  it('says the webhooks could not be registered when no scope is missing', () => {
    const health = connectionHealth(
      connection({ status: 'needs_attention', lastError: { message: 'webhook_registration_failed', at: null } }),
    );
    expect(health.state).toBe('needs_attention');
    expect(health.reasons[0]).toContain('could not register its updates with Shopify');
  });

  it('needs attention when the store rejected the keys', () => {
    const health = connectionHealth(
      connection({ status: 'error', lastError: { message: 'credentials_rejected', at: '2026-10-15T10:00:00.000Z' } }),
    );
    expect(health.state).toBe('needs_attention');
    expect(health.reasons[0]).toBe(
      'Shopify rejected the saved keys. Replace them below, then install again and check the connection.',
    );
  });

  it('counts quarantined orders as a reason', () => {
    const health = connectionHealth(connection({ pushes: { pending: 0, sending: 0, created: 4, quarantined: 2 } }));
    expect(health.state).toBe('needs_attention');
    expect(health.reasons).toEqual(['2 orders need your attention in Orders.']);
  });

  it('says one order, singular', () => {
    const health = connectionHealth(connection({ pushes: { pending: 0, sending: 0, created: 0, quarantined: 1 } }));
    expect(health.reasons).toEqual(['1 order needs your attention in Orders.']);
  });

  it('is not finished while a draft', () => {
    expect(connectionHealth(connection({ status: 'draft' })).state).toBe('connecting');
  });

  it('is disconnected only for a connection disconnected in this visit', () => {
    expect(connectionHealth(connection(), { disconnectedLocally: true }).state).toBe('disconnected');
  });

  it('does not read a status the service does not send', () => {
    expect(() => connection({ status: 'pending' })).toThrow();
    expect(() => connection({ status: 'disconnected' })).toThrow();
  });
});

describe('parseConnectionReturn', () => {
  const parse = (query: string) => parseConnectionReturn(new URLSearchParams(query));

  it('reads the Shopify redirects', () => {
    expect(parse('status=connected&connector=abc')).toEqual({
      kind: 'connected',
      connectionId: 'abc',
      needsAttention: false,
    });
    expect(parse('status=needs_attention&connector=abc')).toEqual({
      kind: 'connected',
      connectionId: 'abc',
      needsAttention: true,
    });
    expect(parse('status=error&code=invalid_state')).toEqual({
      kind: 'error',
      connectionId: null,
      code: 'invalid_state',
    });
    expect(parse('status=error&code=draft_expired&connector=abc')).toMatchObject({ connectionId: 'abc' });
  });

  it('does not read a provider from the query, which the service never sends', () => {
    expect(parse('status=connected&connector=abc&provider=woocommerce')).toEqual({
      kind: 'connected',
      connectionId: 'abc',
      needsAttention: false,
    });
  });

  it('reads the WooCommerce return', () => {
    expect(parse('success=1&user_id=nonce')).toEqual({ kind: 'woo_returned', approved: true });
    expect(parse('success=0&user_id=nonce')).toEqual({ kind: 'woo_returned', approved: false });
  });

  it('ignores anything else', () => {
    expect(parse('')).toBeNull();
    expect(parse('status=whatever')).toBeNull();
    expect(parse('status=install_unclaimed&provider=shopify')).toBeNull();
    expect(parse('success=maybe')).toBeNull();
  });
});

describe('copy', () => {
  it('explains known return and refusal codes, with a fallback for the rest', () => {
    expect(shopifyReturnErrorCopy('shop_in_use')).toContain('already connected');
    expect(shopifyReturnErrorCopy('unheard_of')).toContain('install did not finish');
    expect(connectorFailureCopy('already_connected', 'x')).toBe('That store is already connected.');
    expect(connectorFailureCopy('nope', 'fallback')).toBe('fallback');
    expect(connectorFailureCopy(null, 'fallback')).toBe('fallback');
  });

  it('explains quarantine reasons, including the provider own codes', () => {
    expect(quarantineReasonCopy('unmapped_variant')).toContain('not linked to a product');
    expect(quarantineReasonCopy('weird_code')).toContain('(weird_code)');
    expect(quarantineReasonCopy(null)).toContain('did not take this order');
  });

  it('offers a one-click entry only for the two commands the service names, to an order id', () => {
    const alert = (action: { kind: string; command: string; orderId: string }) =>
      connectorAlertSchema.parse({
        id: 'a',
        connectionId: 'c',
        kind: 'merchant_cancelled',
        createdAt: '2026-10-15T12:00:00.000Z',
        action: { label: 'service text', ...action },
      });
    expect(
      connectorAlertAction(alert({ kind: 'approve_cancellation', command: 'order.cancel_approve', orderId: 'o-1' })),
    ).toEqual({
      label: "Approve the buyer's cancellation request",
      orderId: 'o-1',
    });
    expect(
      connectorAlertAction(alert({ kind: 'record_refund', command: 'refund.record_external', orderId: 'o-1' })),
    ).toEqual({
      label: 'Record the refund you sent the buyer',
      orderId: 'o-1',
    });
    expect(
      connectorAlertAction(alert({ kind: 'record_refund', command: 'order.cancel_approve', orderId: 'o-1' })),
    ).toBeNull();
    expect(
      connectorAlertAction(alert({ kind: 'cancel_everything', command: 'order.cancel', orderId: 'o-1' })),
    ).toBeNull();
    expect(
      connectorAlertAction(alert({ kind: 'record_refund', command: 'refund.record_external', orderId: '../x' })),
    ).toBeNull();
    expect(connectorAlertAction({ action: null })).toBeNull();
    expect(connectorAlertAction({})).toBeNull();
  });

  it('says the seller must cancel and refund in Pubky after a store-side cancel', () => {
    expect(connectorAlertCopy('merchant_cancelled')).toContain('nothing is refunded automatically');
  });

  it.each([
    ['variant_mapping_error', 'Re-link the product to keep its stock in sync'],
    ['refund_reversed_after_mirror', 'Correct it in your store'],
    ['push_total_mismatch', 'different total than the buyer paid'],
    ['listings_unmapped', 'Import each variant again'],
  ])('explains the %s alert in plain words, never the generic fallback', (kind, phrase) => {
    expect(CONNECTOR_ALERT_KINDS).toContain(kind);
    expect(connectorAlertCopy(kind)).toContain(phrase);
    expect(connectorAlertCopy(kind)).not.toBe(connectorAlertCopy('something_new'));
  });

  it('links the alerts that need the catalog to the picker of their own connection, and no others', () => {
    expect(connectorAlertCatalogRoute({ kind: 'variant_mapping_error', connectionId: 'c1' })).toBe(
      '/marketplace/settings/store-connections/c1',
    );
    expect(connectorAlertCatalogRoute({ kind: 'listings_unmapped', connectionId: 'c 2' })).toBe(
      '/marketplace/settings/store-connections/c%202',
    );
    expect(connectorAlertCatalogRoute({ kind: 'push_total_mismatch', connectionId: 'c1' })).toBeNull();
    expect(connectorAlertCatalogRoute({ kind: 'merchant_cancelled', connectionId: 'c1' })).toBeNull();
  });

  it('only puts a listing id the service named into a route when it is a plain id', () => {
    expect(connectorListingRouteId('boots_01')).toBe('boots_01');
    expect(connectorListingRouteId('woo-9-71')).toBe('woo-9-71');
    expect(connectorListingRouteId('../x')).toBeNull();
    expect(connectorListingRouteId('a/b')).toBeNull();
    expect(connectorListingRouteId('')).toBeNull();
  });

  it('reads the settings answer with and without unlinked listings, and has no conflict copy left', () => {
    const connection = connectionFixture({ variantMode: 'split' });
    const base = { kind: 'connector_settings', connection };
    expect(connectorSettingsResultSchema.parse(base).unmappedListings).toEqual([]);
    expect(
      connectorSettingsResultSchema.parse({ ...base, unmappedListings: [{ listingId: 'a', mappingsRemoved: 2 }] })
        .unmappedListings,
    ).toEqual([{ listingId: 'a', mappingsRemoved: 2 }]);
    expect(
      connectorSettingsResultSchema.safeParse({ ...base, unmappedListings: [{ listingId: 'a', mappingsRemoved: -1 }] })
        .success,
    ).toBe(false);
    expect(connectorFailureCopy('mappings_conflict', 'fallback')).toBe('fallback');
  });

  it('labels push states and treats info quarantines as nothing to do', () => {
    expect(pushStateLabel({ state: 'created', quarantineSeverity: null })).toBe('In your store');
    expect(pushStateLabel({ state: 'quarantined', quarantineSeverity: 'action_required' })).toBe('Needs attention');
    expect(pushStateLabel({ state: 'quarantined', quarantineSeverity: 'info' })).toBe('Not sent');
    expect(pushNeedsAction({ state: 'quarantined', quarantineSeverity: 'info' })).toBe(false);
    expect(pushNeedsAction({ state: 'quarantined', quarantineSeverity: 'action_required' })).toBe(true);
    expect(pushNeedsAction({ state: 'created', quarantineSeverity: null })).toBe(false);
  });
});

describe('contract shapes', () => {
  it('parses the documented list', () => {
    const wire = {
      kind: 'connector_list',
      schema_version: 1,
      connections: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          provider: 'woocommerce',
          domain: 'dezentralshop.ch',
          app_kind: 'none',
          variant_mode: 'split',
          status: 'connected',
          scopes: ['read_write'],
          missing_scopes: [],
          credentials_saved: false,
          urls: {
            oauth_callback: 'https://api.example/v1/connectors/woocommerce/oauth/callback',
            webhooks: 'https://api.example/v1/connectors/webhooks/woocommerce',
          },
          expires_at: null,
          connected_at: '2026-10-15T10:00:00.000Z',
          created_at: '2026-10-15T09:00:00.000Z',
          updated_at: '2026-10-15T10:00:00.000Z',
          last_error: null,
          mapping_count: 7,
          pushes: { pending: 0, sending: 0, created: 3, quarantined: 1 },
        },
      ],
    };
    const parsed = connectorListSchema.parse(toCamelCaseWire(wire));
    expect(parsed.connections[0]).toMatchObject({
      mappingCount: 7,
      variantMode: 'split',
      appKind: 'none',
      credentialsSaved: false,
      pushes: { created: 3, quarantined: 1 },
    });
    expect(parsed.connections[0]?.urls.launch).toBeUndefined();
  });

  it('parses a catalog page in the documented shape', () => {
    const wire = {
      kind: 'connector_catalog',
      connection_id: '11111111-1111-4111-8111-111111111111',
      products: [
        {
          provider_product_id: '77',
          title: 'Socks',
          description: null,
          url: null,
          options: [{ name: 'Size', values: ['S', 'M'] }],
          image_urls: ['https://dezentralshop.ch/a.jpg'],
          variants: [
            {
              provider_variant_id: '78',
              sku: 'SOCK-S',
              title: 'S',
              option_values: [{ name: 'Size', value: 'S' }],
              price: { amount_minor: 2500, currency: 'CHF', exponent: 2 },
              stock: null,
              image_url: null,
            },
          ],
          selected: false,
        },
      ],
      next_page: null,
    };
    const parsed = connectorCatalogSchema.parse(toCamelCaseWire(wire));
    expect(parsed.products[0]?.variants[0]).toMatchObject({
      providerVariantId: '78',
      price: { amountMinor: 2500, currency: 'CHF', exponent: 2 },
      stock: null,
    });
  });
});
