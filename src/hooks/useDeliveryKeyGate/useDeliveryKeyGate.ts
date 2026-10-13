'use client';

import { useState } from 'react';
import { CommerceController } from '@/controllers/commerce/commerce';
import type { SellerDeliveryKey } from '@/libs/commerce/delivery-envelope';
import { DELIVERY_KEY_COPY } from '@/libs/commerce/delivery-key-copy';
import { Logger } from '@/libs/logger/logger';
import { toast } from '@/molecules/Toaster/use-toast';

export type PendingDeliveryKeyChange = {
  sellerPubky: string;
  pinnedKeyId: string;
  currentKeyId: string;
};

export type DeliveryKeyGateOutcome = { ok: true; keys: Map<string, SellerDeliveryKey> } | { ok: false };

/**
 * Resolves the delivery key of every shipped seller before a buyer submits
 * an address. A seller without a usable key stops the checkout with a toast;
 * a seller whose key changed since the buyer last saw it opens a
 * confirmation that shows both fingerprints, and the buyer's answer decides
 * whether the new key is pinned and used.
 */
export function useDeliveryKeyGate() {
  const [pendingChange, setPendingChange] = useState<{
    change: PendingDeliveryKeyChange;
    decide: (accepted: boolean) => void;
  } | null>(null);

  const askBuyer = (change: PendingDeliveryKeyChange) =>
    new Promise<boolean>((resolve) => {
      setPendingChange({ change, decide: resolve });
    });

  const decide = (accepted: boolean) => {
    pendingChange?.decide(accepted);
    setPendingChange(null);
  };

  const resolveKeys = async (sellerPubkys: readonly string[]): Promise<DeliveryKeyGateOutcome> => {
    try {
      for (let attempt = 0; attempt <= sellerPubkys.length; attempt += 1) {
        const resolution = await CommerceController.resolveDeliveryKeysForCheckout(sellerPubkys);
        if (resolution.ok) return { ok: true, keys: resolution.keys };
        const { problem, sellerPubky } = resolution;
        if (problem.kind === 'changed') {
          const accepted = await askBuyer({
            sellerPubky,
            pinnedKeyId: problem.pinnedKeyId,
            currentKeyId: problem.currentKeyId,
          });
          if (!accepted) return { ok: false };
          await CommerceController.commitAcceptDeliveryKeyChange(sellerPubky, problem.currentKeyId);
          continue;
        }
        toast({
          variant: 'error',
          description: problem.kind === 'no_key' ? DELIVERY_KEY_COPY.noKey : DELIVERY_KEY_COPY.invalid,
        });
        return { ok: false };
      }
    } catch (error) {
      Logger.error('Seller delivery key could not be resolved', { error });
      toast({ variant: 'error', description: DELIVERY_KEY_COPY.unreachable });
      return { ok: false };
    }
    toast({ variant: 'error', description: DELIVERY_KEY_COPY.unreachable });
    return { ok: false };
  };

  return { resolveKeys, pendingChange: pendingChange?.change ?? null, decide };
}
