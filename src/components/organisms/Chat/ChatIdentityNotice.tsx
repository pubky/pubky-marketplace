'use client';

import { KeyRound, LogOut } from 'lucide-react';
import { Button } from '@/atoms/Button/Button';
import { Typography } from '@/atoms/Typography/Typography';
import { useSignOut } from '@/hooks/useSignOut/useSignOut';
import type { ChatStore } from '@/stores/chat/chat.types';

/**
 * Shown when this sign-in cannot use messages: the grant lacks the chat
 * scopes (older approval) or the key setup failed. Sign in again to fix it.
 */
export function ChatIdentityNotice({
  identityState,
  onRetry,
}: {
  identityState: ChatStore['identityState'];
  onRetry: () => void | Promise<void>;
}) {
  const { handleSignOut, isLoading: isSigningOut } = useSignOut();
  if (identityState === 'ready' || identityState === 'unknown') return null;
  const needsReauth = identityState === 'needs_reauth';
  return (
    <div
      role="status"
      data-testid="chat-identity-notice"
      className="flex flex-col gap-3 rounded-xl border border-border bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Typography as="p" size="sm" className="text-muted-foreground">
          {needsReauth
            ? 'Messages need a newer sign-in approval. Sign out and sign in again to turn them on.'
            : 'Messages could not be set up. Check your connection and try again.'}
        </Typography>
      </div>
      {needsReauth ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="w-fit shrink-0 rounded-full"
          disabled={isSigningOut}
          onClick={() => void handleSignOut()}
        >
          <LogOut className="size-4" aria-hidden="true" />
          {isSigningOut ? 'Signing out...' : 'Sign out'}
        </Button>
      ) : (
        <Button type="button" variant="secondary" size="sm" className="rounded-full" onClick={() => void onRetry()}>
          Try again
        </Button>
      )}
    </div>
  );
}
