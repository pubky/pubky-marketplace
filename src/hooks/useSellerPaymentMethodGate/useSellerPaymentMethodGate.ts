'use client';

import { useEffect, useRef, useState } from 'react';
import { getCommerceAdapterMode, isDurableCommerceMode } from '@/config/commerce';
import { CommerceController } from '@/controllers/commerce/commerce';
import { usePaykitRecovery } from '@/hooks/usePaykitRecovery/usePaykitRecovery';
import {
  evaluateSellerPaymentMethodGate,
  type SellerPaymentMethodGateReason,
} from '@/libs/commerce/listing-publish-guards';
import { useAuthStore } from '@/stores/auth/auth.store';

export function useSellerPaymentMethodGate(): {
  isDurable: boolean;
  ready: boolean;
  reason: SellerPaymentMethodGateReason | null;
} {
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  const isDurable = isDurableCommerceMode(getCommerceAdapterMode());
  const [ready, setReady] = useState(!isDurable);
  const [reason, setReason] = useState<SellerPaymentMethodGateReason | null>(null);
  const recheck = usePaykitRecovery(reason === 'paykit-unreachable');
  const evaluatedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!isDurable) {
      setReason(null);
      setReady(true);
      return;
    }
    let active = true;
    // A recheck during an outage keeps showing the outage; only a new account blanks the state.
    if (evaluatedFor.current !== currentUserPubky) setReady(false);
    evaluatedFor.current = currentUserPubky;
    void evaluateSellerPaymentMethodGate({
      ownerPubky: currentUserPubky,
      loadPaymentConfig: (pubky) => CommerceController.getSellerPaymentConfig(pubky),
    }).then((next) => {
      if (!active) return;
      setReason(next);
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, [currentUserPubky, isDurable, recheck]);

  return { isDurable, ready, reason };
}
