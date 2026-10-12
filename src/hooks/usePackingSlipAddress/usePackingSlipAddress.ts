'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { CommerceController } from '@/controllers/commerce/commerce';
import type { CommerceDeliveryAddressValue } from '@/libs/commerce/postal-address';
import { Logger } from '@/libs/logger/logger';
import type { MarketplaceOrder } from '@/services/marketplace/marketplace';
import { useAuthStore } from '@/stores/auth/auth.store';

export type PackingSlipAddressState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; address: CommerceDeliveryAddressValue }
  | { status: 'undecryptable'; reason: 'key_missing' | 'rejected' }
  | { status: 'unavailable' };

export type UsePackingSlipAddressResult = {
  /** What this device can read of the order's delivery address. */
  deliveryAddress: PackingSlipAddressState;
  /** Drop the decrypted address (the dialog calls this on close). */
  clear: () => void;
};

const IDLE: PackingSlipAddressState = { status: 'idle' };

/**
 * Holds the seller's decrypted delivery address for one print dialog.
 *
 * PRIVACY INVARIANT: the decrypted address lives ONLY in this component
 * state. It is never persisted (no Dexie, no localStorage/sessionStorage, no
 * URL), never logged, and never sent anywhere; it exists so the seller can
 * read it and `window.print()` can put it on paper. It is dropped on dialog
 * close, route change and account switch. The sealed envelope is opened with
 * the delivery key kept on this device (`CommerceController.getOrderDeliveryAddress`);
 * if this device cannot open it the state says so and no address is shown.
 */
export function usePackingSlipAddress({
  order,
  enabled = false,
}: {
  order?: MarketplaceOrder;
  enabled?: boolean;
} = {}): UsePackingSlipAddressResult {
  const [deliveryAddress, setDeliveryAddress] = useState<PackingSlipAddressState>(IDLE);
  const pathname = usePathname();
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);

  useEffect(() => {
    setDeliveryAddress(IDLE);
  }, [pathname, currentUserPubky]);

  useEffect(() => {
    setDeliveryAddress(IDLE);
    if (
      !enabled ||
      !order ||
      currentUserPubky !== order.sellerPubky ||
      order.fulfillment !== 'shipping' ||
      !['paid', 'processing'].includes(order.state)
    ) {
      return;
    }

    let active = true;
    setDeliveryAddress({ status: 'loading' });
    void (async () => {
      try {
        const freshOrder = await CommerceController.getMarketplaceOrder(order.id);
        if (
          !freshOrder ||
          freshOrder.sellerPubky !== currentUserPubky ||
          freshOrder.fulfillment !== 'shipping' ||
          !['paid', 'processing'].includes(freshOrder.state)
        ) {
          if (active) setDeliveryAddress({ status: 'unavailable' });
          return;
        }
        const result = await CommerceController.getOrderDeliveryAddress(freshOrder);
        if (!active) return;
        if (result.kind === 'address') setDeliveryAddress({ status: 'ready', address: result.address });
        else if (result.kind === 'undecryptable')
          setDeliveryAddress({ status: 'undecryptable', reason: result.reason });
        else setDeliveryAddress({ status: 'unavailable' });
      } catch (error) {
        Logger.error('Delivery address could not be read for the packing slip', { error });
        if (active) setDeliveryAddress({ status: 'undecryptable', reason: 'rejected' });
      }
    })();

    return () => {
      active = false;
    };
  }, [currentUserPubky, enabled, order]);

  const clear = () => setDeliveryAddress(IDLE);

  return { deliveryAddress, clear };
}
