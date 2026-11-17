import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { READER_WALLET_SETUP_COPY } from '@/libs/commerce/failure-messages';
import { renderForVRT } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';
import { toast, type ToastOptions } from './toast';
import { dispatch, getSnapshot } from './toast.store';
import { Toaster } from './Toaster';

const scenes = [
  {
    name: 'cart-undo',
    options: {
      title: 'Item removed',
      action: { label: 'Undo', altText: 'Restore item to cart', onClick: () => {} },
    },
  },
  {
    name: 'wallet-retry',
    options: {
      variant: 'error',
      title: READER_WALLET_SETUP_COPY.title,
      description: READER_WALLET_SETUP_COPY.description,
      dismissButton: true,
      action: {
        label: READER_WALLET_SETUP_COPY.retry,
        altText: READER_WALLET_SETUP_COPY.retry,
        onClick: () => {},
      },
    },
  },
  {
    name: 'long-description',
    options: {
      variant: 'info',
      title: 'Link copied to clipboard',
      description: `https://pubky-ring-signer.example.com/auth?redirect=${'a'.repeat(120)}`,
      dismissButton: true,
    },
  },
] satisfies { name: string; options: ToastOptions }[];

// Use the real public producer, store, renderer, and Radix primitives. Keep each
// message visible through screenshot retries; exact lifetimes have unit coverage.
afterEach(() => {
  for (const { id } of getSnapshot().toasts) dispatch({ type: 'REMOVE_TOAST', toastId: id });
});

for (const theme of ['dark', 'light'] as const) {
  for (const [viewportName, viewport] of [
    ['desktop', VRT_VIEWPORT_DESKTOP],
    ['mobile', VRT_VIEWPORT_MOBILE],
  ] as const) {
    describe(`Toaster ${theme} ${viewportName}`, () => {
      for (const scene of scenes) {
        it(scene.name, async () => {
          const screen = await renderForVRT(<Toaster />, { viewport, theme, disableHover: true });
          toast({ ...scene.options, durationMs: 60_000 });
          await expect.element(screen.getByText(scene.options.title)).toBeVisible();
          const surface = document.querySelector('[data-cy="toast"]');
          if (!(surface instanceof HTMLElement)) throw new Error('The production toast did not render.');
          await expect(page.elementLocator(surface)).toMatchScreenshot(
            `toaster-${scene.name}-${theme}-${viewportName}`,
          );
        });
      }
    });
  }
}

it('expires an action-created replacement while the pointer stays over the toast viewport', async () => {
  const screen = await renderForVRT(<Toaster />, { viewport: VRT_VIEWPORT_DESKTOP });
  let actionCalls = 0;
  toast({
    title: 'Item removed',
    durationMs: 60_000,
    action: {
      label: 'Undo',
      altText: 'Restore item to cart',
      onClick: () => {
        actionCalls += 1;
        toast({ title: 'Item restored' });
      },
    },
  });
  await expect.element(screen.getByRole('button', { name: 'Undo' })).toBeVisible();
  const viewport = document.querySelector('[data-cy="toast"]')?.parentElement;
  if (!(viewport instanceof HTMLElement)) throw new Error('The production toast viewport did not render.');
  await page.elementLocator(viewport).hover();
  await screen.getByRole('button', { name: 'Undo' }).click();
  await expect.element(screen.getByText('Item restored')).toBeVisible();
  expect(actionCalls).toBe(1);
  await expect.element(screen.getByText('Item removed')).not.toBeInTheDocument();
  expect(viewport.matches(':hover')).toBe(true);

  // Do not move the pointer: Radix remains paused after the action interaction.
  // The store must still close the replacement at its ordinary three-second
  // lifetime. Polling allows scheduling slack; exact boundaries live in unit tests.
  await expect.element(screen.getByText('Item restored'), { timeout: 5_000 }).not.toBeInTheDocument();
});
