import { defineBrowserCommand } from '@vitest/browser-playwright';
import type { BrowserCommandContext } from 'vitest/node';
import type { VrtViewport } from './vrt.viewports';

const initialViewports = new WeakMap<BrowserCommandContext['page'], VrtViewport>();

/** Resize the real browser, not just Vitest's automatically scaled test iframe. */
export const resizeVrtBrowser = defineBrowserCommand(async ({ page }, viewport?: VrtViewport) => {
  if (!initialViewports.has(page)) initialViewports.set(page, page.viewportSize()!);
  await page.setViewportSize(viewport ?? initialViewports.get(page)!);
});

interface ProtocolSession {
  send(method: string, params: object): Promise<unknown>;
}

interface ServerPage {
  delegate?: { _mainFrameSession?: { _client?: ProtocolSession }; _session?: ProtocolSession };
  browserContext?: { _browserContextId?: string; _browser?: { session?: ProtocolSession } };
}

/** Playwright's in-process server object behind a client `Page`. */
function serverPage(page: BrowserCommandContext['page']): ServerPage {
  const connection = (page as unknown as { _connection?: { toImpl?: (object: unknown) => unknown } })._connection;
  const server = connection?.toImpl?.(page) as ServerPage | undefined;
  if (!server) throw new Error('emulateVrtTouch: Playwright no longer exposes its server page; revisit this command.');
  return server;
}

/**
 * Turn a phone's touch screen on or off for the whole tab, frames included:
 * `navigator.maxTouchPoints` and the `(hover: none) and (pointer: coarse)`
 * media features. Playwright's `hasTouch` does this only when a context is
 * created, and Vitest owns the context, so this sends the protocol call
 * `hasTouch` sends, on the session Playwright sends it on.
 */
export const emulateVrtTouch = defineBrowserCommand(async ({ page }, enabled: boolean) => {
  const server = serverPage(page);
  const browserName = page.context().browser()?.browserType().name();
  if (browserName === 'chromium') {
    const client = server.delegate?._mainFrameSession?._client;
    if (!client) throw new Error('emulateVrtTouch: no Chromium page session; revisit this command.');
    await client.send('Emulation.setTouchEmulationEnabled', enabled ? { enabled, maxTouchPoints: 5 } : { enabled });
    if (!enabled) {
      // Turning touch off restores hover from the browser's preferences, which
      // read `hover: none` on a headless host; Playwright's
      // `--blink-settings=primaryHoverType=…` is applied only when preferences
      // are resent. A capture beyond the viewport resends them, as Playwright's
      // own captures of elements taller than the viewport do.
      await client.send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: 0, y: 0, width: 1, height: 1, scale: 1 },
        captureBeyondViewport: true,
      });
    }
    return;
  }
  if (browserName === 'firefox') {
    const context = server.browserContext;
    const session = context?._browser?.session;
    if (!context?._browserContextId || !session) {
      throw new Error('emulateVrtTouch: no Firefox context session; revisit this command.');
    }
    await session.send('Browser.setTouchOverride', { browserContextId: context._browserContextId, hasTouch: enabled });
    return;
  }
  if (browserName === 'webkit') {
    const session = server.delegate?._session;
    if (!session) throw new Error('emulateVrtTouch: no WebKit page session; revisit this command.');
    await session.send('Page.setTouchEmulationEnabled', { enabled });
    return;
  }
  throw new Error(`emulateVrtTouch: no touch emulation for ${browserName}.`);
});

declare module 'vitest/browser' {
  interface BrowserCommands {
    resizeVrtBrowser: (viewport?: VrtViewport) => Promise<void>;
    emulateVrtTouch: (enabled: boolean) => Promise<void>;
  }
}
