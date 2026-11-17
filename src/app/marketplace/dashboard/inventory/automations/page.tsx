import { gatedMarketplaceMetadata } from '@/app/marketplace/gated-metadata';
import { MARKETPLACE_ROUTES } from '@/app/routes';
import { SellingUnavailableGate } from '@/organisms/Marketplace/SellingUnavailableGate';
import { MarketplaceInventoryAutomations } from '@/templates/Marketplace/MarketplaceInventoryAutomations';

export function generateMetadata() {
  return gatedMarketplaceMetadata(
    'Automations | Pubky Market',
    'Manage shop sessions and webhook endpoints on Pubky Market.',
    MARKETPLACE_ROUTES.INVENTORY_AUTOMATIONS,
  );
}

export default function MarketplaceInventoryAutomationsPage() {
  return (
    <SellingUnavailableGate>
      <MarketplaceInventoryAutomations />
    </SellingUnavailableGate>
  );
}
