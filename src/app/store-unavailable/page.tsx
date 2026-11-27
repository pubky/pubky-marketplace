import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getStoreState } from '@/config/store-mode';
import { StoreUnavailable } from '@/templates/Store/StoreUnavailable/StoreUnavailable';

export const metadata: Metadata = {
  title: 'This shop is temporarily unavailable',
  robots: { index: false, follow: false },
};

export default function StoreUnavailablePage() {
  if (getStoreState().kind !== 'unavailable') notFound();
  return <StoreUnavailable />;
}
