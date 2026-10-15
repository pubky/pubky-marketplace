import {
  type ConnectionHealth,
  connectionHealth,
  type ConnectorAlert,
  type ConnectorCatalogPage,
  type ConnectorCatalogProduct,
  type ConnectorConnection,
  type ConnectorMapping,
  type ConnectorProvider,
  type ConnectorPush,
  connectorRefusalReason,
  type ConnectorUrls,
  isWooAuthorizeUrlFor,
  normalizeShopifyDomain,
  normalizeWooStoreAddress,
  shopifyConnectionUrls,
} from '@/libs/commerce/connectors';
import { isAppError } from '@/libs/error/error';
import { ServerErrorCode, ValidationErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { MarketplaceConnectorsService } from '@/services/marketplace/marketplace-connectors';

export type WooConnectStart = { connection: ConnectorConnection; authorizeUrl: string };

export type ShopifyDraft = {
  connection: ConnectorConnection;
  urls: ConnectorUrls;
};

export type ConnectionCheck = {
  connection: ConnectorConnection | null;
  health: ConnectionHealth | null;
  /** Products on the first catalog page; `null` when the test read could not run or failed. */
  productCount: number | null;
  catalogReadable: boolean;
};

export type OrderPushRow = { connection: ConnectorConnection; push: ConnectorPush };

export type StorePushOverview = {
  connections: ConnectorConnection[];
  pushes: OrderPushRow[];
  alerts: ConnectorAlert[];
};

const RECENT_PUSHES_PER_CONNECTION = 50;
const MAX_CATALOG_PAGES = 100;

function invalidInput(operation: string, message: string): never {
  throw Err.validation(ValidationErrorCode.INVALID_INPUT, message, { service: ErrorService.Marketplace, operation });
}

function secretFields(operation: string, fields: Record<string, string>): Record<string, string> {
  const trimmed: Record<string, string> = {};
  for (const [name, value] of Object.entries(fields)) {
    const next = value.trim();
    if (next === '') invalidInput(operation, 'Both keys are required.');
    trimmed[name] = next;
  }
  return trimmed;
}

function httpsOrNull(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * Store connections for a seller (WooCommerce, Shopify): connect, replace keys,
 * disconnect, read the store catalog, and read push status. Credentials are
 * handed to the service in the call that carries them and are not kept.
 */
export class ConnectorsApplication {
  private constructor() {}

  static async list(actor: string): Promise<ConnectorConnection[]> {
    return await MarketplaceConnectorsService.list(actor);
  }

  /** Starts the one-click WooCommerce authorization; the caller navigates to `authorizeUrl`. */
  static async startWooCommerce(actor: string, address: string): Promise<WooConnectStart> {
    const normalized = normalizeWooStoreAddress(address);
    if (!normalized.ok) {
      invalidInput(
        'startWooCommerce',
        normalized.reason === 'insecure'
          ? 'WooCommerce connections need a secure address that starts with https://.'
          : 'Enter your store address, for example shop.example.com.',
      );
    }
    const started = await MarketplaceConnectorsService.connect(actor, {
      provider: 'woocommerce',
      domain: normalized.domain,
    });
    const authorizeUrl = started.authorizeUrl ?? '';
    if (!isWooAuthorizeUrlFor(authorizeUrl, normalized.domain)) {
      throw Err.server(
        ServerErrorCode.INVALID_RESPONSE,
        'The marketplace service did not return a valid WooCommerce approval link.',
        {
          service: ErrorService.Marketplace,
          operation: 'startWooCommerce',
        },
      );
    }
    return { connection: started.connection, authorizeUrl };
  }

  /** Fallback for stores that block the approval screen: the seller pastes a REST key pair. */
  static async connectWooCommerceWithKeys(
    actor: string,
    input: { address: string; consumerKey: string; consumerSecret: string },
  ): Promise<ConnectorConnection> {
    const normalized = normalizeWooStoreAddress(input.address);
    if (!normalized.ok) {
      invalidInput(
        'connectWooCommerceWithKeys',
        normalized.reason === 'insecure'
          ? 'WooCommerce connections need a secure address that starts with https://.'
          : 'Enter your store address, for example shop.example.com.',
      );
    }
    const keys = secretFields('connectWooCommerceWithKeys', {
      consumerKey: input.consumerKey,
      consumerSecret: input.consumerSecret,
    });
    const started = await MarketplaceConnectorsService.connect(actor, {
      provider: 'woocommerce',
      domain: normalized.domain,
    });
    const result = await MarketplaceConnectorsService.putCredentials(actor, started.connection.id, keys);
    return result.connection ?? started.connection;
  }

  static async startShopify(actor: string, domainInput: string): Promise<ShopifyDraft> {
    const domain = normalizeShopifyDomain(domainInput);
    if (!domain) {
      invalidInput('startShopify', 'Enter your store address, for example your-store.myshopify.com.');
    }
    const started = await MarketplaceConnectorsService.connect(actor, { provider: 'shopify', domain });
    return { connection: started.connection, urls: this.draftUrls(started.connection, started.urls) };
  }

  /** The URLs to show for a draft: the service's own, else the fixed per-connection paths. */
  static draftUrls(connection: ConnectorConnection, urls?: ConnectorUrls | null): ConnectorUrls {
    return (
      urls ?? connection.urls ?? shopifyConnectionUrls(MarketplaceConnectorsService.serviceBaseUrl(), connection.id)
    );
  }

  /** Seals the Client ID and secret on the service. Returns the install link when the service sends one. */
  static async saveShopifyCredentials(
    actor: string,
    connectionId: string,
    input: { clientId: string; clientSecret: string },
  ): Promise<{ authorizeUrl: string | null }> {
    const fields = secretFields('saveShopifyCredentials', {
      clientId: input.clientId,
      clientSecret: input.clientSecret,
    });
    const result = await MarketplaceConnectorsService.putCredentials(actor, connectionId, fields);
    return { authorizeUrl: httpsOrNull(result.authorizeUrl) };
  }

  /** Overwrites the sealed pair of a live connection. */
  static async replaceCredentials(
    actor: string,
    connection: Pick<ConnectorConnection, 'id' | 'provider'>,
    input: { first: string; second: string },
  ): Promise<{ authorizeUrl: string | null }> {
    const names: Record<ConnectorProvider, [string, string]> = {
      shopify: ['clientId', 'clientSecret'],
      woocommerce: ['consumerKey', 'consumerSecret'],
    };
    const [firstName, secondName] = names[connection.provider];
    const fields = secretFields('replaceCredentials', { [firstName]: input.first, [secondName]: input.second });
    const result = await MarketplaceConnectorsService.putCredentials(actor, connection.id, fields);
    return { authorizeUrl: httpsOrNull(result.authorizeUrl) };
  }

  static async disconnect(actor: string, connectionId: string): Promise<void> {
    await MarketplaceConnectorsService.disconnect(actor, connectionId);
  }

  /**
   * The status check after connecting: re-reads the connection and does a test
   * read of the store catalog, so a bad key shows now and not at the first sale.
   */
  static async checkConnection(actor: string, connectionId: string): Promise<ConnectionCheck> {
    const connections = await MarketplaceConnectorsService.list(actor);
    const connection = connections.find((entry) => entry.id === connectionId) ?? null;
    if (!connection) return { connection: null, health: null, productCount: null, catalogReadable: false };
    const health = connectionHealth(connection);
    if (connection.status !== 'connected') {
      return { connection, health, productCount: null, catalogReadable: false };
    }
    try {
      const page = await MarketplaceConnectorsService.catalog(actor, connectionId);
      return { connection, health, productCount: page.products.length, catalogReadable: true };
    } catch (error) {
      const reason = connectorRefusalReason(error);
      if (reason === 'credentials_rejected') {
        const refreshed = (await MarketplaceConnectorsService.list(actor)).find((entry) => entry.id === connectionId);
        const next = refreshed ?? connection;
        return { connection: next, health: connectionHealth(next), productCount: null, catalogReadable: false };
      }
      return { connection, health, productCount: null, catalogReadable: false };
    }
  }

  static async catalogPage(
    actor: string,
    connectionId: string,
    options: { page?: string | null; selected?: boolean } = {},
  ): Promise<ConnectorCatalogPage> {
    return await MarketplaceConnectorsService.catalog(actor, connectionId, options);
  }

  /** Every product the seller chose to also publish, all pages, as the store describes it now. */
  static async selectedProducts(actor: string, connectionId: string): Promise<ConnectorCatalogProduct[]> {
    const products: ConnectorCatalogProduct[] = [];
    let page: string | null = null;
    for (let index = 0; index < MAX_CATALOG_PAGES; index += 1) {
      const next = await MarketplaceConnectorsService.catalog(actor, connectionId, { page, selected: true });
      products.push(...next.products.filter((product) => product.selected));
      if (!next.nextPage) return products;
      page = next.nextPage;
    }
    return products;
  }

  static async selection(actor: string, connectionId: string): Promise<string[]> {
    return await MarketplaceConnectorsService.selection(actor, connectionId);
  }

  static async saveSelection(actor: string, connectionId: string, productIds: readonly string[]): Promise<string[]> {
    return await MarketplaceConnectorsService.putSelection(actor, connectionId, [...new Set(productIds)].sort());
  }

  static async mappings(actor: string, connectionId: string): Promise<ConnectorMapping[]> {
    return await MarketplaceConnectorsService.mappings(actor, connectionId);
  }

  /**
   * Links published listings to store variants. The service replaces the whole
   * set, so this reads the current set and writes it back with the additions
   * (an addition for the same listing variant or store variant replaces the old
   * link). A listing the service does not hold (one whose publish did not
   * finish) is named in its refusal; it is left out and the rest is written, so
   * one unfinished listing never blocks the others.
   */
  static async addMappings(
    actor: string,
    connectionId: string,
    additions: readonly ConnectorMapping[],
  ): Promise<{ mappings: ConnectorMapping[]; skippedListingIds: string[] }> {
    const current = await MarketplaceConnectorsService.mappings(actor, connectionId);
    const key = (mapping: ConnectorMapping) => `${mapping.listingId}\u0000${mapping.variantId ?? ''}`;
    const providerKey = (mapping: ConnectorMapping) =>
      `${mapping.providerProductId}\u0000${mapping.providerVariantId ?? ''}`;
    let pending = [...additions];
    const skippedListingIds: string[] = [];
    for (let attempt = 0; attempt <= additions.length; attempt += 1) {
      const replacedListings = new Set(pending.map(key));
      const replacedProvider = new Set(pending.map(providerKey));
      const kept = current.filter(
        (mapping) => !replacedListings.has(key(mapping)) && !replacedProvider.has(providerKey(mapping)),
      );
      try {
        const mappings = await MarketplaceConnectorsService.putMappings(actor, connectionId, [...kept, ...pending]);
        return { mappings, skippedListingIds };
      } catch (error) {
        const listingId = isAppError(error) ? error.context?.listingId : undefined;
        if (connectorRefusalReason(error) !== 'listing_not_found' || typeof listingId !== 'string') throw error;
        if (!pending.some((mapping) => mapping.listingId === listingId)) throw error;
        skippedListingIds.push(listingId);
        pending = pending.filter((mapping) => mapping.listingId !== listingId);
      }
    }
    return { mappings: current, skippedListingIds };
  }

  /** Push state across the seller's connected stores, newest first, plus unresolved alerts. */
  static async pushOverview(actor: string): Promise<StorePushOverview> {
    const connections = (await MarketplaceConnectorsService.list(actor)).filter(
      (connection) => connection.status !== 'draft' && connection.status !== 'pending',
    );
    const [alerts, perConnection] = await Promise.all([
      MarketplaceConnectorsService.alerts(actor, { unresolved: true }),
      Promise.all(
        connections.map(async (connection) => {
          const { pushes } = await MarketplaceConnectorsService.pushes(actor, connection.id, {
            limit: RECENT_PUSHES_PER_CONNECTION,
          });
          return pushes.map((push): OrderPushRow => ({ connection, push }));
        }),
      ),
    ]);
    const pushes = perConnection.flat().sort((a, b) => b.push.updatedAt.localeCompare(a.push.updatedAt));
    return { connections, pushes, alerts };
  }

  static async retryPush(actor: string, connectionId: string, orderId: string): Promise<ConnectorPush> {
    return await MarketplaceConnectorsService.retryPush(actor, connectionId, orderId);
  }

  static async resolveAlert(actor: string, alertId: string): Promise<void> {
    await MarketplaceConnectorsService.resolveAlert(actor, alertId);
  }
}
