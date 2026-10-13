import { z } from 'zod';
import { getBasePath } from '@/config/base-path';
import { isShopEmbedded } from '@/config/embedded';

/** Versioned public metadata contract, also implemented by Pubky App. No credentials cross this bridge. */
export const SHOP_SESSION_CHANNEL = 'pubky-shop-session';
export const SHOP_SESSION_VERSION = 1;

const snapshotSchema = z
  .object({
    generation: z.string(),
    shopCleanupEpoch: z.string().optional(),
    status: z.enum(['ready', 'signed-out', 'restoring', 'temporary-error', 'reauth-required']),
    pubky: z.string().min(1).nullable(),
    sessionStoreId: z.string().min(1).nullable(),
    grantId: z.string().min(1).nullable(),
    clientId: z.string().min(1).nullable(),
  })
  .refine(
    (snapshot) =>
      snapshot.status !== 'ready' ||
      Boolean(
        snapshot.generation && snapshot.pubky && snapshot.sessionStoreId && snapshot.grantId && snapshot.clientId,
      ),
  );

const sessionMessageSchema = z.object({
  channel: z.literal(SHOP_SESSION_CHANNEL),
  version: z.literal(SHOP_SESSION_VERSION),
  type: z.literal('session'),
  snapshot: snapshotSchema,
});

export type ShopHostSnapshot = z.infer<typeof snapshotSchema>;
export type ShopHostAction = 'ready' | 'request-login' | 'request-capabilities' | 'request-logout' | 'request-retry';

/** Top-level payment/share returns must re-enter the App shell before restoring an account. */
export function shopWrapperReturnPath(win: Window | undefined = globalThis.window): string | null {
  if (!win || win.top !== win || !isShopEmbedded() || getBasePath() !== '/shop-embed') return null;
  const { pathname, search, hash } = win.location;
  if (pathname === '/shop-embed/auth/passport/return') return null; // Popup reports to its opener.
  if (pathname !== '/shop-embed' && !pathname.startsWith('/shop-embed/')) return null;
  return `/shop${pathname.slice('/shop-embed'.length)}${search}${hash}`;
}

/** Layout embedding alone is not permission to consume a parent session. */
export function getShopHostWindow(win: Window | undefined = globalThis.window): Window | null {
  if (!win || win.parent === win || !isShopEmbedded()) return null;
  try {
    return win.parent.location.origin === win.location.origin ? win.parent : null;
  } catch {
    return null;
  }
}

export function parseShopHostSession(event: MessageEvent, win: Window = window): ShopHostSnapshot | null {
  const host = getShopHostWindow(win);
  if (!host || event.source !== host || event.origin !== win.location.origin) return null;
  const parsed = sessionMessageSchema.safeParse(event.data);
  return parsed.success ? parsed.data.snapshot : null;
}

export function requestShopHostAction(type: ShopHostAction, win: Window | undefined = globalThis.window): boolean {
  const host = getShopHostWindow(win);
  if (!host || !win) return false;
  host.postMessage({ channel: SHOP_SESSION_CHANNEL, version: SHOP_SESSION_VERSION, type }, win.location.origin);
  return true;
}

export function publishShopHostPath(win: Window = window): void {
  const host = getShopHostWindow(win);
  if (!host) return;
  host.postMessage(
    {
      channel: SHOP_SESSION_CHANNEL,
      version: SHOP_SESSION_VERSION,
      type: 'navigate',
      path: `${win.location.pathname}${win.location.search}${win.location.hash}`,
    },
    win.location.origin,
  );
}
