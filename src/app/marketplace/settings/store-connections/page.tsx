import { gatedMarketplaceMetadata } from '@/app/marketplace/gated-metadata';
import { MARKETPLACE_ROUTES } from '@/app/routes';
import { SellingUnavailableGate } from '@/organisms/Marketplace/SellingUnavailableGate';
import { MarketplaceStoreConnections } from '@/templates/Marketplace/MarketplaceStoreConnections';

export function generateMetadata() {
  return gatedMarketplaceMetadata(
    'Store connections | Pubky Market',
    'Connect your WooCommerce or Shopify store to Pubky Market.',
    MARKETPLACE_ROUTES.SETTINGS_STORE_CONNECTIONS,
  );
}

export default function MarketplaceStoreConnectionsPage() {
  return (
    <SellingUnavailableGate>
      <MarketplaceStoreConnections />
    </SellingUnavailableGate>
  );
}
