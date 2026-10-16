import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/libs/error/error';
import { AuthErrorCode } from '@/libs/error/error.codes';
import { Logger } from '@/libs/logger/logger';
import { MarketplaceConnectorsService } from './marketplace-connectors';
import { MarketplaceSessionService } from './marketplace-session';

const ACTOR = 'y'.repeat(52);
const TOKEN = 'T'.repeat(43);
const CONNECTION_ID = '11111111-1111-4111-8111-111111111111';
const BASE = 'http://127.0.0.1:8080';

const config = vi.hoisted(() => ({ mode: 'transaction-service' as string }));

vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return {
    ...actual,
    getCommerceAdapterMode: () => config.mode,
    getMarketplaceUrl: () => 'http://127.0.0.1:8080',
  };
});

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

const connectionWire = {
  id: CONNECTION_ID,
  provider: 'woocommerce',
  domain: 'dezentralshop.ch',
  app_kind: 'none',
  variant_mode: 'native',
  status: 'draft',
  scopes: [],
  missing_scopes: [],
  credentials_saved: false,
  urls: {
    oauth_callback: 'https://api.example/v1/connectors/woocommerce/oauth/callback',
    webhooks: 'https://api.example/v1/connectors/webhooks/woocommerce',
  },
  expires_at: '2026-10-15T12:30:00.000Z',
  connected_at: null,
  created_at: '2026-10-15T12:00:00.000Z',
  updated_at: '2026-10-15T12:00:00.000Z',
  last_error: null,
  mapping_count: 0,
  pushes: { pending: 0, sending: 0, created: 0, quarantined: 0 },
};

describe('MarketplaceConnectorsService', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    config.mode = 'transaction-service';
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(MarketplaceSessionService, 'getActiveSession').mockReturnValue({
      token: TOKEN,
      pubky: ACTOR,
    } as ReturnType<typeof MarketplaceSessionService.getActiveSession>);
    vi.spyOn(MarketplaceSessionService, 'clearSessionIfBearer').mockImplementation(() => {});
    vi.spyOn(Logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function lastCall() {
    const [url, init] = fetchMock.mock.calls.at(-1) ?? [];
    return { url: String(url), init: (init ?? {}) as RequestInit };
  }

  it('lists connections with the session bearer and no caching', async () => {
    fetchMock.mockResolvedValue(json({ kind: 'connector_list', schema_version: 1, connections: [connectionWire] }));

    const connections = await MarketplaceConnectorsService.list(ACTOR);

    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({ provider: 'woocommerce', domain: 'dezentralshop.ch', mappingCount: 0 });
    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/v1/connectors`);
    expect(init.method).toBe('GET');
    expect(init.cache).toBe('no-store');
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('starts a connection with only the provider and the store domain', async () => {
    fetchMock.mockResolvedValue(
      json(
        {
          kind: 'connector_connect',
          schema_version: 1,
          connection: connectionWire,
          authorize_url: 'https://dezentralshop.ch/wc-auth/v1/authorize?scope=read_write',
        },
        201,
      ),
    );

    const started = await MarketplaceConnectorsService.connect(ACTOR, {
      provider: 'woocommerce',
      domain: 'dezentralshop.ch',
    });

    expect(started.authorizeUrl).toBe('https://dezentralshop.ch/wc-auth/v1/authorize?scope=read_write');
    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/v1/connectors`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ provider: 'woocommerce', domain: 'dezentralshop.ch' });
  });

  it('sends credentials once, snake_case, and reads the connection back with credentials saved', async () => {
    fetchMock.mockResolvedValue(
      json({
        kind: 'connector_credentials',
        schema_version: 1,
        connection: {
          ...connectionWire,
          provider: 'shopify',
          app_kind: 'custom',
          credentials_saved: true,
          urls: {
            launch: 'https://api.example/v1/connectors/shopify/c/x/launch',
            oauth_callback: 'https://api.example/v1/connectors/shopify/c/x/oauth/callback',
            webhooks: 'https://api.example/v1/connectors/shopify/c/x/webhooks',
          },
        },
      }),
    );

    const result = await MarketplaceConnectorsService.putCredentials(ACTOR, CONNECTION_ID, {
      clientId: 'client-id-value',
      clientSecret: 'client-secret-value',
    });

    expect(result).toMatchObject({ credentialsSaved: true, appKind: 'custom' });
    expect(result.urls.launch).toBe('https://api.example/v1/connectors/shopify/c/x/launch');
    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/v1/connectors/${CONNECTION_ID}/credentials`);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({
      client_id: 'client-id-value',
      client_secret: 'client-secret-value',
    });
  });

  it('refuses an answer to the credentials call that is not the connection', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(
      MarketplaceConnectorsService.putCredentials(ACTOR, CONNECTION_ID, { clientId: 'a', clientSecret: 'b' }),
    ).rejects.toMatchObject({ message: 'The marketplace service returned an unexpected response.' });
  });

  it('connects a WooCommerce draft with a pasted key pair, snake_case, and reads the connected store back', async () => {
    fetchMock.mockResolvedValue(
      json({
        kind: 'connector_connected',
        schema_version: 1,
        connection: {
          ...connectionWire,
          status: 'connected',
          scopes: ['read_write'],
          connected_at: '2026-10-15T12:05:00.000Z',
        },
      }),
    );

    const connection = await MarketplaceConnectorsService.putCredentials(ACTOR, CONNECTION_ID, {
      consumerKey: 'ck_0123456789abcdef',
      consumerSecret: 'cs_0123456789abcdef',
    });

    expect(connection.status).toBe('connected');
    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/v1/connectors/${CONNECTION_ID}/credentials`);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({
      consumer_key: 'ck_0123456789abcdef',
      consumer_secret: 'cs_0123456789abcdef',
    });
  });

  it.each([
    ['invalid_keys', 422],
    ['credentials_rejected', 422],
    ['keys_read_only', 422],
    ['not_pending', 409],
    ['shop_in_use', 409],
  ])('reports the %s refusal of a pasted key pair by its code', async (code, status) => {
    fetchMock.mockResolvedValue(json({ error: { code, message: 'x' } }, status));
    const error = await MarketplaceConnectorsService.putCredentials(ACTOR, CONNECTION_ID, {
      consumerKey: 'ck_x',
      consumerSecret: 'cs_x',
    }).catch((caught: unknown) => caught);
    expect((error as AppError).context).toMatchObject({ reason: code, statusCode: status });
    expect(JSON.stringify((error as AppError).context)).not.toContain('cs_x');
  });

  it('saves the variant mode with PUT settings', async () => {
    fetchMock.mockResolvedValue(
      json({ kind: 'connector_settings', schema_version: 1, connection: { ...connectionWire, variant_mode: 'split' } }),
    );
    const result = await MarketplaceConnectorsService.putSettings(ACTOR, CONNECTION_ID, { variantMode: 'split' });
    expect(result.connection.variantMode).toBe('split');
    expect(result.unmappedListings).toEqual([]);
    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/v1/connectors/${CONNECTION_ID}/settings`);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({ variant_mode: 'split' });
  });

  it('names the listings a switch to split unlinked', async () => {
    fetchMock.mockResolvedValue(
      json({
        kind: 'connector_settings',
        schema_version: 1,
        connection: { ...connectionWire, variant_mode: 'split' },
        unmapped_listings: [
          { listing_id: 'boots_01', mappings_removed: 2 },
          { listing_id: 'woo-9', mappings_removed: 3 },
        ],
      }),
    );
    const result = await MarketplaceConnectorsService.putSettings(ACTOR, CONNECTION_ID, { variantMode: 'split' });
    expect(result.unmappedListings).toEqual([
      { listingId: 'boots_01', mappingsRemoved: 2 },
      { listingId: 'woo-9', mappingsRemoved: 3 },
    ]);
  });

  it('refuses a settings answer whose unlinked listings are not the documented shape', async () => {
    fetchMock.mockResolvedValue(
      json({
        kind: 'connector_settings',
        schema_version: 1,
        connection: { ...connectionWire, variant_mode: 'split' },
        unmapped_listings: [{ listing: 'boots_01' }],
      }),
    );
    await expect(
      MarketplaceConnectorsService.putSettings(ACTOR, CONNECTION_ID, { variantMode: 'split' }),
    ).rejects.toMatchObject({ message: 'The marketplace service returned an unexpected response.' });
  });

  it('reads the live check of a store', async () => {
    fetchMock.mockResolvedValue(
      json({
        kind: 'connector_check',
        schema_version: 1,
        connection_id: CONNECTION_ID,
        shop_name: 'Your Store',
        granted_scopes: ['read_products'],
        missing_scopes: ['write_orders'],
        location_count: 2,
        catalog_readable: true,
        checked_at: '2026-10-15T12:00:00.000Z',
      }),
    );
    expect(await MarketplaceConnectorsService.check(ACTOR, CONNECTION_ID)).toMatchObject({
      shopName: 'Your Store',
      missingScopes: ['write_orders'],
      locationCount: 2,
      catalogReadable: true,
    });
    expect(lastCall().url).toBe(`${BASE}/v1/connectors/${CONNECTION_ID}/check`);
  });

  it('never puts a credential in an error, a log line or an error context', async () => {
    const secret = 'super-secret-credential-value';
    fetchMock.mockResolvedValue(json({ error: { code: 'invalid_credentials', message: `bad ${secret}` } }, 422));

    const error = await MarketplaceConnectorsService.putCredentials(ACTOR, CONNECTION_ID, {
      consumerKey: 'ck_publickeyvalue',
      consumerSecret: secret,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect(
      JSON.stringify({ message: (error as AppError).message, context: (error as AppError).context }),
    ).not.toContain(secret);
    expect((error as AppError).context?.reason).toBe('invalid_credentials');
    expect(JSON.stringify(vi.mocked(Logger.error).mock.calls)).not.toContain(secret);
  });

  it('maps a refusal to the service code and status', async () => {
    fetchMock.mockResolvedValue(json({ error: { code: 'already_connected', message: 'x' } }, 409));
    const error = await MarketplaceConnectorsService.connect(ACTOR, {
      provider: 'shopify',
      domain: 'a.myshopify.com',
    }).catch((caught: unknown) => caught);
    expect((error as AppError).context).toMatchObject({ reason: 'already_connected', statusCode: 409 });
  });

  it('names the listing a mapping refusal is about, and nothing else from the body', async () => {
    fetchMock.mockResolvedValue(
      json({ error: { code: 'listing_not_found', message: 'secret detail', listing_id: 'woo-7718' } }, 422),
    );
    const error = await MarketplaceConnectorsService.putMappings(ACTOR, CONNECTION_ID, [
      { listingId: 'woo-7718', providerProductId: '1' },
    ]).catch((caught: unknown) => caught);
    expect((error as AppError).context).toMatchObject({ reason: 'listing_not_found', listingId: 'woo-7718' });
    expect(JSON.stringify((error as AppError).context)).not.toContain('secret detail');
  });

  it('keeps only a well-formed refusal code', async () => {
    fetchMock.mockResolvedValue(json({ error: { code: 'Has Spaces <script>', message: 'x' } }, 422));
    const error = await MarketplaceConnectorsService.list(ACTOR).catch((caught: unknown) => caught);
    expect((error as AppError).context?.reason).toBeUndefined();
  });

  it('drops the session and asks for a new approval on 401', async () => {
    fetchMock.mockResolvedValue(json({ error: { code: 'unauthorized', message: 'x' } }, 401));
    const error = await MarketplaceConnectorsService.list(ACTOR).catch((caught: unknown) => caught);
    expect((error as AppError).code).toBe(AuthErrorCode.SESSION_EXPIRED);
    expect(MarketplaceSessionService.clearSessionIfBearer).toHaveBeenCalledWith(TOKEN, 'rejected');
  });

  it('needs a session for this pubky', async () => {
    vi.mocked(MarketplaceSessionService.getActiveSession).mockReturnValue(null);
    await expect(MarketplaceConnectorsService.list(ACTOR)).rejects.toMatchObject({
      code: AuthErrorCode.SESSION_EXPIRED,
    });
    vi.mocked(MarketplaceSessionService.getActiveSession).mockReturnValue({
      token: TOKEN,
      pubky: 'z'.repeat(52),
    } as ReturnType<typeof MarketplaceSessionService.getActiveSession>);
    await expect(MarketplaceConnectorsService.list(ACTOR)).rejects.toMatchObject({ code: AuthErrorCode.FORBIDDEN });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not call the service outside the durable mode', async () => {
    config.mode = 'sandbox';
    await expect(MarketplaceConnectorsService.list(ACTOR)).rejects.toBeInstanceOf(AppError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads a service with connectors switched off as its refusal code, with no connection data', async () => {
    fetchMock.mockResolvedValue(
      json(
        { error: { code: 'connectors_disabled', message: 'Store connectors are not enabled on this deployment.' } },
        404,
      ),
    );
    const error = await MarketplaceConnectorsService.list(ACTOR).catch((caught: unknown) => caught);
    expect((error as AppError).context).toMatchObject({ reason: 'connectors_disabled', statusCode: 404 });
  });

  it('reads a service that has no connector routes as a failure with no refusal code', async () => {
    fetchMock.mockResolvedValue(new Response('Not Found', { status: 404 }));
    const error = await MarketplaceConnectorsService.list(ACTOR).catch((caught: unknown) => caught);
    expect((error as AppError).context?.statusCode).toBe(404);
    expect((error as AppError).context?.reason).toBeUndefined();
  });

  it('refuses an answer that is not the documented shape', async () => {
    fetchMock.mockResolvedValue(json({ kind: 'connector_list', connections: [{ id: 'x' }] }));
    await expect(MarketplaceConnectorsService.list(ACTOR)).rejects.toMatchObject({
      message: 'The marketplace service returned an unexpected response.',
    });
  });

  it('disconnects with DELETE and accepts 204', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await MarketplaceConnectorsService.disconnect(ACTOR, CONNECTION_ID);
    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/v1/connectors/${CONNECTION_ID}`);
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
  });

  it('pages the catalog and filters by selection', async () => {
    fetchMock.mockResolvedValue(
      json({ kind: 'connector_catalog', connection_id: CONNECTION_ID, products: [], next_page: 'p2' }),
    );
    const page = await MarketplaceConnectorsService.catalog(ACTOR, CONNECTION_ID, { page: 'p1 x', selected: true });
    expect(page.nextPage).toBe('p2');
    expect(lastCall().url).toBe(`${BASE}/v1/connectors/${CONNECTION_ID}/catalog?page=p1+x&selected=true`);
  });

  it('replaces the product selection as a whole set', async () => {
    fetchMock.mockResolvedValue(
      json({ kind: 'connector_selection', connection_id: CONNECTION_ID, product_ids: ['1', '2'] }),
    );
    expect(await MarketplaceConnectorsService.putSelection(ACTOR, CONNECTION_ID, ['2', '1'])).toEqual(['1', '2']);
    const { init } = lastCall();
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({ product_ids: ['2', '1'] });
  });

  it('writes mappings without empty optional fields', async () => {
    fetchMock.mockResolvedValue(json({ kind: 'connector_mappings', connection_id: CONNECTION_ID, mappings: [] }));
    await MarketplaceConnectorsService.putMappings(ACTOR, CONNECTION_ID, [
      { listingId: 'woo-77', variantId: 'v78', providerProductId: '77', providerVariantId: '78', sku: 'SOCK-S' },
      { listingId: 'woo-80', providerProductId: '80' },
    ]);
    expect(JSON.parse(String(lastCall().init.body))).toEqual({
      mappings: [
        {
          listing_id: 'woo-77',
          variant_id: 'v78',
          provider_product_id: '77',
          provider_variant_id: '78',
          sku: 'SOCK-S',
        },
        { listing_id: 'woo-80', provider_product_id: '80' },
      ],
    });
  });

  it('reads pushes with state and limit, and retries by order id', async () => {
    const push = {
      id: '22222222-2222-4222-8222-222222222222',
      pubky_order_id: 'order-1',
      provider: 'woocommerce',
      state: 'quarantined',
      external_id: null,
      quarantine_reason: 'unmapped_variant',
      quarantine_severity: 'action_required',
      attempts: 1,
      next_attempt_at: null,
      last_error: null,
      created_at: '2026-10-15T12:00:00.000Z',
      updated_at: '2026-10-15T12:01:00.000Z',
      actions: [],
    };
    fetchMock.mockResolvedValueOnce(
      json({ kind: 'connector_pushes', connection_id: CONNECTION_ID, pushes: [push], next_cursor: 'c2' }),
    );
    const result = await MarketplaceConnectorsService.pushes(ACTOR, CONNECTION_ID, { state: 'quarantined', limit: 20 });
    expect(result.nextCursor).toBe('c2');
    expect(result.pushes[0]?.quarantineReason).toBe('unmapped_variant');
    expect(lastCall().url).toBe(`${BASE}/v1/connectors/${CONNECTION_ID}/pushes?state=quarantined&limit=20`);

    fetchMock.mockResolvedValueOnce(json({ kind: 'connector_push', push: { ...push, state: 'sending' } }, 202));
    const retried = await MarketplaceConnectorsService.retryPush(ACTOR, CONNECTION_ID, 'order/1');
    expect(retried.state).toBe('sending');
    expect(lastCall().url).toBe(`${BASE}/v1/connectors/${CONNECTION_ID}/pushes/order%2F1/retry`);
    expect(lastCall().init.method).toBe('POST');
  });

  it('reads unresolved alerts and resolves one', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        kind: 'connector_alerts',
        alerts: [
          {
            id: 'a1',
            connection_id: CONNECTION_ID,
            kind: 'merchant_cancelled',
            pubky_order_id: 'order-1',
            detail: null,
            created_at: '2026-10-15T12:00:00.000Z',
            resolved_at: null,
          },
        ],
      }),
    );
    const alerts = await MarketplaceConnectorsService.alerts(ACTOR, { unresolved: true });
    expect(alerts[0]?.kind).toBe('merchant_cancelled');
    expect(lastCall().url).toBe(`${BASE}/v1/connectors/alerts?unresolved=true`);

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await MarketplaceConnectorsService.resolveAlert(ACTOR, 'a1');
    expect(lastCall().url).toBe(`${BASE}/v1/connectors/alerts/a1/resolve`);
  });
});
