import { notFound } from 'next/navigation';
import { getStoreState } from '@/config/store-mode';

export default function StoreUnavailablePage() {
  if (getStoreState().kind !== 'unavailable') notFound();
  return (
    <main>
      <h1>This shop is temporarily unavailable</h1>
      <p>Please check back soon.</p>
    </main>
  );
}
