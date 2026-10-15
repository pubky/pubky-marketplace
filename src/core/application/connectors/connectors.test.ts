import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ConnectorConnection,
  type ConnectorMapping,
  connectorPushSchema,
  SHOPIFY_REQUIRED_SCOPES,
} from '@/libs/commerce/connectors';
import { AppError } from '@/libs/error/error';
import { Logger } from '@/libs/logger/logger';
import { MarketplaceConnectorsService } from '@/services/marketplace/marketplace-connectors';
import { connectorRefusal } from '@/test-utils/connector-errors';
import { connectionFixture } from '@/test-utils/connector-fixtures';
import { ConnectorsApplication } from './connectors';

const ACTOR = 'y'.repeat(52);
const ID = '11111111-1111-4111-8111-111111111111';

function connection(overrides: Record<string, unknown> = {}): ConnectorConnection {
  return connectionFixture({
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
  });
  afterEach(() => vi.restoreAllMocks());

  describe('startWooCommerce', () => {
    it('sends the normalized domain and returns the store own approval link', async () => {
      const url = 'https://dezentralshop.ch/wc-auth/v1/authorize?scope=read_write&user_id=nonce';
      const connect = vi.spyOn(MarketplaceConnectorsService, 'connect').mockResolvedValue({
        kind: 'connector_connect',
        connection: connection({ status: 'draft' }),
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
        connection: connection({ status: 'draft' }),
        authorizeUrl: 'https://evil.example/wc-auth/v1/authorize',
      });
      await expect(ConnectorsApplication.startWooCommerce(ACTOR, 'dezentralshop.ch')).rejects.toBeInstanceOf(AppError);
    });

    it('refuses a missing approval link', async () => {
      vi.spyOn(MarketplaceConnectorsService, 'connect').mockResolvedValue({
        kind: 'connector_connect',
        connection: connection({ status: 'draft' }),
        authorizeUrl: null,
      });
      await expect(ConnectorsApplication.startWooCommerce(ACTOR, 'dezentralshop.ch')).rejects.toBeInstanceOf(AppError);
    });
  });

  describe('connectWooCommerceWithKeys', () => {
    it('creates the connection, then sends the key pair', async () => {
      vi.spyOn(MarketplaceConnectorsService, 'connect').mockResolvedValue({
        kind: 'connector_connect',
        connection: connection({ status: 'draft' }),
        authorizeUrl: null,
      });
      const put = vi.spyOn(MarketplaceConnectorsService, 'putCredentials').mockResolvedValue(connection());

      const result = await ConnectorsApplication.connectWooCommerceWithKeys(ACTOR, {
        address: 'dezentralshop.ch',
        consumerKey: ' ck_abc12345 ',
        consumerSecret: 'cs_abc12345',
      });

      expect(put).toHaveBeenCalledWith(ACTOR, ID, { consumerKey: 'ck_abc12345', consumerSecret: 'cs_abc12345' });
      expect(result.status).toBe('connected');
    });

    it('deletes the draft it created when the service refuses the keys, and reports the refusal', async () => {
      vi.spyOn(MarketplaceConnectorsService, 'connect').mockResolvedValue({
        kind: 'connector_connect',
        connection: connection({ status: 'draft' }),
        authorizeUrl: null,
      });
      vi.spyOn(MarketplaceConnectorsService, 'putCredentials').mockRejectedValue(
        connectorRefusal('credentials_not_supported', 422),
      );
      const disconnect = vi.spyOn(MarketplaceConnectorsService, 'disconnect').mockResolvedValue();

      const error = await ConnectorsApplication.connectWooCommerceWithKeys(ACTOR, {
        address: 'dezentralshop.ch',
        consumerKey: 'ck_abc12345',
        consumerSecret: 'cs_abc12345',
      }).catch((caught: unknown) => caught);

      expect(disconnect).toHaveBeenCalledWith(ACTOR, ID);
      expect((error as AppError).context).toMatchObject({ reason: 'credentials_not_supported' });
    });

    it('reports the refusal even when the draft cannot be deleted', async () => {
      vi.spyOn(MarketplaceConnectorsService, 'connect').mockResolvedValue({
        kind: 'connector_connect',
        connection: connection({ status: 'draft' }),
        authorizeUrl: null,
      });
      vi.spyOn(MarketplaceConnectorsService, 'putCredentials').mockRejectedValue(
        connectorRefusal('credentials_rejected', 422),
      );
      vi.spyOn(MarketplaceConnectorsService, 'disconnect').mockRejectedValue(
        connectorRefusal('connection_not_found', 404),
      );

      const error = await ConnectorsApplication.connectWooCommerceWithKeys(ACTOR, {
        address: 'dezentralshop.ch',
        consumerKey: 'ck_abc12345',
        consumerSecret: 'cs_abc12345',
      }).catch((caught: unknown) => caught);

      expect((error as AppError).context).toMatchObject({ reason: 'credentials_rejected' });
    });

    it('does not delete anything when the keys are saved', async () => {
      vi.spyOn(MarketplaceConnectorsService, 'connect').mockResolvedValue({
        kind: 'connector_connect',
        connection: connection({ status: 'draft' }),
        authorizeUrl: null,
      });
      vi.spyOn(MarketplaceConnectorsService, 'putCredentials').mockResolvedValue(connection());
      const disconnect = vi.spyOn(MarketplaceConnectorsService, 'disconnect').mockResolvedValue();
      await ConnectorsApplication.connectWooCommerceWithKeys(ACTOR, {
        address: 'dezentralshop.ch',
        consumerKey: 'ck_abc12345',
        consumerSecret: 'cs_abc12345',
      });
      expect(disconnect).not.toHaveBeenCalled();
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
    it('creates a draft for the canonical domain and returns the connection with the URLs the service built', async () => {
      const draft = connection({ provider: 'shopify', domain: 'your-store.myshopify.com', status: 'draft' });
      const connect = vi.spyOn(MarketplaceConnectorsService, 'connect').mockResolvedValue({
        kind: 'connector_connect',
        connection: draft,
        authorizeUrl: null,
      });

      const created = await ConnectorsApplication.startShopify(ACTOR, 'Your-Store');

      expect(connect).toHaveBeenCalledWith(ACTOR, { provider: 'shopify', domain: 'your-store.myshopify.com' });
      expect(created.urls.launch).toContain('/v1/connectors/shopify/c/');
      expect(created.urls).toEqual(draft.urls);
    });

    it('refuses a store address that is not a myshopify.com domain', async () => {
      await expect(ConnectorsApplication.startShopify(ACTOR, 'example.com')).rejects.toThrow(
        /your-store.myshopify.com/,
      );
    });

    it('seals the keys and returns the connection with credentials saved', async () => {
      const saved = connection({ provider: 'shopify', status: 'draft', credentialsSaved: true });
      const put = vi.spyOn(MarketplaceConnectorsService, 'putCredentials').mockResolvedValue(saved);
      const result = await ConnectorsApplication.saveShopifyCredentials(ACTOR, ID, {
        clientId: ' client-id-1 ',
        clientSecret: 'client-secret-1',
      });
      expect(put).toHaveBeenCalledWith(ACTOR, ID, { clientId: 'client-id-1', clientSecret: 'client-secret-1' });
      expect(result.credentialsSaved).toBe(true);
    });

    it('does not send an empty key', async () => {
      const put = vi.spyOn(MarketplaceConnectorsService, 'putCredentials');
      await expect(
        ConnectorsApplication.saveShopifyCredentials(ACTOR, ID, { clientId: 'a', clientSecret: '  ' }),
      ).rejects.toThrow('Both keys are required.');
      expect(put).not.toHaveBeenCalled();
    });
  });

  describe('replaceCredentials', () => {
    it.each([
      ['shopify', { clientId: 'one-value', clientSecret: 'two-value' }],
      ['woocommerce', { consumerKey: 'one-value', consumerSecret: 'two-value' }],
    ] as const)('names the %s fields', async (provider, expected) => {
      const put = vi.spyOn(MarketplaceConnectorsService, 'putCredentials').mockResolvedValue(connection());
      await ConnectorsApplication.replaceCredentials(
        ACTOR,
        { id: ID, provider },
        { first: 'one-value', second: 'two-value' },
      );
      expect(put).toHaveBeenCalledWith(ACTOR, ID, expected);
    });
  });

  describe('saveVariantMode', () => {
    it('sends the setting and returns the updated connection', async () => {
      const put = vi
        .spyOn(MarketplaceConnectorsService, 'putSettings')
        .mockResolvedValue(connection({ variantMode: 'split' }));
      const updated = await ConnectorsApplication.saveVariantMode(ACTOR, ID, 'split');
      expect(put).toHaveBeenCalledWith(ACTOR, ID, { variantMode: 'split' });
      expect(updated.variantMode).toBe('split');
    });
  });

  describe('checkConnection', () => {
    const page = {
      kind: 'connector_catalog' as const,
      connectionId: ID,
      products: [{ providerProductId: '1', title: 'A', options: [], imageUrls: [], variants: [], selected: false }],
      nextPage: null,
    };
    const shopCheck = {
      kind: 'connector_check' as const,
      connectionId: ID,
      shopName: 'Your Store',
      grantedScopes: [...SHOPIFY_REQUIRED_SCOPES],
      missingScopes: [],
      locationCount: 2,
      catalogReadable: true,
    };

    it('asks the store for its name, scopes and locations, and reads the first catalog page', async () => {
      vi.spyOn(MarketplaceConnectorsService, 'list').mockResolvedValue([connection({ provider: 'shopify' })]);
      vi.spyOn(MarketplaceConnectorsService, 'check').mockResolvedValue(shopCheck);
      vi.spyOn(MarketplaceConnectorsService, 'catalog').mockResolvedValue(page);

      const check = await ConnectorsApplication.checkConnection(ACTOR, ID);

      expect(check.health?.state).toBe('connected');
      expect(check).toMatchObject({
        catalogReadable: true,
        productCount: 1,
        store: { shopName: 'Your Store', locationCount: 2 },
      });
    });

    it('still reads the catalog for a store type that has no check yet', async () => {
      vi.spyOn(MarketplaceConnectorsService, 'list').mockResolvedValue([connection()]);
      vi.spyOn(MarketplaceConnectorsService, 'check').mockRejectedValue(connectorRefusal('invalid_request', 422));
      vi.spyOn(MarketplaceConnectorsService, 'catalog').mockResolvedValue(page);

      const check = await ConnectorsApplication.checkConnection(ACTOR, ID);

      expect(check).toMatchObject({ catalogReadable: true, productCount: 1, store: null });
      expect(check.health?.state).toBe('connected');
    });

    it('does not look at the store while the connection is a draft', async () => {
      vi.spyOn(MarketplaceConnectorsService, 'list').mockResolvedValue([connection({ status: 'draft' })]);
      const checkRoute = vi.spyOn(MarketplaceConnectorsService, 'check');
      const catalog = vi.spyOn(MarketplaceConnectorsService, 'catalog');
      const check = await ConnectorsApplication.checkConnection(ACTOR, ID);
      expect(check.health?.state).toBe('connecting');
      expect(checkRoute).not.toHaveBeenCalled();
      expect(catalog).not.toHaveBeenCalled();
    });

    it('names a missing permission the store reports even when the list still says connected', async () => {
      vi.spyOn(MarketplaceConnectorsService, 'list').mockResolvedValue([connection({ provider: 'shopify' })]);
      vi.spyOn(MarketplaceConnectorsService, 'check').mockResolvedValue({
        ...shopCheck,
        grantedScopes: ['read_products'],
        missingScopes: ['write_orders'],
      });
      vi.spyOn(MarketplaceConnectorsService, 'catalog').mockResolvedValue(page);

      const check = await ConnectorsApplication.checkConnection(ACTOR, ID);

      expect(check.health).toMatchObject({ state: 'needs_attention', missingScopes: ['write_orders'] });
      expect(check.health?.reasons[0]).toContain('Missing permissions: write_orders');
    });

    it('shows a connection that needs attention as the service lists it', async () => {
      vi.spyOn(MarketplaceConnectorsService, 'list').mockResolvedValue([
        connection({
          provider: 'shopify',
          status: 'needs_attention',
          scopes: ['read_products'],
          missingScopes: ['read_inventory', 'write_orders'],
        }),
      ]);
      vi.spyOn(MarketplaceConnectorsService, 'check').mockResolvedValue({
        ...shopCheck,
        missingScopes: ['read_inventory', 'write_orders'],
      });
      vi.spyOn(MarketplaceConnectorsService, 'catalog').mockResolvedValue(page);

      const check = await ConnectorsApplication.checkConnection(ACTOR, ID);

      expect(check.health?.missingScopes).toEqual(['read_inventory', 'write_orders']);
    });

    it('re-reads the connection when the store rejects the key during the check', async () => {
      const rejected = connection({ status: 'error', lastError: { message: 'credentials_rejected' } });
      vi.spyOn(MarketplaceConnectorsService, 'list')
        .mockResolvedValueOnce([connection({ provider: 'shopify' })])
        .mockResolvedValueOnce([rejected]);
      vi.spyOn(MarketplaceConnectorsService, 'check').mockRejectedValue(connectorRefusal('credentials_rejected'));

      const check = await ConnectorsApplication.checkConnection(ACTOR, ID);

      expect(check.health?.state).toBe('needs_attention');
      expect(check.catalogReadable).toBe(false);
    });

    it('re-reads the connection when only the catalog read is rejected', async () => {
      const rejected = connection({ status: 'error', lastError: { message: 'credentials_rejected' } });
      vi.spyOn(MarketplaceConnectorsService, 'list')
        .mockResolvedValueOnce([connection()])
        .mockResolvedValueOnce([rejected]);
      vi.spyOn(MarketplaceConnectorsService, 'check').mockRejectedValue(connectorRefusal('invalid_request', 422));
      vi.spyOn(MarketplaceConnectorsService, 'catalog').mockRejectedValue(connectorRefusal('credentials_rejected'));

      const check = await ConnectorsApplication.checkConnection(ACTOR, ID);

      expect(check.health?.state).toBe('needs_attention');
    });

    it('says nothing when the connection is gone', async () => {
      vi.spyOn(MarketplaceConnectorsService, 'list').mockResolvedValue([]);
      expect(await ConnectorsApplication.checkConnection(ACTOR, ID)).toEqual({
        connection: null,
        health: null,
        productCount: null,
        catalogReadable: false,
        store: null,
      });
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

      const result = await ConnectorsApplication.addMappings(ACTOR, ID, [
        { listingId: 'woo-1', variantId: 'a', providerProductId: '1', providerVariantId: '11' },
        { listingId: 'woo-3', variantId: 'q', providerProductId: '2', providerVariantId: '20' },
      ]);

      expect(put).toHaveBeenCalledWith(ACTOR, ID, [
        { listingId: 'woo-9', variantId: 'z', providerProductId: '9', providerVariantId: '90' },
        { listingId: 'woo-1', variantId: 'a', providerProductId: '1', providerVariantId: '11' },
        { listingId: 'woo-3', variantId: 'q', providerProductId: '2', providerVariantId: '20' },
      ]);
      expect(result.skippedListingIds).toEqual([]);
    });

    it('leaves out a listing the service does not hold and writes the rest', async () => {
      const kept: ConnectorMapping = {
        listingId: 'woo-9',
        variantId: 'z',
        providerProductId: '9',
        providerVariantId: '90',
      };
      vi.spyOn(MarketplaceConnectorsService, 'mappings').mockResolvedValue([kept]);
      const put = vi
        .spyOn(MarketplaceConnectorsService, 'putMappings')
        .mockRejectedValueOnce(connectorRefusal('listing_not_found', 422, { listingId: 'woo-2' }))
        .mockResolvedValueOnce([]);

      const result = await ConnectorsApplication.addMappings(ACTOR, ID, [
        { listingId: 'woo-1', variantId: 'a', providerProductId: '1', providerVariantId: '10' },
        { listingId: 'woo-2', variantId: 'a', providerProductId: '2', providerVariantId: '20' },
        { listingId: 'woo-2', variantId: 'b', providerProductId: '2', providerVariantId: '21' },
      ]);

      expect(result.skippedListingIds).toEqual(['woo-2']);
      expect(put).toHaveBeenCalledTimes(2);
      expect(put).toHaveBeenLastCalledWith(ACTOR, ID, [
        kept,
        { listingId: 'woo-1', variantId: 'a', providerProductId: '1', providerVariantId: '10' },
      ]);
    });

    it('passes on any other refusal', async () => {
      vi.spyOn(MarketplaceConnectorsService, 'mappings').mockResolvedValue([]);
      vi.spyOn(MarketplaceConnectorsService, 'putMappings').mockRejectedValue(
        connectorRefusal('mapping_conflict', 409),
      );
      await expect(
        ConnectorsApplication.addMappings(ACTOR, ID, [
          { listingId: 'woo-1', variantId: 'a', providerProductId: '1', providerVariantId: '10' },
        ]),
      ).rejects.toMatchObject({ context: { reason: 'mapping_conflict' } });
    });

    it('reads every page of the chosen products', async () => {
      const page = (id: string, nextPage: string | null) => ({
        kind: 'connector_catalog' as const,
        connectionId: ID,
        products: [
          { providerProductId: id, title: id, options: [], imageUrls: [], variants: [], selected: true },
          { providerProductId: `${id}-other`, title: 'x', options: [], imageUrls: [], variants: [], selected: false },
        ],
        nextPage,
      });
      const catalog = vi
        .spyOn(MarketplaceConnectorsService, 'catalog')
        .mockResolvedValueOnce(page('1', 'p2'))
        .mockResolvedValueOnce(page('2', null));

      const products = await ConnectorsApplication.selectedProducts(ACTOR, ID);

      expect(products.map((product) => product.providerProductId)).toEqual(['1', '2']);
      expect(catalog).toHaveBeenNthCalledWith(1, ACTOR, ID, { page: null, selected: true });
      expect(catalog).toHaveBeenNthCalledWith(2, ACTOR, ID, { page: 'p2', selected: true });
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
