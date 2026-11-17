'use client';

import { useEffect, useState } from 'react';
import { CommerceController } from '@/controllers/commerce/commerce';

/**
 * Who marks orders paid on this deployment, from the service's `/health`:
 * `seller`, `automatic`, `unknown` when the service does not say (an older
 * service, which pays automatically, or a failed read), or `checking` while
 * the read is in flight.
 */
export type PaymentConfirmationModeStatus = 'checking' | 'seller' | 'automatic' | 'unknown';

export function usePaymentConfirmationMode(): PaymentConfirmationModeStatus {
  const [status, setStatus] = useState<PaymentConfirmationModeStatus>('checking');
  useEffect(() => {
    let active = true;
    Promise.resolve()
      .then(() => CommerceController.fetchPaymentConfirmationMode())
      .then((mode) => {
        if (active) setStatus(mode ?? 'unknown');
      })
      .catch(() => {
        if (active) setStatus('unknown');
      });
    return () => {
      active = false;
    };
  }, []);
  return status;
}
