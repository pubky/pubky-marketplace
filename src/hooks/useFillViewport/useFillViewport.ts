'use client';

import { type RefObject, useLayoutEffect, useState } from 'react';

const MIN_HEIGHT_PX = 280;

function viewportHeight(): number {
  return Math.round(window.visualViewport?.height ?? window.innerHeight);
}

/**
 * Height, in px, that makes `ref`'s element end exactly where the page ends:
 * the visible viewport minus everything above the element and everything the
 * page lays out below it (bottom padding, a legal strip, whatever the layout
 * adds). Measured, not assumed, so a different header, a hidden header
 * (embedded Shop) or a changed footer cannot push the page into a scrollbar.
 * Follows the visual viewport, so a mobile keyboard shrinks it too.
 *
 * `null` on the server and until the first measurement, which runs before the
 * first paint: keep a CSS fallback height on the element for the server render.
 */
export function useFillViewport(ref: RefObject<HTMLElement | null>): number | null {
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame: number | null = null;

    const measure = () => {
      frame = null;
      const rect = element.getBoundingClientRect();
      const top = rect.top + window.scrollY;
      const below = document.documentElement.scrollHeight - (top + rect.height);
      const next = Math.max(MIN_HEIGHT_PX, Math.floor(viewportHeight() - top - Math.max(0, below)));
      setHeight((current) => (current === next ? current : next));
    };
    const schedule = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(measure);
    };

    measure();
    // The page below the element changes size (a strip wraps, a note is
    // dismissed), the window or the visual viewport (keyboard) changes.
    const observer = new ResizeObserver(schedule);
    observer.observe(document.body);
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [ref]);

  return height;
}
