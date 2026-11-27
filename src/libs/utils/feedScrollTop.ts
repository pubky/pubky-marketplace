import type React from 'react';

interface HandleFeedNavClickOptions {
  /** Whether the clicked nav target is the route the user is already on. */
  isActive: boolean;
  /** When already active, smooth-scroll to the top instead of navigating. */
  smoothScrollWhenActive?: boolean;
}

/** Scroll a selected navigation item to the top without interfering with modified clicks. */
export function handleFeedNavClick(
  event: React.MouseEvent,
  { isActive, smoothScrollWhenActive }: HandleFeedNavClickOptions,
): void {
  // Don't hijack modified clicks (new tab/window, etc.)
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;

  if (isActive && smoothScrollWhenActive) {
    event.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}
