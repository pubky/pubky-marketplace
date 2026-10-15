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
 * `enabled` is false when there is nothing to pay for; the outage then ends and
 * the recheck stops. Retries are deliberately uncapped, at the 30s ceiling, so
 * the surface recovers on its own however long Paykit is away.
 *
 * A refusal is pinned to the recheck its render committed with, and ends only
 * on evidence: a read that started on a later recheck and found Paykit
 * reachable. The read that follows the refusal itself, and the gap while a
 * recheck is in flight, keep the outage showing.
 */
export function usePaykitOutage(unreachable: boolean, enabled = true) {
  // `null`: no refusal. `'pending'`: refused, not yet pinned to the recheck its render committed with.
  const [refusal, setRefusal] = useState<number | 'pending' | null>(null);
  const outage = enabled && (unreachable || refusal !== null);
  const recheck = usePaykitRecovery(outage);

  // Nothing left to pay for (an emptied cart, a settled order): drop a refusal so no recheck keeps ticking.
  useEffect(() => {
    if (!enabled) setRefusal(null);
  }, [enabled]);

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

  return { outage, refused: enabled && refusal !== null, recheck, ...actions };
}
