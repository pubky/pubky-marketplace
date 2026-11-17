import { gatedMarketplaceMetadata } from '@/app/marketplace/gated-metadata';
import { MARKETPLACE_ROUTES } from '@/app/routes';

export { MarketplaceNotifications as default } from '@/templates/Marketplace/MarketplaceNotifications';

export function generateMetadata() {
  return gatedMarketplaceMetadata(
    'Notifications | Pubky Market',
    'Your Pubky Market notifications.',
    MARKETPLACE_ROUTES.NOTIFICATIONS,
  );
}
