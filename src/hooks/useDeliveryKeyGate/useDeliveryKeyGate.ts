'use client';

import { useState } from 'react';
import { CommerceController } from '@/controllers/commerce/commerce';
import type { SellerDeliveryKey } from '@/libs/commerce/delivery-envelope';
import { DELIVERY_KEY_COPY } from '@/libs/commerce/delivery-key-copy';
import { Logger } from '@/libs/logger/logger';

export type PendingDeliveryKeyChange = {
  sellerPubky: string;
  pinnedKeyId: string;
  currentKeyId: string;
};

/** Why checkout stopped before sealing: shown inline next to Pay until the buyer tries again. */
export type DeliveryKeyBlock = {
  kind: 'no_key' | 'invalid' | 'unreachable';
  /** The seller whose key stopped the checkout; null when no key was read at all. */
  sellerPubky: string | null;
  message: string;
};

export type DeliveryKeyGateOutcome =
  | { ok: true; keys: Map<string, SellerDeliveryKey> }
  | { ok: false; blocked: DeliveryKeyBlock | null };

/**
 * Resolves the delivery key of every shipped seller before a buyer submits
 * an address. A seller without a usable key stops the checkout with an inline
 * message that stays until the buyer tries again; a toast alone vanished in
 * three seconds and read as Pay doing nothing. A seller whose key changed
 * since the buyer last saw it opens a confirmation that shows both
 * fingerprints, and the buyer's answer decides whether the new key is pinned
 * and used.
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

  const [blocked, setBlocked] = useState<DeliveryKeyBlock | null>(null);

  const block = (kind: DeliveryKeyBlock['kind'], sellerPubky: string | null): DeliveryKeyGateOutcome => {
    const next: DeliveryKeyBlock = {
      kind,
      sellerPubky,
      message:
        kind === 'no_key'
          ? DELIVERY_KEY_COPY.noKey
          : kind === 'invalid'
            ? DELIVERY_KEY_COPY.invalid
            : DELIVERY_KEY_COPY.unreachable,
    };
    setBlocked(next);
    return { ok: false, blocked: next };
  };

  const resolveKeys = async (sellerPubkys: readonly string[]): Promise<DeliveryKeyGateOutcome> => {
    setBlocked(null);
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
          if (!accepted) return { ok: false, blocked: null };
          await CommerceController.commitAcceptDeliveryKeyChange(sellerPubky, problem.currentKeyId);
          continue;
        }
        return block(problem.kind, sellerPubky);
      }
    } catch (error) {
      Logger.error('Seller delivery key could not be resolved', { error });
      return block('unreachable', null);
    }
    return block('unreachable', null);
  };

  return { resolveKeys, pendingChange: pendingChange?.change ?? null, decide, blocked };
}
