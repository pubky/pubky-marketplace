'use client';

import { useEffect, useRef, useState } from 'react';
import { paykitRetryDelayMs } from '@/libs/commerce/paykit-rail';

/**
 * Drives the automatic recovery from a Paykit outage. While `active`, the
 * returned number advances after each backoff delay (5s, 10s, 20s, then every
 * 30s); a caller lists it in the dependencies of the read that found the
 * outage, so the read repeats until Paykit is back. When `active` turns false
 * the loop stops and the next outage starts again at 5s.
 */
export function usePaykitRecovery(active: boolean): number {
  const [tick, setTick] = useState(0);
  const failures = useRef(0);

  useEffect(() => {
    if (!active) {
      failures.current = 0;
      return;
    }
    const timer = window.setTimeout(() => {
      failures.current += 1;
      setTick((current) => current + 1);
    }, paykitRetryDelayMs(failures.current));
    return () => window.clearTimeout(timer);
  }, [active, tick]);

  return tick;
}
