'use client';

import { useState } from 'react';
import { REVIEW_REMOVAL_COPY } from '@/config/commerce-copy';
import { CommerceController } from '@/controllers/commerce/commerce';
import { toast } from '@/molecules/Toaster/use-toast';

export interface UseRemoveOwnMarketplaceReviewResult {
  /** The order whose review is being removed, or null. */
  removingOrderId: string | null;
  /** Resolves true once the review is gone locally (confirmed or queued for the homeserver). */
  remove: (orderId: string) => Promise<boolean>;
}

/**
 * Removes the signed-in user's published review of one order. The local row
 * goes at once; a homeserver DEL that does not go through stays in the outbox
 * and retries when the orders next load, which the toast says.
 */
export function useRemoveOwnMarketplaceReview(): UseRemoveOwnMarketplaceReviewResult {
  const [removingOrderId, setRemovingOrderId] = useState<string | null>(null);

  const remove = async (orderId: string): Promise<boolean> => {
    if (removingOrderId !== null) return false;
    setRemovingOrderId(orderId);
    try {
      const outcome = await CommerceController.commitDeleteOwnMarketplaceReview(orderId);
      if (outcome === 'queued') {
        toast({ variant: 'warning', description: REVIEW_REMOVAL_COPY.queued });
      } else if (outcome === 'removed') {
        toast({ description: REVIEW_REMOVAL_COPY.removed });
      }
      return outcome !== 'absent';
    } catch {
      toast({ variant: 'error', description: REVIEW_REMOVAL_COPY.failed });
      return false;
    } finally {
      setRemovingOrderId(null);
    }
  };

  return { removingOrderId, remove };
}
