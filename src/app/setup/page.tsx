import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { renderPerRequestOutsideVercel } from '@/libs/runtime-config/render-mode';
import { resolveStoreState } from '@/libs/store-state/store-state.server';
import { StoreSetup } from '@/templates/Store/StoreSetup/StoreSetup';

export const metadata: Metadata = {
  title: 'Shop setup',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function SetupPage() {
  await renderPerRequestOutsideVercel();
  const state = await resolveStoreState();
  if (state.kind === 'off' || (state.kind === 'claimed' && state.source === 'pinned')) notFound();
  return <StoreSetup state={state} />;
}
