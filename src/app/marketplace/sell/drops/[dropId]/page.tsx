import { gatedMarketplaceMetadata } from '@/app/marketplace/gated-metadata';
import { MARKETPLACE_ROUTES } from '@/app/routes';
import { DropMissionControl } from '@/organisms/Marketplace/DropMissionControl';
import { SellingUnavailableGate } from '@/organisms/Marketplace/SellingUnavailableGate';

export interface DropMissionControlPageProps {
  params: Promise<{
    dropId: string;
  }>;
}

/**
 * Generic gated metadata on purpose: mission control is a personal seller
 * surface, so previews never carry drop specifics.
 */
export async function generateMetadata({ params }: DropMissionControlPageProps) {
  const { dropId } = await params;
  return gatedMarketplaceMetadata(
    'Drop mission control | Pubky Market',
    'Run one of your timed, limited releases on Pubky Market.',
    `${MARKETPLACE_ROUTES.SELL_DROPS}/${dropId}`,
  );
}

export default async function DropMissionControlPage({ params }: DropMissionControlPageProps) {
  const { dropId } = await params;
  return (
    <SellingUnavailableGate>
      <DropMissionControl dropId={dropId} />
    </SellingUnavailableGate>
  );
}
