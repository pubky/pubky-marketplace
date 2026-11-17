import { gatedMarketplaceMetadata } from '@/app/marketplace/gated-metadata';
import { MARKETPLACE_ROUTES } from '@/app/routes';
import { SellingUnavailableGate } from '@/organisms/Marketplace/SellingUnavailableGate';
import { MarketplaceInventory } from '@/templates/Marketplace/MarketplaceInventory';

export function generateMetadata() {
  return gatedMarketplaceMetadata(
    'Inventory | Pubky Market',
    'View and set listing stock on Pubky Market.',
    MARKETPLACE_ROUTES.INVENTORY,
  );
}

export default function MarketplaceInventoryPage() {
  return (
    <SellingUnavailableGate>
      <MarketplaceInventory />
    </SellingUnavailableGate>
  );
}
