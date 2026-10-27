'use client';

import { useEffect, useRef, useState } from 'react';

export interface UnsavedChangesGuard {
  /** A link the visitor clicked while edits were unsaved, held back until they choose; null otherwise. */
  pendingLink: HTMLAnchorElement | null;
  /** Keep editing: the held-back link is dropped. */
  stay: () => void;
  /** Leave and lose the edits: the held-back link is followed as if it had never been held. */
  leave: () => void;
}

/**
 * Stops a visitor from leaving a page with unsaved edits by accident. While `active`:
 *
 * - closing or reloading the tab, or following an outside link, asks through the browser's own prompt;
 * - a click on a link that goes to another page of this site is held back and reported as `pendingLink`,
 *   so the page can ask in its own dialog, then follow the link with `leave` or drop it with `stay`.
 *
 * Links that only change the hash, open a new tab, download, or carry a modifier key are left alone.
 * The browser's Back button cannot be held back by an app-router page, so it is not covered.
 */
export function useUnsavedChangesGuard(active: boolean): UnsavedChangesGuard {
  const [pendingLink, setPendingLink] = useState<HTMLAnchorElement | null>(null);
  const following = useRef(false);

  useEffect(() => {
    if (!active) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    const onClick = (event: MouseEvent) => {
      if (following.current) {
        following.current = false;
        return;
      }
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if ((anchor.target !== '' && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      if (destination.pathname === window.location.pathname && destination.search === window.location.search) return;
      event.preventDefault();
      event.stopPropagation();
      setPendingLink(anchor);
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [active]);

  const stay = () => setPendingLink(null);

  const leave = () => {
    const link = pendingLink;
    setPendingLink(null);
    if (!link) return;
    following.current = true;
    link.click();
    following.current = false;
  };

  return { pendingLink, stay, leave };
}
