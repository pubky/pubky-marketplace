import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { useUnsavedChangesGuard } from './useUnsavedChangesGuard';

function links() {
  return (
    <div>
      <a href="/marketplace/orders">Orders</a>
      <a href="/marketplace/orders" target="_blank">
        Orders in a new tab
      </a>
      <a href="/marketplace/orders" download>
        Download
      </a>
      <a href="#countryCode">Country field</a>
      <a href={`${window.location.pathname}${window.location.search}#bottom`}>This page, lower</a>
      <a href="https://example.com/help">Elsewhere</a>
    </div>
  );
}

function Harness({ active }: { active: boolean }) {
  const guard = useUnsavedChangesGuard(active);
  return (
    <>
      {links()}
      <span data-testid="pending">{guard.pendingLink?.textContent ?? ''}</span>
      <button onClick={guard.stay}>stay</button>
      <button onClick={guard.leave}>leave</button>
    </>
  );
}

let followed: Mock<(event: Event) => void>;

function linkClicks(): Event[] {
  return followed.mock.calls
    .map(([event]) => event as Event)
    .filter((event) => event.target instanceof Element && event.target.closest('a') !== null);
}

beforeEach(() => {
  window.history.replaceState(null, '', '/marketplace/storefront');
  followed = vi.fn((event: Event) => event.preventDefault());
  document.addEventListener('click', followed);
});

afterEach(() => {
  document.removeEventListener('click', followed);
});

describe('useUnsavedChangesGuard', () => {
  it('leaves every link and the browser alone while nothing is unsaved', () => {
    render(<Harness active={false} />);

    fireEvent.click(screen.getByRole('link', { name: 'Orders' }));
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);

    expect(linkClicks()).toHaveLength(1);
    expect(screen.getByTestId('pending')).toHaveTextContent('');
    expect(unload.defaultPrevented).toBe(false);
  });

  it('holds back a click on a link to another page of the site, and reports it', () => {
    render(<Harness active />);

    fireEvent.click(screen.getByRole('link', { name: 'Orders' }));

    expect(linkClicks()).toHaveLength(0);
    expect(screen.getByTestId('pending')).toHaveTextContent('Orders');
  });

  it.each([
    ['opens a new tab', 'Orders in a new tab', {}],
    ['downloads', 'Download', {}],
    ['only moves within the page (hash)', 'Country field', {}],
    ['stays on this page and only changes the hash', 'This page, lower', {}],
    ['leaves the site (the browser asks)', 'Elsewhere', {}],
    ['is clicked with a modifier key', 'Orders', { ctrlKey: true }],
    ['is clicked with the middle button', 'Orders', { button: 1 }],
  ])('does not hold back a link that %s', (_label, name, init) => {
    render(<Harness active />);

    fireEvent.click(screen.getByRole('link', { name }), init);

    expect(linkClicks()).toHaveLength(1);
    expect(screen.getByTestId('pending')).toHaveTextContent('');
  });

  it('drops the held-back link when the visitor stays', () => {
    render(<Harness active />);
    fireEvent.click(screen.getByRole('link', { name: 'Orders' }));

    fireEvent.click(screen.getByRole('button', { name: 'stay' }));

    expect(screen.getByTestId('pending')).toHaveTextContent('');
    expect(linkClicks()).toHaveLength(0);
  });

  it('follows the held-back link once, as a normal click, when the visitor leaves', () => {
    render(<Harness active />);
    const orders = screen.getByRole('link', { name: 'Orders' });
    fireEvent.click(orders);

    fireEvent.click(screen.getByRole('button', { name: 'leave' }));

    expect(linkClicks()).toHaveLength(1);
    expect(linkClicks()[0].target).toBe(orders);
    expect(screen.getByTestId('pending')).toHaveTextContent('');

    fireEvent.click(orders);
    expect(screen.getByTestId('pending')).toHaveTextContent('Orders');
  });

  it('asks the browser before the tab is closed or reloaded', () => {
    render(<Harness active />);
    const unload = new Event('beforeunload', { cancelable: true });

    window.dispatchEvent(unload);

    expect(unload.defaultPrevented).toBe(true);
  });

  it('stops guarding as soon as nothing is unsaved any more', () => {
    const { rerender } = renderHook(({ active }) => useUnsavedChangesGuard(active), {
      initialProps: { active: true },
    });

    rerender({ active: false });
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);

    expect(unload.defaultPrevented).toBe(false);
  });

  it('stops guarding when the page goes away', () => {
    const { unmount } = renderHook(() => useUnsavedChangesGuard(true));

    unmount();
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);

    expect(unload.defaultPrevented).toBe(false);
  });
});
