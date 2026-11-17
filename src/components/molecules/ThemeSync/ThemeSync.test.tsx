import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIGHT_THEME_CLASS, THEME_STORAGE_KEY } from '@/config/theme';
import { ThemeSync } from './ThemeSync';

function writeFromApp(value: string) {
  window.localStorage.setItem(THEME_STORAGE_KEY, value);
  window.dispatchEvent(
    new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: value, storageArea: window.localStorage }),
  );
}

function isLight() {
  return document.documentElement.classList.contains(LIGHT_THEME_CLASS);
}

describe('ThemeSync', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = '';
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
    document.documentElement.className = '';
  });

  it('renders nothing', () => {
    const { container } = render(<ThemeSync />);

    expect(container).toBeEmptyDOMElement();
  });

  it('applies the shared preference to <html> on mount', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');

    render(<ThemeSync />);

    expect(isLight()).toBe(true);
  });

  it('follows pubky-app changing the setting while mounted', () => {
    render(<ThemeSync />);
    expect(isLight()).toBe(false);

    act(() => writeFromApp('light'));
    expect(isLight()).toBe(true);

    act(() => writeFromApp('dark'));
    expect(isLight()).toBe(false);
  });

  it('stops following changes after unmount', () => {
    const { unmount } = render(<ThemeSync />);
    unmount();

    writeFromApp('light');

    expect(isLight()).toBe(false);
  });
});
