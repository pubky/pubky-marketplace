'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePaykitRecovery } from '@/hooks/usePaykitRecovery/usePaykitRecovery';

/**
 * The Paykit outage a payment surface shows, and its recovery. An outage is
 * either read from the seller's payment config (`unreachable`) or entered
 * when the service refuses a bind because it could not reach Paykit
 * (`markRefused`), whatever the health read says. While it shows, `recheck`
 * advances on the recovery backoff; the surface lists it in the dependencies
 * of its config read and reports each result through `settleRead`.
 *
 * A refusal ends only on evidence: a read that started on a later recheck than
 * the refusal and found Paykit reachable. The read that follows the refusal
 * itself, and the gap while a recheck is in flight, keep the outage showing.
 */
export function usePaykitOutage(unreachable: boolean) {
  const [refusedAt, setRefusedAt] = useState<number | null>(null);
  const outage = unreachable || refusedAt !== null;
  const recheck = usePaykitRecovery(outage);
  const latestRecheck = useRef(recheck);
  useEffect(() => {
    latestRecheck.current = recheck;
  }, [recheck]);

  // Stable identities: callers list them in the dependencies of their config read.
  const markRefused = useCallback(() => setRefusedAt(latestRecheck.current), []);
  const settleRead = useCallback((readAt: number, reachable: boolean) => {
    if (!reachable) return;
    setRefusedAt((current) => (current !== null && readAt > current ? null : current));
  }, []);

  return { outage, refused: refusedAt !== null, recheck, markRefused, settleRead };
}
