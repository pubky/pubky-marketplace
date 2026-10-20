import { gatedMarketplaceMetadata } from '@/app/marketplace/gated-metadata';
import { MARKETPLACE_ROUTES } from '@/app/routes';

export { MarketplacePaymentSettings as default } from '@/templates/Marketplace/MarketplacePaymentSettings';

export function generateMetadata() {
  return gatedMarketplaceMetadata(
    'Payment settings | Pubky Market',
    'Configure how you pay and get paid on Pubky Market.',
    MARKETPLACE_ROUTES.SETTINGS,
  );
}
