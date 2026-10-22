import { gatedMarketplaceMetadata } from '@/app/marketplace/gated-metadata';
import { getStoreConnectionCatalogRoute } from '@/app/routes';
import { SellingUnavailableGate } from '@/organisms/Marketplace/SellingUnavailableGate';
import { MarketplaceConnectorCatalog } from '@/templates/Marketplace/MarketplaceConnectorCatalog';

export interface MarketplaceConnectorCatalogPageProps {
  params: Promise<{
    connectionId: string;
  }>;
}

// Seller-only: generic copy, nothing about the store belongs in the preview.
export async function generateMetadata({ params }: MarketplaceConnectorCatalogPageProps) {
  const { connectionId } = await params;
  return gatedMarketplaceMetadata(
    'Store products | Pubky Market',
    'Choose which products of your store to also publish on Pubky Market.',
    getStoreConnectionCatalogRoute(connectionId),
  );
}

export default async function MarketplaceConnectorCatalogPage({ params }: MarketplaceConnectorCatalogPageProps) {
  const { connectionId } = await params;
  return (
    <SellingUnavailableGate>
      <MarketplaceConnectorCatalog connectionId={connectionId} />
    </SellingUnavailableGate>
  );
}
