import { gatedMarketplaceMetadata } from '@/app/marketplace/gated-metadata';
import { MARKETPLACE_ROUTES } from '@/app/routes';
import { SellingUnavailableGate } from '@/organisms/Marketplace/SellingUnavailableGate';
import { MarketplaceSell } from '@/templates/Marketplace/MarketplaceSell';

export function generateMetadata() {
  return gatedMarketplaceMetadata('Sell | Pubky Market', 'Create a listing on Pubky Market.', MARKETPLACE_ROUTES.SELL);
}

export default function MarketplaceSellPage() {
  return (
    <SellingUnavailableGate>
      <MarketplaceSell />
    </SellingUnavailableGate>
  );
}
