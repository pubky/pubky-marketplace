'use client';

import { useEffect, useRef, useState } from 'react';
import { buildFeatureDiscoveryDeviceStorageKey, MARKETPLACE_NAV_SWIPE_STORAGE_ID } from '@/config/featureDiscovery';

const storageKey = buildFeatureDiscoveryDeviceStorageKey(MARKETPLACE_NAV_SWIPE_STORAGE_ID);

/** Stop teaching the gesture once this browser has scrolled the section tabs. */
export function useMarketplaceNavSwipeHint(pathname: string | null) {
  const scrollRef = useRef<HTMLElement>(null);
  const interactionStart = useRef<number | null>(null);
  const [seen, setSeen] = useState(true);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    try {
      setSeen(window.localStorage.getItem(storageKey) === 'seen');
    } catch {
      setSeen(false);
    }

    const nav = scrollRef.current;
    if (!nav) return;
    interactionStart.current = null;
    const measure = () => {
      const overflows = nav.scrollWidth > nav.clientWidth + 1;
      setOverflows(overflows);
      if (!overflows) return;
      const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
      if (!active) return;
      const bounds = nav.getBoundingClientRect();
      const tab = active.getBoundingClientRect();
      if (tab.right > bounds.right) nav.scrollLeft += tab.right - bounds.right;
      else if (tab.left < bounds.left) nav.scrollLeft += tab.left - bounds.left;
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(nav);
    if (nav.firstElementChild) observer?.observe(nav.firstElementChild);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [pathname]);

  const onInteract = () => {
    interactionStart.current ??= scrollRef.current?.scrollLeft ?? 0;
  };

  const onScroll = () => {
    if (
      seen ||
      interactionStart.current === null ||
      Math.abs((scrollRef.current?.scrollLeft ?? 0) - interactionStart.current) < 4
    )
      return;
    setSeen(true);
    try {
      window.localStorage.setItem(storageKey, 'seen');
    } catch {
      // Keep the dismissal in memory when browser storage is unavailable.
    }
  };

  return { scrollRef, onScroll, onInteract, showSwipeHint: overflows && !seen };
}
