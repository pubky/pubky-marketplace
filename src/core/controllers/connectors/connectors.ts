import { ConnectorsApplication } from '@/application/connectors/connectors';
import type { ConnectorConnection, ConnectorMapping, VariantMode } from '@/libs/commerce/connectors';
import type { LinkableListing } from '@/pipes/commerce/connector-listing-links';
import { useAuthStore } from '@/stores/auth/auth.store';

/** Store connections (WooCommerce, Shopify) for the signed-in seller. */
export class ConnectorsController {
  private constructor() {}

  private static actor(): string {
    return useAuthStore.getState().selectCurrentUserPubky();
  }

  static async fetchConnections() {
    return await ConnectorsApplication.list(this.actor());
  }

  static async commitConnectWooCommerce(address: string) {
    return await ConnectorsApplication.startWooCommerce(this.actor(), address);
  }

  static async commitConnectWooCommerceWithKeys(input: {
    address: string;
    consumerKey: string;
    consumerSecret: string;
  }) {
    return await ConnectorsApplication.connectWooCommerceWithKeys(this.actor(), input);
  }

  static async commitCreateShopifyDraft(domain: string) {
    return await ConnectorsApplication.startShopify(this.actor(), domain);
  }

  static async commitShopifyCredentials(connectionId: string, input: { clientId: string; clientSecret: string }) {
    return await ConnectorsApplication.saveShopifyCredentials(this.actor(), connectionId, input);
  }

  static async commitReplaceCredentials(
    connection: Parameters<typeof ConnectorsApplication.replaceCredentials>[1],
    input: { first: string; second: string },
  ) {
    return await ConnectorsApplication.replaceCredentials(this.actor(), connection, input);
  }

  static async commitVariantMode(connectionId: string, variantMode: VariantMode) {
    return await ConnectorsApplication.saveVariantMode(this.actor(), connectionId, variantMode);
  }

  static async commitDisconnect(connectionId: string) {
    await ConnectorsApplication.disconnect(this.actor(), connectionId);
  }

  static async fetchConnectionCheck(connectionId: string) {
    return await ConnectorsApplication.checkConnection(this.actor(), connectionId);
  }

  static async fetchCatalogPage(connectionId: string, options: { page?: string | null; selected?: boolean } = {}) {
    return await ConnectorsApplication.catalogPage(this.actor(), connectionId, options);
  }

  static async fetchSelectedProducts(connectionId: string) {
    return await ConnectorsApplication.selectedProducts(this.actor(), connectionId);
  }

  static async fetchSelection(connectionId: string) {
    return await ConnectorsApplication.selection(this.actor(), connectionId);
  }

  static async commitSelection(connectionId: string, productIds: readonly string[]) {
    return await ConnectorsApplication.saveSelection(this.actor(), connectionId, productIds);
  }

  static async fetchMappings(connectionId: string) {
    return await ConnectorsApplication.mappings(this.actor(), connectionId);
  }

  static async commitMappings(connectionId: string, additions: readonly ConnectorMapping[]) {
    return await ConnectorsApplication.addMappings(this.actor(), connectionId, additions);
  }

  static async commitAutoLinkListings(
    connection: Pick<ConnectorConnection, 'id' | 'variantMode'>,
    listings: readonly LinkableListing[],
  ) {
    return await ConnectorsApplication.autoLinkListings(this.actor(), connection, listings);
  }

  static async commitAutoLinkAcrossStores(listings: readonly LinkableListing[]) {
    return await ConnectorsApplication.autoLinkAcrossStores(this.actor(), listings);
  }

  static async commitLinkListing(connectionId: string, mappings: readonly ConnectorMapping[]) {
    return await ConnectorsApplication.linkListing(this.actor(), connectionId, mappings);
  }

  static async fetchAlerts() {
    return await ConnectorsApplication.alerts(this.actor());
  }

  static async fetchPushOverview() {
    return await ConnectorsApplication.pushOverview(this.actor());
  }

  static async commitRetryPush(connectionId: string, orderId: string) {
    return await ConnectorsApplication.retryPush(this.actor(), connectionId, orderId);
  }

  static async commitResolveAlert(alertId: string) {
    await ConnectorsApplication.resolveAlert(this.actor(), alertId);
  }
}
