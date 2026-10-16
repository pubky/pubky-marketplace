import { useEffect } from 'react';
import { renderToString } from 'react-dom/server';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestShopHostAction } from '@/libs/shop-session/bridge';
import { ShopHostSessionProvider } from './ShopHostSessionProvider';

const mocks = vi.hoisted(() => ({
  embedded: false,
  ancestors: [] as string[],
  hosted: false,
  owned: false,
  mode: vi.fn(),
  apply: vi.fn(async () => 'signed-out'),
  path: '/marketplace',
  mounted: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => mocks.path,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/controllers/auth/auth', () => ({
  AuthController: {
    setHostSessionMode: mocks.mode,
    applyHostSession: mocks.apply,
  },
}));
vi.mock('@/stores/auth/auth.store', () => ({ useAuthStore: () => false }));
vi.mock('@/libs/runtime-config/runtime-config', () => ({
  getEmbeddedFlag: () => mocks.embedded,
  getFrameAncestors: () => mocks.ancestors,
}));
vi.mock('@/libs/shop-session/bridge', () => ({
  getShopHostWindow: () => (mocks.hosted ? window : null),
  parseShopHostSession: (event: MessageEvent) => event.data,
  requestShopHostAction: vi.fn(),
  publishShopHostPath: vi.fn(),
  shopWrapperReturnPath: () => null,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.embedded = false;
  mocks.ancestors = [];
  mocks.hosted = false;
  mocks.owned = false;
  mocks.path = '/marketplace';
  mocks.apply.mockResolvedValue('signed-out');
  mocks.mode.mockImplementation((hosted: boolean) => {
    mocks.owned = hosted;
  });
});

describe('Shop host session rendering', () => {
  it('keeps standalone public catalog content in server-rendered HTML', () => {
    const html = renderToString(
      <ShopHostSessionProvider>
        <main>Public marketplace catalog</main>
      </ShopHostSessionProvider>,
    );
    expect(html).toContain('<main>Public marketplace catalog</main>');
    expect(html).not.toContain('Restoring your session');
    expect(mocks.mode).not.toHaveBeenCalled();
  });

  it.each(['forced', 'framing'] as const)('gates initial server content when %s embedding is possible', (mode) => {
    mocks.embedded = mode === 'forced';
    mocks.ancestors = mode === 'framing' ? ["'self'"] : [];
    const html = renderToString(
      <ShopHostSessionProvider>
        <main>Account content</main>
      </ShopHostSessionProvider>,
    );
    expect(html).toContain('Restoring your session');
    expect(html).not.toContain('Account content');
    expect(mocks.mode).not.toHaveBeenCalled();
  });

  it('sets controller ownership before mounting children in a hosting deployment', async () => {
    mocks.embedded = true;
    mocks.hosted = true;
    function AccountConsumer() {
      useEffect(() => {
        mocks.mounted(mocks.owned);
      }, []);
      return <main>Hosted catalog</main>;
    }
    render(
      <ShopHostSessionProvider>
        <AccountConsumer />
      </ShopHostSessionProvider>,
    );
    expect(mocks.mode).toHaveBeenCalledWith(true);
    expect(mocks.mounted).not.toHaveBeenCalled();
    act(() =>
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            generation: 'signed-out-generation',
            status: 'signed-out',
            pubky: null,
            sessionStoreId: null,
            grantId: null,
            clientId: null,
          },
        }),
      ),
    );
    await waitFor(() => {
      expect(screen.getByText('Hosted catalog')).toBeInTheDocument();
      expect(mocks.mounted).toHaveBeenCalledWith(true);
    });
  });
});

it.each(['/marketplace', '/settings/account'])(
  'keeps public browsing available after a host capability refusal at %s',
  async (path) => {
    mocks.embedded = true;
    mocks.hosted = true;
    mocks.path = path;
    mocks.apply.mockResolvedValue('capabilities-required');
    render(
      <ShopHostSessionProvider>
        <main>Route content</main>
      </ShopHostSessionProvider>,
    );
    act(() => window.dispatchEvent(new MessageEvent('message', { data: { status: 'ready', generation: '1' } })));
    await screen.findByText('Approve Shop access in Pubky App to continue.');
    expect(Boolean(screen.queryByText('Route content'))).toBe(path === '/marketplace');
  },
);

it('retries a duplicate host snapshot after the local restore temporarily failed', async () => {
  mocks.embedded = true;
  mocks.hosted = true;
  mocks.apply.mockResolvedValueOnce('temporary-error').mockResolvedValueOnce('ready');
  render(
    <ShopHostSessionProvider>
      <main>Route content</main>
    </ShopHostSessionProvider>,
  );
  const snapshot = { status: 'ready', generation: '1', pubky: 'alice' };
  act(() => window.dispatchEvent(new MessageEvent('message', { data: snapshot })));
  await screen.findByText('Your Pubky App session could not be restored. Your saved session has been kept.');
  act(() => window.dispatchEvent(new MessageEvent('message', { data: snapshot })));
  await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('Try again')).not.toBeInTheDocument();
});

it.each(['/marketplace', '/marketplace/cart'])(
  'explains a guest cleanup outage without claiming to have a saved session at %s',
  async (path) => {
    mocks.embedded = true;
    mocks.hosted = true;
    mocks.path = path;
    mocks.apply.mockResolvedValueOnce('ready').mockResolvedValueOnce('temporary-error');
    render(
      <ShopHostSessionProvider>
        <main>Route content</main>
      </ShopHostSessionProvider>,
    );
    act(() =>
      window.dispatchEvent(new MessageEvent('message', { data: { status: 'ready', generation: '1', pubky: 'alice' } })),
    );
    await screen.findByText('Route content');
    act(() =>
      window.dispatchEvent(
        new MessageEvent('message', { data: { status: 'signed-out', generation: '2', pubky: null } }),
      ),
    );
    await screen.findByText('Shop is temporarily unavailable. Please try again.');
    expect(screen.queryByText(/Your saved session has been kept/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    expect(Boolean(screen.queryByText('Route content'))).toBe(path === '/marketplace');
  },
);

it('lets a first-time guest retry a failed cleanup without requesting authentication', async () => {
  mocks.embedded = true;
  mocks.hosted = true;
  mocks.apply.mockResolvedValueOnce('temporary-error').mockResolvedValueOnce('signed-out');
  render(
    <ShopHostSessionProvider>
      <main>Public catalog</main>
    </ShopHostSessionProvider>,
  );
  const snapshot = { status: 'signed-out', generation: 'guest', pubky: null };
  act(() => window.dispatchEvent(new MessageEvent('message', { data: snapshot })));
  await screen.findByText('Shop is temporarily unavailable. Please try again.');
  expect(screen.queryByText(/Your saved session has been kept/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(requestShopHostAction).toHaveBeenLastCalledWith('request-retry');
  act(() => window.dispatchEvent(new MessageEvent('message', { data: snapshot })));
  await waitFor(() => expect(screen.queryByText('Try again')).not.toBeInTheDocument());
  expect(screen.getByText('Public catalog')).toBeInTheDocument();
  expect(requestShopHostAction).not.toHaveBeenCalledWith('request-login');
});
