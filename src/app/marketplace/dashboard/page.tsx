import { gatedMarketplaceMetadata } from '@/app/marketplace/gated-metadata';
import { MARKETPLACE_ROUTES } from '@/app/routes';

export { MarketplaceDashboard as default } from '@/templates/Marketplace/MarketplaceDashboard';

export function generateMetadata() {
  return gatedMarketplaceMetadata(
    'Seller studio | Pubky Market',
    'Manage your shop, listings, and sales on Pubky Market.',
    MARKETPLACE_ROUTES.DASHBOARD,
  );
}
