import { renderToString } from 'react-dom/server';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY } from '@/config/theme';
import { useResolvedTheme } from './useResolvedTheme';

type Listener = () => void;

function stubPrefersDark(initial: boolean) {
  const listeners = new Set<Listener>();
  const query = {
    matches: initial,
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => query),
  );
  return (next: boolean) => {
    query.matches = next;
    listeners.forEach((listener) => listener());
  };
}

function writeFromApp(value: string) {
  window.localStorage.setItem(THEME_STORAGE_KEY, value);
  window.dispatchEvent(
    new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: value, storageArea: window.localStorage }),
  );
}

function ResolvedThemeProbe() {
  return <span>{useResolvedTheme()}</span>;
}

describe('useResolvedTheme', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('renders the dark base on the server', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');

    expect(renderToString(<ResolvedThemeProbe />)).toBe('<span>dark</span>');
  });

  it('reads the shared preference in the browser', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    stubPrefersDark(true);

    const { result } = renderHook(() => useResolvedTheme());

    expect(result.current).toBe('light');
  });

  it('resolves a missing preference through the OS scheme', () => {
    stubPrefersDark(false);

    const { result } = renderHook(() => useResolvedTheme());

    expect(result.current).toBe('light');
  });

  it('updates when pubky-app changes the setting', () => {
    stubPrefersDark(true);
    const { result } = renderHook(() => useResolvedTheme());
    expect(result.current).toBe('dark');

    act(() => writeFromApp('light'));

    expect(result.current).toBe('light');
  });

  it('updates when the OS scheme changes under system', () => {
    const setPrefersDark = stubPrefersDark(true);
    const { result } = renderHook(() => useResolvedTheme());
    expect(result.current).toBe('dark');

    act(() => setPrefersDark(false));

    expect(result.current).toBe('light');
  });
});
