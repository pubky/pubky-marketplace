import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QRCodeSVG } from 'qrcode.react';
import { vi } from 'vitest';

/**
 * Stand-in for upstream paykit-server's embedded setup page (`/setup` and
 * `/reconnect`, `iframe_response` in paykit-server `src/http/setup.rs`), which
 * the Connect Bitkit dialog frames. The markup and styles are the server's;
 * the QR is the same EC level H code of the authorization URL, dark modules
 * `#111111` on a transparent background, with no quiet zone. On a touch screen
 * the page hides the QR and shows the 60px Continue with Bitkit button instead.
 * The script is left out: the completion poll would move the dialog on, and
 * the Android/iOS link swap changes only the button's `href`.
 */
const PAYKIT_SETUP_CSS = `html,body{margin:0;height:100%}
body{display:flex;align-items:center;justify-content:center;background:transparent;font:700 14px/20px system-ui,-apple-system,sans-serif;color:#d4d4db}
main{width:100%;display:flex;align-items:center;justify-content:center}
.qr{display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:192px;height:192px;padding:12px;border-radius:8px;background:#fff}
.qr svg{display:block;width:100%;height:100%}
.bitkit-btn{display:none}
@media (hover:none) and (pointer:coarse){.qr{display:none}.bitkit-btn{display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:100%;height:60px;padding:20px 32px;border-radius:9999px;background:#303034;color:#d4d4db;text-decoration:none}}
`;

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function paykitSetupPage(authorizationUrl: string) {
  const qrSvg = renderToStaticMarkup(
    createElement(QRCodeSVG, {
      value: authorizationUrl,
      level: 'H',
      size: 192,
      marginSize: 0,
      fgColor: '#111111',
      bgColor: 'transparent',
      'aria-label': 'Bitkit authorization QR code',
    }),
  );
  return (
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<style>${PAYKIT_SETUP_CSS}</style><main><span class="qr" data-testid="paykit-auth-qr">${qrSvg}</span>` +
    `<a class="bitkit-btn" href="${escapeHtml(authorizationUrl)}">Continue with Bitkit</a></main>`
  );
}

const pageUrls = new Map<string, string>();

/**
 * A same-origin `blob:` URL serving the page for `authorizationUrl`, so the
 * scene can wait for the QR inside the frame before capturing.
 */
export function getPaykitSetupPageUrl(authorizationUrl: string) {
  let url = pageUrls.get(authorizationUrl);
  if (!url) {
    url = URL.createObjectURL(new Blob([paykitSetupPage(authorizationUrl)], { type: 'text/html' }));
    pageUrls.set(authorizationUrl, url);
  }
  return url;
}

/**
 * Resolves once the frame titled `title` has loaded the stub page, with the
 * panel it shows: the QR, or the Continue with Bitkit button touch screens get.
 */
export async function waitForPaykitSetupPage(title: string): Promise<'qr' | 'bitkit-button'> {
  const doc = await vi.waitFor(
    () => {
      const frame = document.querySelector<HTMLIFrameElement>(`iframe[title="${title}"]`);
      const frameDoc = frame?.contentDocument;
      if (frameDoc?.readyState !== 'complete' || !frameDoc.querySelector('[data-testid="paykit-auth-qr"] svg')) {
        throw new Error(`The ${title} frame has not loaded the Paykit setup page yet.`);
      }
      return frameDoc;
    },
    { timeout: 5_000 },
  );
  await doc.fonts.ready;
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const qr = doc.querySelector('[data-testid="paykit-auth-qr"]')!;
  return doc.defaultView!.getComputedStyle(qr).display === 'none' ? 'bitkit-button' : 'qr';
}
