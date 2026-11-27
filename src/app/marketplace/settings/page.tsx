import { gatedMarketplaceMetadata } from '@/app/marketplace/gated-metadata';
import { MARKETPLACE_ROUTES } from '@/app/routes';
import { MarketplaceAccountSettings } from '@/organisms/Marketplace/MarketplaceAccountSettings';
import { SellingUnavailableGate } from '@/organisms/Marketplace/SellingUnavailableGate';
import { MarketplacePaymentSettings } from '@/templates/Marketplace/MarketplacePaymentSettings';

export function generateMetadata() {
  return gatedMarketplaceMetadata(
    'Shop settings | Pubky Market',
    'Manage your Market account, delivery addresses and payment settings.',
    MARKETPLACE_ROUTES.SETTINGS,
  );
}

export default function MarketplacePaymentSettingsPage() {
  return (
    <SellingUnavailableGate whileHeld={<MarketplaceAccountSettings />}>
      <MarketplacePaymentSettings />
    </SellingUnavailableGate>
  );
}
