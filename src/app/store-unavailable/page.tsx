import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { renderPerRequestOutsideVercel } from '@/libs/runtime-config/render-mode';
import { resolveStoreState } from '@/libs/store-state/store-state.server';
import { StoreUnavailable } from '@/templates/Store/StoreUnavailable/StoreUnavailable';

export const metadata: Metadata = {
  title: 'This shop is temporarily unavailable',
  robots: { index: false, follow: false },
};

export default async function StoreUnavailablePage() {
  await renderPerRequestOutsideVercel();
  if ((await resolveStoreState()).kind !== 'unavailable') notFound();
  return <StoreUnavailable />;
}
