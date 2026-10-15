'use client';

import { useEffect, useState } from 'react';

/** Wall-clock milliseconds, refreshed every `intervalMs` (default one second) while `active`. */
export function useNowMs(active: boolean, intervalMs = 1000): number {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [active, intervalMs]);

  return nowMs;
}
