'use client';

import { useEffect } from 'react';
import { getShopHostWindow } from '@/libs/shop-session/bridge';

/** Above the host page's own header and bottom nav. */
const HOST_FRAME_FULLSCREEN_STYLE =
  'position:fixed;inset:0;width:100%;height:100%;max-height:none;margin:0;z-index:2147483647;';

/**
 * While `active`, the frame that holds the Shop covers the whole host page, so a full-screen layer
 * inside the Shop (the listing photo viewer) also hides pubky.app's header and bottom nav, which sit
 * outside the frame. The frame element's own style is restored when `active` turns off or on unmount.
 * Only the same-origin host the Shop already trusts is touched; standalone, this does nothing.
 */
export function useHostFrameFullscreen(active: boolean): void {
  useEffect(() => {
    if (!active || !getShopHostWindow()) return;
    // The element belongs to the host's realm, so `instanceof HTMLElement` from this frame is false.
    const element = window.frameElement as HTMLElement | null;
    if (!element) return;
    const previous = element.getAttribute('style');
    element.setAttribute('style', `${previous ?? ''};${HOST_FRAME_FULLSCREEN_STYLE}`);
    return () => {
      if (previous === null) element.removeAttribute('style');
      else element.setAttribute('style', previous);
    };
  }, [active]);
}
