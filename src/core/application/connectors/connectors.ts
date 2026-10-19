import {
  type ConnectionHealth,
  connectionHealth,
  type ConnectorAlert,
  type ConnectorCatalogPage,
  type ConnectorCatalogProduct,
  type ConnectorCheck,
  type ConnectorConnection,
  type ConnectorMapping,
  type ConnectorProvider,
  type ConnectorPush,
  connectorRefusalReason,
  type ConnectorUnmappedListing,
  isWooAuthorizeUrlFor,
  normalizeShopifyDomain,
  normalizeWooStoreAddress,
  type VariantMode,
} from '@/libs/commerce/connectors';
import { isAppError } from '@/libs/error/error';
import { ServerErrorCode, ValidationErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import {
  type LinkableListing,
  type ListingLinkSuggestion,
  planListingLinks,
  type UnlinkedListing,
} from '@/pipes/commerce/connector-listing-links';
import { MarketplaceConnectorsService } from '@/services/marketplace/marketplace-connectors';

export type WooConnectStart = { connection: ConnectorConnection; authorizeUrl: string };

export type ConnectionCheck = {
  connection: ConnectorConnection | null;
  health: ConnectionHealth | null;
  /** Products on the first catalog page; `null` when the test read could not run or failed. */
  productCount: number | null;
  catalogReadable: boolean;
  /** The store's own answer (`GET /check`); `null` for a store type with no check (WooCommerce today). */
  store: Pick<ConnectorCheck, 'shopName' | 'grantedScopes' | 'locationCount'> | null;
};

export type OrderPushRow = { connection: ConnectorConnection; push: ConnectorPush };

export type ListingLinkResult = {
  /** Listings linked in this call, without guessing (SKU or handle). */
  linked: ListingLinkSuggestion[];
  /** Listings still not linked to a product of this store, for the seller to match or leave Pubky-only. */
  unlinked: UnlinkedListing[];
  /** The store's whole catalog, for matching by hand. */
  products: ConnectorCatalogProduct[];
  /** Orders that were not sent for want of a link and were sent again. */
  resent: number;
};

/** The quarantine reason of a paid order none of whose listings is linked to the store. */
export const NOT_LINKED_PUSH_REASON = 'no_mapped_lines';

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
    try {
      return await MarketplaceConnectorsService.putCredentials(actor, started.connection.id, keys);
    } catch (error) {
      // A refused attempt must not leave a draft taking one of the seller's connection slots.
      await MarketplaceConnectorsService.disconnect(actor, started.connection.id).catch(() => undefined);
      throw error;
    }
  }

  /** The draft connection for a store; its `urls` are the ones the merchant pastes into their app. */
  static async startShopify(actor: string, domainInput: string): Promise<ConnectorConnection> {
    const domain = normalizeShopifyDomain(domainInput);
    if (!domain) {
      invalidInput('startShopify', 'Enter your store address, for example your-store.myshopify.com.');
    }
    const started = await MarketplaceConnectorsService.connect(actor, { provider: 'shopify', domain });
    return started.connection;
  }

  /** Seals the Client ID and secret on the service; the answer is the connection with `credentialsSaved`. */
  static async saveShopifyCredentials(
    actor: string,
    connectionId: string,
    input: { clientId: string; clientSecret: string },
  ): Promise<ConnectorConnection> {
    const fields = secretFields('saveShopifyCredentials', {
      clientId: input.clientId,
      clientSecret: input.clientSecret,
    });
    return await MarketplaceConnectorsService.putCredentials(actor, connectionId, fields);
  }

  /** Overwrites the sealed pair of a live connection. */
  static async replaceCredentials(
    actor: string,
    connection: Pick<ConnectorConnection, 'id' | 'provider'>,
    input: { first: string; second: string },
  ): Promise<ConnectorConnection> {
    const names: Record<ConnectorProvider, [string, string]> = {
      shopify: ['clientId', 'clientSecret'],
      woocommerce: ['consumerKey', 'consumerSecret'],
    };
    const [firstName, secondName] = names[connection.provider];
    const fields = secretFields('replaceCredentials', { [firstName]: input.first, [secondName]: input.second });
    return await MarketplaceConnectorsService.putCredentials(actor, connection.id, fields);
  }

  /**
   * `native` keeps a product's variants together as one listing; `split` makes
   * each variant its own listing and unlinks the listings that combined several.
   */
  static async saveVariantMode(
    actor: string,
    connectionId: string,
    variantMode: VariantMode,
  ): Promise<{ connection: ConnectorConnection; unmappedListings: ConnectorUnmappedListing[] }> {
    const { connection, unmappedListings } = await MarketplaceConnectorsService.putSettings(actor, connectionId, {
      variantMode,
    });
    return { connection, unmappedListings };
  }

  static async disconnect(actor: string, connectionId: string): Promise<void> {
    await MarketplaceConnectorsService.disconnect(actor, connectionId);
  }

  /**
   * The status check after connecting: re-reads the connection, asks the
   * service to look at the store (`GET /check`: its name, granted scopes,
   * locations) and does a test read of the catalog, so a bad key shows now and
   * not at the first sale. A store type with no check answers
   * `422 invalid_request`; the catalog read still runs.
   */
  static async checkConnection(actor: string, connectionId: string): Promise<ConnectionCheck> {
    const connections = await MarketplaceConnectorsService.list(actor);
    const connection = connections.find((entry) => entry.id === connectionId) ?? null;
    if (!connection) {
      return { connection: null, health: null, productCount: null, catalogReadable: false, store: null };
    }
    if (connection.status === 'draft') {
      return {
        connection,
        health: connectionHealth(connection),
        productCount: null,
        catalogReadable: false,
        store: null,
      };
    }
    const rejected = async (): Promise<ConnectionCheck> => {
      const refreshed = (await MarketplaceConnectorsService.list(actor)).find((entry) => entry.id === connectionId);
      const next = refreshed ?? connection;
      return {
        connection: next,
        health: connectionHealth(next),
        productCount: null,
        catalogReadable: false,
        store: null,
      };
    };
    let store: ConnectionCheck['store'] = null;
    let fresh: ConnectorCheck | null = null;
    try {
      fresh = await MarketplaceConnectorsService.check(actor, connectionId);
      store = { shopName: fresh.shopName, grantedScopes: fresh.grantedScopes, locationCount: fresh.locationCount };
    } catch (error) {
      const reason = connectorRefusalReason(error);
      if (reason === 'credentials_rejected') return await rejected();
      if (reason !== 'invalid_request' && reason !== 'connection_not_connected') {
        return {
          connection,
          health: connectionHealth(connection),
          productCount: null,
          catalogReadable: false,
          store: null,
        };
      }
    }
    const health = connectionHealth(connection);
    if (fresh && fresh.missingScopes.length > 0 && health.state !== 'needs_attention') {
      health.state = 'needs_attention';
      health.missingScopes = fresh.missingScopes;
      health.reasons.unshift(
        `Missing permissions: ${fresh.missingScopes.join(', ')}. Add them to the app and install it again.`,
      );
    }
    try {
      const page = await MarketplaceConnectorsService.catalog(actor, connectionId);
      return { connection, health, productCount: page.products.length, catalogReadable: true, store };
    } catch (error) {
      if (connectorRefusalReason(error) === 'credentials_rejected') return await rejected();
      return { connection, health, productCount: null, catalogReadable: false, store };
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

  /** Every product in the store's catalog, all pages. */
  static async allProducts(actor: string, connectionId: string): Promise<ConnectorCatalogProduct[]> {
    const products: ConnectorCatalogProduct[] = [];
    let page: string | null = null;
    for (let index = 0; index < MAX_CATALOG_PAGES; index += 1) {
      const next = await MarketplaceConnectorsService.catalog(actor, connectionId, { page });
      products.push(...next.products);
      if (!next.nextPage) return products;
      page = next.nextPage;
    }
    return products;
  }

  /**
   * Links the seller's own listings (made by hand or imported from a CSV) to
   * the store products they match without guessing (by SKU, or by a Shopify
   * handle and the variants' options), then sends again the orders that were
   * not sent to the store because nothing was linked. Linking is idempotent:
   * a listing already linked is left alone.
   */
  static async autoLinkListings(
    actor: string,
    connection: Pick<ConnectorConnection, 'id' | 'variantMode'>,
    listings: readonly LinkableListing[],
  ): Promise<ListingLinkResult> {
    const [products, mappings] = await Promise.all([
      this.allProducts(actor, connection.id),
      MarketplaceConnectorsService.mappings(actor, connection.id),
    ]);
    const plan = planListingLinks({ listings, products, mappings, variantMode: connection.variantMode });
    if (plan.suggestions.length === 0) {
      return { linked: [], unlinked: [...plan.unlinked], products, resent: 0 };
    }
    const { skippedListingIds } = await this.addMappings(
      actor,
      connection.id,
      plan.suggestions.flatMap((suggestion) => suggestion.mappings),
    );
    const skipped = new Set(skippedListingIds);
    const linked = plan.suggestions.filter((suggestion) => !skipped.has(suggestion.listingId));
    const resent = linked.length > 0 ? await this.resendNotLinkedPushes(actor, connection.id) : 0;
    return { linked, unlinked: [...plan.unlinked], products, resent };
  }

  /**
   * {@link autoLinkListings} for every live store of the seller, after they
   * published listings outside a store import (a CSV import, a listing made
   * by hand). A store that could not be checked is reported, not skipped.
   */
  static async autoLinkAcrossStores(
    actor: string,
    listings: readonly LinkableListing[],
  ): Promise<{ linked: number; resent: number; failedStores: ConnectorConnection[] }> {
    const live = (await MarketplaceConnectorsService.list(actor)).filter(
      (connection) => connection.status === 'connected' || connection.status === 'needs_attention',
    );
    let linked = 0;
    let resent = 0;
    const failedStores: ConnectorConnection[] = [];
    for (const connection of live) {
      try {
        const result = await this.autoLinkListings(actor, connection, listings);
        linked += result.linked.length;
        resent += result.resent;
      } catch {
        failedStores.push(connection);
      }
    }
    return { linked, resent, failedStores };
  }

  /** Links one listing the seller matched by hand, then sends again the orders that were waiting for a link. */
  static async linkListing(
    actor: string,
    connectionId: string,
    mappings: readonly ConnectorMapping[],
  ): Promise<{ linked: boolean; resent: number }> {
    if (mappings.length === 0) invalidInput('linkListing', 'Choose the store product for each variant.');
    const { skippedListingIds } = await this.addMappings(actor, connectionId, mappings);
    const linked = !mappings.some((mapping) => skippedListingIds.includes(mapping.listingId));
    return { linked, resent: linked ? await this.resendNotLinkedPushes(actor, connectionId) : 0 };
  }

  /**
   * Retries the store pushes set aside because none of the order's listings
   * was linked. A push whose order is still not linked (a Pubky-only sale) is
   * set aside again by the service, with no second alert.
   */
  static async resendNotLinkedPushes(actor: string, connectionId: string): Promise<number> {
    const { pushes } = await MarketplaceConnectorsService.pushes(actor, connectionId, {
      state: 'quarantined',
      limit: RECENT_PUSHES_PER_CONNECTION,
    });
    let resent = 0;
    for (const push of pushes) {
      if (push.state !== 'quarantined' || push.quarantineReason !== NOT_LINKED_PUSH_REASON) continue;
      await MarketplaceConnectorsService.retryPush(actor, connectionId, push.pubkyOrderId);
      resent += 1;
    }
    return resent;
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
      (connection) => connection.status !== 'draft',
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

  /** Unresolved alerts across the seller's connections. */
  static async alerts(actor: string): Promise<ConnectorAlert[]> {
    return await MarketplaceConnectorsService.alerts(actor, { unresolved: true });
  }

  static async resolveAlert(actor: string, alertId: string): Promise<void> {
    await MarketplaceConnectorsService.resolveAlert(actor, alertId);
  }
}
