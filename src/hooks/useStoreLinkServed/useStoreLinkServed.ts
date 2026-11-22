'use client';

import { isStoreLinkServed } from '@/app/store-route-policy';
import { getStoreSeller } from '@/config/store-mode';
import { useAuthStore } from '@/stores/auth/auth.store';

/**
 * Whether a link leads somewhere for the signed-in viewer: always outside store mode; in a store,
 * only to pages the store serves that viewer (`isStoreLinkServed`).
 */
export function useStoreLinkServed(): (href: string) => boolean {
  const viewerPubky = useAuthStore((state) => state.currentUserPubky);
  const storeSeller = getStoreSeller();
  return (href) => storeSeller === null || isStoreLinkServed(href, storeSeller, viewerPubky ?? null);
}
