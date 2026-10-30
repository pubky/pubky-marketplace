import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIGHT_THEME_CLASS, PREFERS_DARK_QUERY, THEME_STORAGE_KEY } from '@/config/theme';
import {
  applyResolvedTheme,
  buildThemePrepaintScript,
  parseThemeOption,
  readResolvedTheme,
  readThemeOption,
  resolveTheme,
  subscribeToThemeChanges,
  syncDocumentTheme,
  systemPrefersDark,
} from './theme';

type Listener = () => void;

/** A `prefers-color-scheme: dark` media query whose answer the test controls. */
function stubPrefersDark(initial: boolean) {
  const listeners = new Set<Listener>();
  const query = {
    matches: initial,
    media: PREFERS_DARK_QUERY,
    addEventListener: vi.fn((_type: string, listener: Listener) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: Listener) => listeners.delete(listener)),
  };
  const matchMedia = vi.fn(() => query);
  vi.stubGlobal('matchMedia', matchMedia);
  return {
    matchMedia,
    listeners,
    setPrefersDark(next: boolean) {
      query.matches = next;
      listeners.forEach((listener) => listener());
    },
  };
}

/** What pubky-app does when it saves the setting in another browsing context on the origin. */
function writeFromApp(value: string | null) {
  const oldValue = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (value === null) window.localStorage.removeItem(THEME_STORAGE_KEY);
  else window.localStorage.setItem(THEME_STORAGE_KEY, value);
  window.dispatchEvent(
    new StorageEvent('storage', {
      key: THEME_STORAGE_KEY,
      oldValue,
      newValue: value,
      storageArea: window.localStorage,
    }),
  );
}

function isLight() {
  return document.documentElement.classList.contains(LIGHT_THEME_CLASS);
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.className = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.documentElement.className = '';
});

describe('parseThemeOption', () => {
  it.each(['dark', 'light', 'system'])('keeps the stored option %s', (value) => {
    expect(parseThemeOption(value)).toBe(value);
  });

  it.each([null, undefined, '', 'Dark', 'LIGHT', 'auto', '"light"', ' light', 42, {}])(
    'falls back to system for the invalid value %j',
    (value) => {
      expect(parseThemeOption(value)).toBe('system');
    },
  );
});

describe('resolveTheme', () => {
  it.each([
    ['dark', true, 'dark'],
    ['dark', false, 'dark'],
    ['light', true, 'light'],
    ['light', false, 'light'],
    ['system', true, 'dark'],
    ['system', false, 'light'],
  ] as const)('resolves %s with prefers-dark=%s to %s', (option, prefersDark, expected) => {
    expect(resolveTheme(option, prefersDark)).toBe(expected);
  });
});

describe('readThemeOption', () => {
  it('reads system when pubky-app has not stored a preference', () => {
    expect(readThemeOption(window)).toBe('system');
  });

  it.each(['dark', 'light', 'system'])('reads the shared %s preference', (value) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, value);

    expect(readThemeOption(window)).toBe(value);
  });

  it('reads system for an invalid stored value', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'sepia');

    expect(readThemeOption(window)).toBe('system');
  });

  it('reads system when localStorage is unavailable', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    expect(readThemeOption(window)).toBe('system');
  });
});

describe('systemPrefersDark', () => {
  it('keeps the dark base when matchMedia is unavailable', () => {
    expect(systemPrefersDark(window)).toBe(true);
  });

  it.each([true, false])('follows prefers-color-scheme (dark=%s)', (prefersDark) => {
    const { matchMedia } = stubPrefersDark(prefersDark);

    expect(systemPrefersDark(window)).toBe(prefersDark);
    expect(matchMedia).toHaveBeenCalledWith(PREFERS_DARK_QUERY);
  });
});

describe('readResolvedTheme', () => {
  it.each([
    [null, true, 'dark'],
    [null, false, 'light'],
    ['system', true, 'dark'],
    ['system', false, 'light'],
    ['dark', false, 'dark'],
    ['light', true, 'light'],
    ['bogus', false, 'light'],
    ['bogus', true, 'dark'],
  ] as const)('resolves stored %s with prefers-dark=%s to %s', (stored, prefersDark, expected) => {
    if (stored !== null) window.localStorage.setItem(THEME_STORAGE_KEY, stored);
    stubPrefersDark(prefersDark);

    expect(readResolvedTheme(window)).toBe(expected);
  });
});

describe('applyResolvedTheme', () => {
  it('toggles only the light class and keeps the other classes on <html>', () => {
    const root = document.documentElement;
    root.className = 'mx-auto w-full';

    applyResolvedTheme(root, 'light');
    expect(root.className).toBe(`mx-auto w-full ${LIGHT_THEME_CLASS}`);

    applyResolvedTheme(root, 'dark');
    expect(root.className).toBe('mx-auto w-full');
  });
});

describe('buildThemePrepaintScript', () => {
  const runPrepaint = () => new Function(buildThemePrepaintScript())();

  it.each([
    [null, true],
    [null, false],
    ['dark', true],
    ['dark', false],
    ['light', true],
    ['light', false],
    ['system', true],
    ['system', false],
    ['invalid', true],
    ['invalid', false],
  ] as const)('paints stored %s with prefers-dark=%s the way readResolvedTheme resolves it', (stored, prefersDark) => {
    if (stored !== null) window.localStorage.setItem(THEME_STORAGE_KEY, stored);
    stubPrefersDark(prefersDark);
    document.documentElement.className = 'mx-auto';

    runPrepaint();

    expect(isLight()).toBe(readResolvedTheme(window) === 'light');
    expect(document.documentElement.classList.contains('mx-auto')).toBe(true);
  });

  it('keeps the dark base for system when matchMedia is unavailable', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'system');

    runPrepaint();

    expect(isLight()).toBe(false);
  });

  it('follows the OS scheme when localStorage is unavailable', () => {
    stubPrefersDark(false);
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    runPrepaint();

    expect(isLight()).toBe(true);
  });

  it('never writes the shared preference', () => {
    stubPrefersDark(false);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    runPrepaint();

    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('cannot close the inline <script> element it is rendered into', () => {
    expect(buildThemePrepaintScript()).not.toContain('<');
  });
});

describe('subscribeToThemeChanges', () => {
  it('reports writes of pubky-theme from other same-origin browsing contexts', () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeToThemeChanges(window, onChange);

    writeFromApp('light');

    expect(onChange).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('reports a cleared localStorage', () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeToThemeChanges(window, onChange);

    window.dispatchEvent(new StorageEvent('storage', { key: null, storageArea: window.localStorage }));

    expect(onChange).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('ignores other keys and other storage areas', () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeToThemeChanges(window, onChange);

    window.dispatchEvent(
      new StorageEvent('storage', { key: 'auth-store', newValue: '{}', storageArea: window.localStorage }),
    );
    window.dispatchEvent(
      new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'light', storageArea: window.sessionStorage }),
    );

    expect(onChange).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('reports OS colour scheme changes', () => {
    const media = stubPrefersDark(true);
    const onChange = vi.fn();
    const unsubscribe = subscribeToThemeChanges(window, onChange);

    media.setPrefersDark(false);

    expect(onChange).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('reports a page restored from the back/forward cache only', () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeToThemeChanges(window, onChange);

    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
    expect(onChange).not.toHaveBeenCalled();

    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    expect(onChange).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('stops reporting after unsubscribing', () => {
    const media = stubPrefersDark(true);
    const onChange = vi.fn();

    subscribeToThemeChanges(window, onChange)();
    writeFromApp('light');
    media.setPrefersDark(false);

    expect(onChange).not.toHaveBeenCalled();
    expect(media.listeners.size).toBe(0);
  });
});

describe('syncDocumentTheme', () => {
  it('applies the current preference immediately', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    stubPrefersDark(true);

    const unsubscribe = syncDocumentTheme(window);

    expect(isLight()).toBe(true);
    unsubscribe();
  });

  it('follows pubky-app changing the setting live', () => {
    stubPrefersDark(true);
    const unsubscribe = syncDocumentTheme(window);
    expect(isLight()).toBe(false);

    writeFromApp('light');
    expect(isLight()).toBe(true);

    writeFromApp('dark');
    expect(isLight()).toBe(false);

    writeFromApp('system');
    expect(isLight()).toBe(false);

    unsubscribe();
  });

  it('falls back to system when pubky-app removes or corrupts the value', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    stubPrefersDark(false);
    const unsubscribe = syncDocumentTheme(window);
    expect(isLight()).toBe(false);

    writeFromApp(null);
    expect(isLight()).toBe(true);

    writeFromApp('dark');
    writeFromApp('not-a-theme');
    expect(isLight()).toBe(true);

    unsubscribe();
  });

  it('follows OS colour scheme changes while the preference is system', () => {
    const media = stubPrefersDark(true);
    const unsubscribe = syncDocumentTheme(window);
    expect(isLight()).toBe(false);

    media.setPrefersDark(false);
    expect(isLight()).toBe(true);

    media.setPrefersDark(true);
    expect(isLight()).toBe(false);

    unsubscribe();
  });

  it('ignores OS colour scheme changes while an explicit theme is stored', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    const media = stubPrefersDark(true);
    const unsubscribe = syncDocumentTheme(window);

    media.setPrefersDark(false);

    expect(isLight()).toBe(false);
    unsubscribe();
  });

  it('stops following changes once unsubscribed', () => {
    stubPrefersDark(true);
    syncDocumentTheme(window)();

    writeFromApp('light');

    expect(isLight()).toBe(false);
  });
});
