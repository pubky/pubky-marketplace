import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { APP_ROUTES } from '@/app/routes';
import { renderPerRequestOutsideVercel } from '@/libs/runtime-config/render-mode';
import { resolveStoreState } from '@/libs/store-state/store-state.server';
import { StoreHolding } from '@/templates/Store/StoreHolding/StoreHolding';

export async function generateMetadata(): Promise<Metadata> {
  await renderPerRequestOutsideVercel();
  if ((await resolveStoreState()).kind !== 'unclaimed') return {};
  return {
    title: 'This shop is being set up',
    description: 'The owner has not finished setting up this shop yet. Please check back soon.',
    robots: { index: false, follow: false },
  };
}

export default async function RootPage() {
  await renderPerRequestOutsideVercel();
  if ((await resolveStoreState()).kind === 'unclaimed') return <StoreHolding />;
  redirect(APP_ROUTES.MARKETPLACE);
}
