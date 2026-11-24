import { createElement } from 'react';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { installTranslatorDomGuard, uninstallTranslatorDomGuard } from './translator-dom-guard';

// What Google Translate (and other page translators) do: replace a text node React owns with
// their own `<font>` wrapper, so the node React later removes or inserts before is no longer a
// child of the parent React remembers.
function translate(parent: HTMLElement): Text {
  const original = parent.firstChild as Text;
  const font = document.createElement('font');
  font.textContent = 'traduzido';
  parent.replaceChild(font, original);
  return original;
}

describe('installTranslatorDomGuard', () => {
  afterEach(() => uninstallTranslatorDomGuard());

  it('lets React remove a node a translator already moved', () => {
    installTranslatorDomGuard();
    const parent = document.createElement('p');
    parent.append('original');
    const moved = translate(parent);

    expect(() => parent.removeChild(moved)).not.toThrow();
  });

  it('lets React insert before a node a translator already moved', () => {
    installTranslatorDomGuard();
    const parent = document.createElement('p');
    parent.append('original');
    const moved = translate(parent);
    const next = document.createElement('span');

    expect(() => parent.insertBefore(next, moved)).not.toThrow();
    expect(next.parentNode).toBe(parent);
  });

  it('keeps normal removeChild and insertBefore behaviour', () => {
    installTranslatorDomGuard();
    const parent = document.createElement('div');
    const a = document.createElement('a');
    const b = document.createElement('b');
    parent.append(a);
    parent.insertBefore(b, a);
    expect([...parent.childNodes]).toEqual([b, a]);
    expect(parent.removeChild(a)).toBe(a);
    expect([...parent.childNodes]).toEqual([b]);
  });

  it('is idempotent', () => {
    installTranslatorDomGuard();
    const patched = Node.prototype.removeChild;
    installTranslatorDomGuard();
    expect(Node.prototype.removeChild).toBe(patched);
  });
});

describe('React under a page translator', () => {
  afterEach(() => uninstallTranslatorDomGuard());

  function Toggle({ on }: { on: boolean }) {
    return createElement('p', { 'data-testid': 'toggle' }, on ? 'Connected' : null, 'status');
  }

  function renderThenTranslate() {
    const view = render(createElement(Toggle, { on: true }));
    translate(view.getByTestId('toggle'));
    return view;
  }

  it('crashes on the next render without the guard', () => {
    const view = renderThenTranslate();
    expect(() => view.rerender(createElement(Toggle, { on: false }))).toThrow(/removeChild|not a child/);
  });

  it('keeps rendering with the guard installed', () => {
    installTranslatorDomGuard();
    const view = renderThenTranslate();
    expect(() => view.rerender(createElement(Toggle, { on: false }))).not.toThrow();
  });
});
