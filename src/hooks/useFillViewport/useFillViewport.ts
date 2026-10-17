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

    // A zero-height marker at the very end of the body: its position is where the
    // page's content ends. Neither the document's scroll height nor the body's
    // box can say that, since both stretch to at least the viewport.
    const end = document.createElement('div');
    end.setAttribute('aria-hidden', 'true');
    end.style.cssText = 'height:0;margin:0;padding:0;border:0;visibility:hidden';
    document.body.append(end);

    const measure = () => {
      frame = null;
      const rect = element.getBoundingClientRect();
      const top = rect.top + window.scrollY;
      const contentBottom = end.getBoundingClientRect().top + window.scrollY;
      const below = contentBottom - (top + rect.height);
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
      end.remove();
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [ref]);

  return height;
}
