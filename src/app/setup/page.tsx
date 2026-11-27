import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getStoreState } from '@/config/store-mode';
import { StoreSetup } from '@/templates/Store/StoreSetup/StoreSetup';

export const metadata: Metadata = {
  title: 'Shop setup',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function SetupPage() {
  const state = getStoreState();
  if (state.kind === 'off' || (state.kind === 'claimed' && state.source === 'pinned')) notFound();
  return <StoreSetup state={state} />;
}
