import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { getStoreConnectionsEnabled } from '@/config/commerce';

/**
 * Store connections (and each store's catalog) answer like an unknown page
 * unless `PUBKY_RUNTIME_STORE_CONNECTIONS_ENABLED` is on. The flag is runtime
 * config, so render per request: a build must never bake the gate in.
 */
export const dynamic = 'force-dynamic';

export default function StoreConnectionsLayout({ children }: { children: ReactNode }) {
  if (!getStoreConnectionsEnabled()) {
    notFound();
  }
  return children;
}
