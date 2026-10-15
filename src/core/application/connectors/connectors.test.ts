import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ConnectorConnection,
  connectorConnectionSchema,
  type ConnectorMapping,
  connectorPushSchema,
  SHOPIFY_REQUIRED_SCOPES,
} from '@/libs/commerce/connectors';
import { AppError } from '@/libs/error/error';
import { Logger } from '@/libs/logger/logger';
import { MarketplaceConnectorsService } from '@/services/marketplace/marketplace-connectors';
import { ConnectorsApplication } from './connectors';

const ACTOR = 'y'.repeat(52);
const ID = '11111111-1111-4111-8111-111111111111';

function connection(overrides: Record<string, unknown> = {}): ConnectorConnection {
  return connectorConnectionSchema.parse({
    id: ID,
    provider: 'woocommerce',
    domain: 'dezentralshop.ch',
    status: 'connected',
    scopes: ['read_write'],
    ...overrides,
  });
}

function push(overrides: Record<string, unknown> = {}) {
  return connectorPushSchema.parse({
    id: '22222222-2222-4222-8222-222222222222',
    pubkyOrderId: 'order-1',
    provider: 'woocommerce',
    state: 'created',
    createdAt: '2026-10-15T12:00:00.000Z',
    updatedAt: '2026-10-15T12:00:00.000Z',
    ...overrides,
  });
}

describe('ConnectorsApplication', () => {
  beforeEach(() => {
    vi.spyOn(Logger, 'error').mockImplementation(() => {});
    vi.spyOn(MarketplaceConnectorsService, 'serviceBaseUrl').mockReturnValue('https://staging-api.pubky.app');
  });
  afterEach(() => vi.restoreAllMocks());

  describe('startWooCommerce', () => {
    it('sends the normalized domain and returns the store own approval link', async () => {
      const url = 'https://dezentralshop.ch/wc-auth/v1/authorize?scope=read_write&user_id=nonce';
      const connect = vi.spyOn(MarketplaceConnectorsService, 'connect').mockResolvedValue({
        kind: 'connector_connect',
        connection: connection({ status: 'pending' }),
        authorizeUrl: url,
      });

      const started = await ConnectorsApplication.startWooCommerce(ACTOR, ' https://Dezentralshop.ch/ ');

      expect(connect).toHaveBeenCalledWith(ACTOR, { provider: 'woocommerce', domain: 'dezentralshop.ch' });
      expect(started.authorizeUrl).toBe(url);
    });

    it('refuses plain http and junk before anything is sent', async () => {
      const connect = vi.spyOn(MarketplaceConnectorsService, 'connect');
      await expect(ConnectorsApplication.startWooCommerce(ACTOR, 'http://shop.example.com')).rejects.toThrow(/https/);
      await expect(ConnectorsApplication.startWooCommerce(ACTOR, 'nope')).rejects.toThrow(/store address/);
      expect(connect).not.toHaveBeenCalled();
    });

    it('refuses an approval link that leads to another site', async () => {
      vi.spyOn(MarketplaceConnectorsService, 'connect').mockResolvedValue({
        kind: 'connector_connect',
        connection: connection({ status: 'pending' }),
        authorizeUrl: 'https://evil.example/wc-auth/v1/authorize',
      });
      await expect(ConnectorsApplication.startWooCommerce(ACTOR, 'dezentralshop.ch')).rejects.toBeInstanceOf(AppError);
    });

    it('refuses a missing approval link', async () => {
      vi.spyOn(MarketplaceConnectorsService, 'connect').mockResolvedValue({
        kind: 'connector_connect',
        connection: connection({ status: 'pending' }),
        authorizeUrl: null,
      });
      await expect(ConnectorsApplication.startWooCommerce(ACTOR, 'dezentralshop.ch')).rejects.toBeInstanceOf(AppError);
    });
  });

  describe('connectWooCommerceWithKeys', () => {
    it('creates the connection, then sends the key pair', async () => {
      vi.spyOn(MarketplaceConnectorsService, 'connect').mockResolvedValue({
        kind: 'connector_connect',
        connection: connection({ status: 'pending' }),
      });
      const put = vi.spyOn(MarketplaceConnectorsService, 'putCredentials').mockResolvedValue({
        connection: connection(),
      });

      const result = await ConnectorsApplication.connectWooCommerceWithKeys(ACTOR, {
        address: 'dezentralshop.ch',
        consumerKey: ' ck_abc12345 ',
        consumerSecret: 'cs_abc12345',
      });

      expect(put).toHaveBeenCalledWith(ACTOR, ID, { consumerKey: 'ck_abc12345', consumerSecret: 'cs_abc12345' });
      expect(result.status).toBe('connected');
    });

    it('does not create anything when a key is empty', async () => {
      const connect = vi.spyOn(MarketplaceConnectorsService, 'connect');
      await expect(
        ConnectorsApplication.connectWooCommerceWithKeys(ACTOR, {
          address: 'dezentralshop.ch',
          consumerKey: 'ck_abc12345',
          consumerSecret: '   ',
        }),
      ).rejects.toThrow('Both keys are required.');
      expect(connect).not.toHaveBeenCalled();
    });
  });

  describe('Shopify draft', () => {
    it('creates a draft for the canonical domain and shows the service URLs', async () => {
      const urls = {
        appUrl: 'https://api.example/v1/connectors/shopify/c/x/launch',
        allowedRedirectionUrl: 'https://api.example/v1/connectors/shopify/c/x/oauth/callback',
        webhookUrl: null,
      };
      const connect = vi.spyOn(MarketplaceConnectorsService, 'connect').mockResolvedValue({
        kind: 'connector_connect',
        connection: connection({ provider: 'shopify', domain: 'your-store.myshopify.com', status: 'draft' }),
        urls,
      });

      const draft = await ConnectorsApplication.startShopify(ACTOR, 'Your-Store');

      expect(connect).toHaveBeenCalledWith(ACTOR, { provider: 'shopify', domain: 'your-store.myshopify.com' });
      expect(draft.urls).toEqual(urls);
    });

    it('falls back to the fixed per-connection paths when the service sends no URLs', async () => {
      vi.spyOn(MarketplaceConnectorsService, 'connect').mockResolvedValue({
        kind: 'connector_connect',
        connection: connection({ provider: 'shopify', domain: 'a.myshopify.com', status: 'draft' }),
      });

      const draft = await ConnectorsApplication.startShopify(ACTOR, 'a.myshopify.com');

      expect(draft.urls.appUrl).toBe(`https://staging-api.pubky.app/v1/connectors/shopify/c/${ID}/launch`);
      expect(draft.urls.allowedRedirectionUrl).toBe(
        `https://staging-api.pubky.app/v1/connectors/shopify/c/${ID}/oauth/callback`,
      );
    });

    it('refuses a store address that is not a myshopify.com domain', async () => {
      await expect(ConnectorsApplication.startShopify(ACTOR, 'example.com')).rejects.toThrow(
        /your-store.myshopify.com/,
      );
    });

    it('seals the keys and keeps only an https install link', async () => {
      const put = vi
        .spyOn(MarketplaceConnectorsService, 'putCredentials')
        .mockResolvedValue({ authorizeUrl: 'https://a.myshopify.com/admin/oauth/authorize?client_id=1' });
      const result = await ConnectorsApplication.saveShopifyCredentials(ACTOR, ID, {
        clientId: 'client-id-1',
        clientSecret: 'client-secret-1',
      });
      expect(put).toHaveBeenCalledWith(ACTOR, ID, { clientId: 'client-id-1', clientSecret: 'client-secret-1' });
      expect(result.authorizeUrl).toContain('/admin/oauth/authorize');

      put.mockResolvedValue({ authorizeUrl: 'http://a.myshopify.com/admin/oauth/authorize' });
      expect(
        (await ConnectorsApplication.saveShopifyCredentials(ACTOR, ID, { clientId: 'a', clientSecret: 'b' }))
          .authorizeUrl,
      ).toBeNull();
      put.mockResolvedValue({});
      expect(
        (await ConnectorsApplication.saveShopifyCredentials(ACTOR, ID, { clientId: 'a', clientSecret: 'b' }))
          .authorizeUrl,
      ).toBeNull();
    });
  });

  describe('replaceCredentials', () => {
    it.each([
      ['shopify', { clientId: 'one-value', clientSecret: 'two-value' }],
      ['woocommerce', { consumerKey: 'one-value', consumerSecret: 'two-value' }],
    ] as const)('names the %s fields', async (provider, expected) => {
      const put = vi.spyOn(MarketplaceConnectorsService, 'putCredentials').mockResolvedValue({});
      await ConnectorsApplication.replaceCredentials(
        ACTOR,
        { id: ID, provider },
        { first: 'one-value', second: 'two-value' },
      );
      expect(put).toHaveBeenCalledWith(ACTOR, ID, expected);
    });
  });

  describe('checkConnection', () => {
    it('reports a healthy store with its first catalog page', async () => {
      vi.spyOn(MarketplaceConnectorsService, 'list').mockResolvedValue([connection()]);
      vi.spyOn(MarketplaceConnectorsService, 'catalog').mockResolvedValue({
        kind: 'connector_catalog',
        connectionId: ID,
        products: [{ providerProductId: '1', title: 'A', options: [], imageUrls: [], variants: [], selected: false }],
        nextPage: null,
      });

      const check = await ConnectorsApplication.checkConnection(ACTOR, ID);

      expect(check.health?.state).toBe('connected');
      expect(check).toMatchObject({ catalogReadable: true, productCount: 1 });
    });

    it('does not read the catalog of a connection that is not finished', async () => {
      vi.spyOn(MarketplaceConnectorsService, 'list').mockResolvedValue([connection({ status: 'pending' })]);
      const catalog = vi.spyOn(MarketplaceConnectorsService, 'catalog');
      const check = await ConnectorsApplication.checkConnection(ACTOR, ID);
      expect(check.health?.state).toBe('connecting');
      expect(catalog).not.toHaveBeenCalled();
    });

    it('re-reads the connection when the store rejects the key during the test read', async () => {
      const rejected = connection({ status: 'error', lastError: { message: 'credentials_rejected' } });
      vi.spyOn(MarketplaceConnectorsService, 'list')
        .mockResolvedValueOnce([connection()])
        .mockResolvedValueOnce([rejected]);
      vi.spyOn(MarketplaceConnectorsService, 'catalog').mockRejectedValue(
        new AppError({
          category: 'client',
          code: 'CONFLICT',
          message: 'x',
          service: 'marketplace',
          operation: 'getConnectorCatalog',
          context: { reason: 'credentials_rejected' },
        } as never),
      );

      const check = await ConnectorsApplication.checkConnection(ACTOR, ID);

      expect(check.health?.state).toBe('needs_attention');
      expect(check.catalogReadable).toBe(false);
    });

    it('says nothing when the connection is gone', async () => {
      vi.spyOn(MarketplaceConnectorsService, 'list').mockResolvedValue([]);
      expect(await ConnectorsApplication.checkConnection(ACTOR, ID)).toEqual({
        connection: null,
        health: null,
        productCount: null,
        catalogReadable: false,
      });
    });

    it('requires every Shopify scope for a healthy Shopify store', async () => {
      vi.spyOn(MarketplaceConnectorsService, 'list').mockResolvedValue([
        connection({ provider: 'shopify', scopes: [...SHOPIFY_REQUIRED_SCOPES].slice(0, 3) }),
      ]);
      vi.spyOn(MarketplaceConnectorsService, 'catalog').mockResolvedValue({
        kind: 'connector_catalog',
        connectionId: ID,
        products: [],
        nextPage: null,
      });
      const check = await ConnectorsApplication.checkConnection(ACTOR, ID);
      expect(check.health?.missingScopes).toEqual(['read_fulfillments', 'write_orders']);
    });
  });

  describe('selection and mappings', () => {
    it('saves a sorted, de-duplicated selection', async () => {
      const put = vi.spyOn(MarketplaceConnectorsService, 'putSelection').mockResolvedValue(['1', '2']);
      await ConnectorsApplication.saveSelection(ACTOR, ID, ['2', '1', '2']);
      expect(put).toHaveBeenCalledWith(ACTOR, ID, ['1', '2']);
    });

    it('adds mappings to the current set and replaces a link for the same listing variant or store variant', async () => {
      const current: ConnectorMapping[] = [
        { listingId: 'woo-1', variantId: 'a', providerProductId: '1', providerVariantId: '10' },
        { listingId: 'woo-2', variantId: 'a', providerProductId: '2', providerVariantId: '20' },
        { listingId: 'woo-9', variantId: 'z', providerProductId: '9', providerVariantId: '90' },
      ];
      vi.spyOn(MarketplaceConnectorsService, 'mappings').mockResolvedValue(current);
      const put = vi.spyOn(MarketplaceConnectorsService, 'putMappings').mockResolvedValue([]);

      await ConnectorsApplication.addMappings(ACTOR, ID, [
        { listingId: 'woo-1', variantId: 'a', providerProductId: '1', providerVariantId: '11' },
        { listingId: 'woo-3', variantId: 'q', providerProductId: '2', providerVariantId: '20' },
      ]);

      expect(put).toHaveBeenCalledWith(ACTOR, ID, [
        { listingId: 'woo-9', variantId: 'z', providerProductId: '9', providerVariantId: '90' },
        { listingId: 'woo-1', variantId: 'a', providerProductId: '1', providerVariantId: '11' },
        { listingId: 'woo-3', variantId: 'q', providerProductId: '2', providerVariantId: '20' },
      ]);
    });
  });

  describe('pushOverview', () => {
    it('merges pushes of every finished connection, newest first, with unresolved alerts', async () => {
      const second = connection({ id: '33333333-3333-4333-8333-333333333333', domain: 'other.example' });
      vi.spyOn(MarketplaceConnectorsService, 'list').mockResolvedValue([
        connection(),
        second,
        connection({ id: '44444444-4444-4444-8444-444444444444', status: 'draft' }),
      ]);
      const pushes = vi.spyOn(MarketplaceConnectorsService, 'pushes').mockImplementation(async (_actor, id) => ({
        pushes:
          id === ID
            ? [push({ id: 'p-old', pubkyOrderId: 'o-old', updatedAt: '2026-10-15T10:00:00.000Z' })]
            : [push({ id: 'p-new', pubkyOrderId: 'o-new', updatedAt: '2026-10-15T11:00:00.000Z' })],
        nextCursor: null,
      }));
      const alerts = vi.spyOn(MarketplaceConnectorsService, 'alerts').mockResolvedValue([]);

      const overview = await ConnectorsApplication.pushOverview(ACTOR);

      expect(pushes).toHaveBeenCalledTimes(2);
      expect(alerts).toHaveBeenCalledWith(ACTOR, { unresolved: true });
      expect(overview.pushes.map((row) => row.push.id)).toEqual(['p-new', 'p-old']);
      expect(overview.pushes[0]?.connection.domain).toBe('other.example');
    });
  });
});
