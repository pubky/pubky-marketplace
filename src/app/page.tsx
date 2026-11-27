import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { APP_ROUTES } from '@/app/routes';
import { getStoreState } from '@/config/store-mode';
import { StoreHolding } from '@/templates/Store/StoreHolding/StoreHolding';

export function generateMetadata(): Metadata {
  if (getStoreState().kind !== 'unclaimed') return {};
  return {
    title: 'This shop is being set up',
    description: 'The owner has not finished setting up this shop yet. Please check back soon.',
    robots: { index: false, follow: false },
  };
}

export default function RootPage() {
  if (getStoreState().kind === 'unclaimed') return <StoreHolding />;
  redirect(APP_ROUTES.MARKETPLACE);
}
