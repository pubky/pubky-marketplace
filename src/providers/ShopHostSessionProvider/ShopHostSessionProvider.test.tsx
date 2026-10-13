import { useEffect } from 'react';
import { renderToString } from 'react-dom/server';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShopHostSessionProvider } from './ShopHostSessionProvider';

const mocks = vi.hoisted(() => ({
  embedded: false,
  ancestors: [] as string[],
  hosted: false,
  owned: false,
  mode: vi.fn(),
  mounted: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/marketplace',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/controllers/auth/auth', () => ({
  AuthController: {
    setHostSessionMode: mocks.mode,
    applyHostSession: async () => 'signed-out',
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
    await waitFor(() => expect(screen.getByText('Hosted catalog')).toBeInTheDocument());
    expect(mocks.mounted).toHaveBeenCalledWith(true);
  });
});
