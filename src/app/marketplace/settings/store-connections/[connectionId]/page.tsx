import { gatedMarketplaceMetadata } from '@/app/marketplace/gated-metadata';
import { getStoreConnectionCatalogRoute } from '@/app/routes';
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
    'Store products | Pubky Marketplace',
    'Choose which products of your store to also publish on Pubky Marketplace.',
    getStoreConnectionCatalogRoute(connectionId),
  );
}

export default async function MarketplaceConnectorCatalogPage({ params }: MarketplaceConnectorCatalogPageProps) {
  const { connectionId } = await params;
  return <MarketplaceConnectorCatalog connectionId={connectionId} />;
}
