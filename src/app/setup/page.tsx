import { notFound } from 'next/navigation';
import { getStoreState } from '@/config/store-mode';

export default function SetupPage() {
  const state = getStoreState();
  if (state.kind === 'off' || (state.kind === 'claimed' && state.source === 'pinned')) notFound();
  return (
    <main>
      <h1>Shop setup</h1>
    </main>
  );
}
