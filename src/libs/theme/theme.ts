import {
  DEFAULT_THEME,
  LIGHT_THEME_CLASS,
  PREFERS_DARK_QUERY,
  type ResolvedTheme,
  THEME_OPTIONS,
  THEME_STORAGE_KEY,
  type ThemeOption,
} from '@/config/theme';

/**
 * The Shop follows the colour scheme pubky-app stores under `pubky-theme`. The Shop is
 * served on pubky-app's origin (pubky.app/shop, mounted in a same-origin iframe), so it
 * reads that value from the shared localStorage and never writes it.
 */

export function parseThemeOption(value: unknown): ThemeOption {
  return THEME_OPTIONS.find((option) => option === value) ?? DEFAULT_THEME;
}

export function resolveTheme(option: ThemeOption, prefersDark: boolean): ResolvedTheme {
  if (option === 'system') return prefersDark ? 'dark' : 'light';
  return option;
}

function getLocalStorage(win: Window): Storage | null {
  try {
    return win.localStorage;
  } catch {
    return null;
  }
}

function getPrefersDarkQuery(win: Window): MediaQueryList | null {
  try {
    return typeof win.matchMedia === 'function' ? win.matchMedia(PREFERS_DARK_QUERY) : null;
  } catch {
    return null;
  }
}

export function readThemeOption(win: Window): ThemeOption {
  try {
    return parseThemeOption(getLocalStorage(win)?.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

/** Without `matchMedia` the dark base stays, as it did before the light theme existed. */
export function systemPrefersDark(win: Window): boolean {
  return getPrefersDarkQuery(win)?.matches ?? true;
}

export function readResolvedTheme(win: Window): ResolvedTheme {
  return resolveTheme(readThemeOption(win), systemPrefersDark(win));
}

export function applyResolvedTheme(root: HTMLElement, theme: ResolvedTheme): void {
  root.classList.toggle(LIGHT_THEME_CLASS, theme === 'light');
}

/**
 * Calls `onChange` whenever the resolved theme may have changed:
 * - `storage`: pubky-app wrote `pubky-theme` from another browsing context on the origin. That
 *   includes the App page hosting the Shop's same-origin iframe, so a change in the App's settings
 *   reaches the embedded Shop live. A `null` key means the storage was cleared.
 * - `prefers-color-scheme` changes, for `system`. Inside an iframe the query follows the embedding
 *   page's colour scheme in current browsers.
 * - `pageshow` from the back/forward cache, which misses the events above while the page is frozen.
 */
export function subscribeToThemeChanges(win: Window, onChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    if (event.storageArea && event.storageArea !== getLocalStorage(win)) return;
    onChange();
  };
  const handlePageShow = (event: PageTransitionEvent) => {
    if (event.persisted) onChange();
  };
  const media = getPrefersDarkQuery(win);

  win.addEventListener('storage', handleStorage);
  win.addEventListener('pageshow', handlePageShow);
  media?.addEventListener?.('change', onChange);

  return () => {
    win.removeEventListener('storage', handleStorage);
    win.removeEventListener('pageshow', handlePageShow);
    media?.removeEventListener?.('change', onChange);
  };
}

/** Applies the current theme to `<html>` and keeps it in sync. Returns the unsubscribe function. */
export function syncDocumentTheme(win: Window): () => void {
  const apply = () => applyResolvedTheme(win.document.documentElement, readResolvedTheme(win));
  apply();
  return subscribeToThemeChanges(win, apply);
}

/**
 * Inline script that applies the theme during parsing, before the first paint, so a light
 * visitor never sees the dark base flash. It mirrors `readResolvedTheme` + `applyResolvedTheme`;
 * `syncDocumentTheme` takes over after hydration.
 */
export function buildThemePrepaintScript(): string {
  const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
  return (
    '(function(){try{var v=null;' +
    `try{v=window.localStorage.getItem(${json(THEME_STORAGE_KEY)});}catch(_){}` +
    `var o=${json(THEME_OPTIONS)}.indexOf(v)===-1?${json(DEFAULT_THEME)}:v;` +
    `if(o==='system'){var m=null;try{m=window.matchMedia(${json(PREFERS_DARK_QUERY)});}catch(_){}` +
    "o=m&&!m.matches?'light':'dark';}" +
    `document.documentElement.classList.toggle(${json(LIGHT_THEME_CLASS)},o==='light');` +
    '}catch(_){}})();'
  );
}
