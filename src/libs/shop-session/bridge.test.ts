import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asOpaque } from '@/test-utils/type-assertions';
import {
  getShopHostWindow,
  parseShopHostSession,
  publishShopHostPath,
  requestShopHostAction,
  shopWrapperReturnPath,
} from './bridge';

const config = vi.hoisted(() => ({ embedded: true, basePath: '/shop-embed' }));
vi.mock('@/config/embedded', () => ({ isShopEmbedded: () => config.embedded }));
vi.mock('@/config/base-path', () => ({ getBasePath: () => config.basePath }));

function fixture() {
  const postMessage = vi.fn();
  const parent = asOpaque<Window>({ location: { origin: 'https://pubky.app' }, postMessage });
  const win = asOpaque<Window>({
    parent,
    top: parent,
    location: {
      origin: 'https://pubky.app',
      pathname: '/shop-embed/marketplace',
      search: '?sort=price',
      hash: '#listing',
    },
  });
  const snapshot = {
    generation: 'generation',
    status: 'ready',
    pubky: 'identity',
    clientId: 'pubky.app',
    grantId: 'grant',
    sessionStoreId: 'record',
  };
  const event = asOpaque<MessageEvent>({
    origin: 'https://pubky.app',
    source: parent,
    data: { channel: 'pubky-shop-session', version: 1, type: 'session', snapshot },
  });
  return { parent, win, postMessage, event, snapshot };
}

beforeEach(() => {
  config.embedded = true;
  config.basePath = '/shop-embed';
});

describe('Shop host bridge', () => {
  it('accepts only validated public metadata from its same-origin parent', () => {
    const { event, win, snapshot } = fixture();
    expect(parseShopHostSession(event, win)).toEqual(snapshot);
    expect(parseShopHostSession(asOpaque<MessageEvent>({ ...event, origin: 'https://evil.example' }), win)).toBeNull();
    expect(parseShopHostSession(asOpaque<MessageEvent>({ ...event, source: window }), win)).toBeNull();
  });
  it('rejects unsupported versions and incomplete ready records', () => {
    const { event, win } = fixture();
    expect(
      parseShopHostSession(asOpaque<MessageEvent>({ ...event, data: { ...event.data, version: 2 } }), win),
    ).toBeNull();
    expect(
      parseShopHostSession(
        asOpaque<MessageEvent>({
          ...event,
          data: { ...event.data, snapshot: { ...event.data.snapshot, grantId: null } },
        }),
        win,
      ),
    ).toBeNull();
  });
  it('accepts the initial signed-out generation without a record', () => {
    const { event, win } = fixture();
    const snapshot = {
      generation: '',
      status: 'signed-out',
      pubky: null,
      clientId: null,
      grantId: null,
      sessionStoreId: null,
    };
    expect(parseShopHostSession(asOpaque<MessageEvent>({ ...event, data: { ...event.data, snapshot } }), win)).toEqual(
      snapshot,
    );
  });
  it('does not attach merely because a different-origin frame uses the embedded layout', () => {
    const { win } = fixture();
    const parent = asOpaque<Window>({ location: { origin: 'https://different.example' } });
    expect(getShopHostWindow(asOpaque<Window>({ ...win, parent }))).toBeNull();
    config.embedded = false;
    expect(getShopHostWindow(win)).toBeNull();
  });
  it('targets the exact parent origin for actions and mounted navigation', () => {
    const { win, postMessage } = fixture();
    expect(requestShopHostAction('request-logout', win)).toBe(true);
    expect(postMessage).toHaveBeenLastCalledWith(
      { channel: 'pubky-shop-session', version: 1, type: 'request-logout' },
      'https://pubky.app',
    );
    publishShopHostPath(win);
    expect(postMessage).toHaveBeenLastCalledWith(
      {
        channel: 'pubky-shop-session',
        version: 1,
        type: 'navigate',
        path: '/shop-embed/marketplace?sort=price#listing',
      },
      'https://pubky.app',
    );
  });
  it('routes top-level returns to the App, preserving payment query and fragment', () => {
    const { win } = fixture();
    Object.defineProperty(win, 'top', { value: win });
    expect(shopWrapperReturnPath(win)).toBe('/shop/marketplace?sort=price#listing');
    win.location.pathname = '/shop-embed/auth/passport/return';
    expect(shopWrapperReturnPath(win)).toBeNull();
    config.basePath = '';
    expect(shopWrapperReturnPath(win)).toBeNull();
  });
});
