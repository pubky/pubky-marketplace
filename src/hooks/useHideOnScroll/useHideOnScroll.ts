'use client';

import { useEffect, useState } from 'react';

/**
 * `true` while the page is scrolled down past `offset`, `false` again as soon as it scrolls back up (or
 * returns within `offset` of the top). Movements under `tolerance` px are ignored, so a resting thumb or
 * momentum jitter doesn't flip it.
 */
export function useHideOnScroll({ enabled = true, offset = 96, tolerance = 8 } = {}): boolean {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setHidden(false);
      return;
    }
    let last = window.scrollY;
    let frame: number | null = null;
    const update = () => {
      frame = null;
      const y = window.scrollY;
      if (y <= offset) setHidden(false);
      else if (y - last > tolerance) setHidden(true);
      else if (last - y > tolerance) setHidden(false);
      else return;
      last = y;
    };
    const onScroll = () => {
      if (frame === null) frame = requestAnimationFrame(update);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [enabled, offset, tolerance]);

  return hidden;
}
