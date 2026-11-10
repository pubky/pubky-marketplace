'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { MARKETPLACE_ROUTES } from '@/app/routes';
import { CommerceController } from '@/controllers/commerce/commerce';
import { useRequireAuth } from '@/hooks/useRequireAuth/useRequireAuth';
import { toast } from '@/molecules/Toaster/toast';
import { useAuthStore } from '@/stores/auth/auth.store';

export function useCommerceFavorite(listingCompositeId: string) {
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  const { requireAuth } = useRequireAuth();
  const router = useRouter();
  const [isMutating, setIsMutating] = useState(false);
  const favorite = useLiveQuery(
    () => (currentUserPubky ? CommerceController.isFavorite(listingCompositeId) : false),
    [currentUserPubky, listingCompositeId],
  );

  const toggle = async (): Promise<void> => {
    const mutation = requireAuth(async () => {
      setIsMutating(true);
      try {
        if (favorite) {
          await CommerceController.commitDeleteFavorite(listingCompositeId);
        } else {
          await CommerceController.commitCreateFavorite(listingCompositeId);
        }
        toast({
          title: favorite ? 'Removed from your watchlist' : 'Added to your watchlist',
          action: {
            label: 'Watchlist',
            altText: 'Open watchlist',
            onClick: () => router.push(MARKETPLACE_ROUTES.WATCHLIST),
          },
        });
      } catch {
        toast({ variant: 'error', description: 'Could not update this favorite.' });
      } finally {
        setIsMutating(false);
      }
    });
    await mutation;
  };

  return {
    isFavorite: favorite ?? false,
    isMutating,
    toggle,
  };
}
