import { gatedMarketplaceMetadata } from '@/app/marketplace/gated-metadata';
import { MARKETPLACE_ROUTES } from '@/app/routes';
import { SellingUnavailableGate } from '@/organisms/Marketplace/SellingUnavailableGate';
import { MarketplacePaymentSettings } from '@/templates/Marketplace/MarketplacePaymentSettings';

export function generateMetadata() {
  return gatedMarketplaceMetadata(
    'Payment settings | Pubky Market',
    'Configure how you pay and get paid on Pubky Market.',
    MARKETPLACE_ROUTES.SETTINGS,
  );
}

export default function MarketplacePaymentSettingsPage() {
  return (
    <SellingUnavailableGate>
      <MarketplacePaymentSettings />
    </SellingUnavailableGate>
  );
}
