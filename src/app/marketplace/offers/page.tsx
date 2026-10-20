import { gatedMarketplaceMetadata } from '@/app/marketplace/gated-metadata';
import { MARKETPLACE_ROUTES } from '@/app/routes';

export { MarketplaceOffers as default } from '@/templates/Marketplace/MarketplaceOffers';

export function generateMetadata() {
  return gatedMarketplaceMetadata(
    'Offers | Pubky Market',
    'Manage offers you have made and received on Pubky Market.',
    MARKETPLACE_ROUTES.OFFERS,
  );
}
