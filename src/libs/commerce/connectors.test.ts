import { describe, expect, it } from 'vitest';
import {
  connectionHealth,
  connectorAlertCopy,
  connectorCatalogSchema,
  type ConnectorConnection,
  connectorConnectionSchema,
  connectorFailureCopy,
  connectorListSchema,
  isWooAuthorizeUrlFor,
  missingScopesFor,
  normalizeShopifyDomain,
  normalizeWooStoreAddress,
  parseConnectionReturn,
  pushNeedsAction,
  pushStateLabel,
  quarantineReasonCopy,
  SHOPIFY_REQUIRED_SCOPES,
  shopifyAdminUrl,
  shopifyConnectionUrls,
  shopifyReturnErrorCopy,
} from './connectors';
import { toCamelCaseWire } from './wire-casing';

function connection(overrides: Partial<ConnectorConnection> = {}): ConnectorConnection {
  return connectorConnectionSchema.parse({
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

describe('Shopify guide URLs', () => {
  it('derives the fixed per-connection paths', () => {
    expect(shopifyConnectionUrls('https://staging-api.pubky.app/', 'abc')).toEqual({
      appUrl: 'https://staging-api.pubky.app/v1/connectors/shopify/c/abc/launch',
      allowedRedirectionUrl: 'https://staging-api.pubky.app/v1/connectors/shopify/c/abc/oauth/callback',
      webhookUrl: 'https://staging-api.pubky.app/v1/connectors/shopify/c/abc/webhooks',
    });
  });

  it('opens the store admin by handle', () => {
    expect(shopifyAdminUrl('your-store.myshopify.com')).toBe('https://admin.shopify.com/store/your-store');
  });

  it('lists the five scopes of the approved copy', () => {
    expect(SHOPIFY_REQUIRED_SCOPES.join(', ')).toBe(
      'read_products, read_inventory, read_locations, read_fulfillments, write_orders',
    );
  });
});

describe('missingScopesFor', () => {
  it('names each Shopify scope that was not granted', () => {
    expect(missingScopesFor('shopify', ['read_products', 'write_orders'])).toEqual([
      'read_inventory',
      'read_locations',
      'read_fulfillments',
    ]);
    expect(missingScopesFor('shopify', [...SHOPIFY_REQUIRED_SCOPES])).toEqual([]);
  });

  it('needs read_write on WooCommerce, but does not flag keys whose scope is unknown', () => {
    expect(missingScopesFor('woocommerce', [])).toEqual([]);
    expect(missingScopesFor('woocommerce', ['read'])).toEqual(['read_write']);
    expect(missingScopesFor('woocommerce', ['read_write'])).toEqual([]);
    expect(missingScopesFor('woocommerce', ['read', 'write'])).toEqual([]);
  });
});

describe('connectionHealth', () => {
  it('is connected when scopes are complete and nothing is stuck', () => {
    expect(connectionHealth(connection())).toEqual({ state: 'connected', reasons: [], missingScopes: [] });
  });

  it('needs attention with the missing permissions named', () => {
    const health = connectionHealth(connection({ scopes: ['read_products'] }));
    expect(health.state).toBe('needs_attention');
    expect(health.missingScopes).toEqual(['read_inventory', 'read_locations', 'read_fulfillments', 'write_orders']);
    expect(health.reasons[0]).toContain('Missing permissions: read_inventory');
  });

  it('needs attention when the store rejected the keys', () => {
    const health = connectionHealth(
      connection({ status: 'error', lastError: { message: 'credentials_rejected', at: '2026-10-15T10:00:00.000Z' } }),
    );
    expect(health.state).toBe('needs_attention');
    expect(health.reasons[0]).toBe(
      'Shopify rejected the saved keys. Replace them below, then check the connection again.',
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

  it('is not finished while draft or pending', () => {
    expect(connectionHealth(connection({ status: 'draft' })).state).toBe('connecting');
    expect(connectionHealth(connection({ status: 'pending' })).state).toBe('connecting');
  });

  it('is disconnected after an uninstall or a local disconnect', () => {
    expect(connectionHealth(connection({ status: 'error', lastError: { message: 'app_uninstalled' } })).state).toBe(
      'disconnected',
    );
    expect(connectionHealth(connection(), { disconnectedLocally: true }).state).toBe('disconnected');
  });
});

describe('parseConnectionReturn', () => {
  const parse = (query: string) => parseConnectionReturn(new URLSearchParams(query));

  it('reads the Shopify redirects', () => {
    expect(parse('status=connected&connector=abc')).toEqual({ kind: 'connected', connectionId: 'abc', provider: null });
    expect(parse('status=error&code=invalid_state')).toEqual({ kind: 'error', provider: null, code: 'invalid_state' });
    expect(parse('status=install_unclaimed&provider=shopify&domain=a.myshopify.com')).toEqual({
      kind: 'unclaimed',
      domain: 'a.myshopify.com',
    });
  });

  it('reads the WooCommerce return', () => {
    expect(parse('success=1&user_id=nonce')).toEqual({ kind: 'woo_returned', approved: true });
    expect(parse('success=0&user_id=nonce')).toEqual({ kind: 'woo_returned', approved: false });
  });

  it('ignores anything else', () => {
    expect(parse('')).toBeNull();
    expect(parse('status=whatever')).toBeNull();
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

  it('says the seller must cancel and refund in Pubky after a store-side cancel', () => {
    expect(connectorAlertCopy('merchant_cancelled')).toContain('nothing is refunded automatically');
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
  it('parses the documented list, with and without the optional fields', () => {
    const wire = {
      kind: 'connector_list',
      schema_version: 1,
      connections: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          provider: 'woocommerce',
          domain: 'dezentralshop.ch',
          app_key: null,
          status: 'connected',
          scopes: ['read_write'],
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
    expect(parsed.connections[0]).toMatchObject({ mappingCount: 7, pushes: { created: 3, quarantined: 1 } });
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
