'use client';

import { useEffect, useState } from 'react';
import { usePaykitRecovery } from '@/hooks/usePaykitRecovery/usePaykitRecovery';

/**
 * The Paykit outage a payment surface shows, and its recovery. An outage is
 * either read from the seller's payment config (`unreachable`) or entered
 * when the service refuses a bind because it could not reach Paykit
 * (`markRefused`), whatever the health read says. While it shows, `recheck`
 * advances on the recovery backoff; the surface lists it in the dependencies
 * of its config read and reports each result through `settleRead`.
 *
 * A refusal is pinned to the recheck its render committed with, and ends only
 * on evidence: a read that started on a later recheck and found Paykit
 * reachable. The read that follows the refusal itself, and the gap while a
 * recheck is in flight, keep the outage showing.
 */
export function usePaykitOutage(unreachable: boolean) {
  // `null`: no refusal. `'pending'`: refused, not yet pinned to the recheck its render committed with.
  const [refusal, setRefusal] = useState<number | 'pending' | null>(null);
  const outage = unreachable || refusal !== null;
  const recheck = usePaykitRecovery(outage);

  // Pinning the refusal in an effect reads the recheck of the committed render, never a stale one.
  useEffect(() => {
    setRefusal((current) => (current === 'pending' ? recheck : current));
  }, [refusal, recheck]);

  // Created once, so the identities stay stable for callers that list them in effect dependencies.
  const [actions] = useState(() => ({
    markRefused: () => setRefusal((current) => current ?? 'pending'),
    settleRead: (readAt: number, reachable: boolean) => {
      if (!reachable) return;
      setRefusal((current) => (typeof current === 'number' && readAt > current ? null : current));
    },
  }));

  return { outage, refused: refusal !== null, recheck, ...actions };
}
