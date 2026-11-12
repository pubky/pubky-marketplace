'use client';

import type { ToastVariant } from '@/atoms/Toast/Toast.variants';
import { dispatch, genId, TOAST_DURATION } from './toast.store';

export interface ToastActionDescriptor {
  label: string;
  altText: string;
  onClick: () => void;
}

export interface ToastHandle {
  dismiss: () => void;
}

interface ToastOptionsBase {
  variant?: ToastVariant;
  dismissButton?: boolean;
  action?: ToastActionDescriptor;
}

type ToastLifetime =
  // Persistent messages require an action or dismissal; they cannot also expire.
  { persistent: true; durationMs?: never } | { persistent?: false; durationMs?: number };

export type ToastOptions = ToastOptionsBase &
  ToastLifetime &
  ({ title: string; description?: string } | { title?: string; description: string });

// Browsers clamp larger delays to 1ms. Invalid overrides use the normal lifetime
// instead of making an actionable message disappear immediately.
const MAX_TIMEOUT_MS = 2_147_483_647;

export function toast(options: ToastOptions): ToastHandle {
  const id = genId();
  const durationMs =
    options.durationMs !== undefined &&
    Number.isFinite(options.durationMs) &&
    options.durationMs > 0 &&
    options.durationMs <= MAX_TIMEOUT_MS
      ? options.durationMs
      : TOAST_DURATION;

  dispatch({
    type: 'ADD_TOAST',
    toast: {
      id,
      variant: options.variant ?? 'default',
      title: options.title,
      description: options.description,
      dismissButton: options.dismissButton ?? false,
      action: options.action,
      persistent: options.persistent ?? false,
      durationMs,
      open: true,
    },
  });

  return { dismiss: () => dispatch({ type: 'DISMISS_TOAST', toastId: id }) };
}
