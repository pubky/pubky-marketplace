'use client';

import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Store } from 'lucide-react';
import { APP_ROUTES, getMarketplaceShopRoute } from '@/app/routes';
import { Button } from '@/atoms/Button/Button';
import { Container } from '@/atoms/Container/Container';
import { Link } from '@/atoms/Link/Link';
import { Typography } from '@/atoms/Typography/Typography';
import { useChatConversation } from '@/hooks/useChatConversation/useChatConversation';
import { useChatIdentity } from '@/hooks/useChatIdentity/useChatIdentity';
import { useFillViewport } from '@/hooks/useFillViewport/useFillViewport';
import { useIsEmbedded } from '@/hooks/useIsEmbedded/useIsEmbedded';
import { useKeyboardViewport } from '@/hooks/useKeyboardViewport/useKeyboardViewport';
import { CHAT_COPY } from '@/libs/chat/copy';
import { cn } from '@/libs/utils/utils';
import type { ChatContext } from '@/models/chat/chat.schema';
import { ChatComposer } from '@/organisms/Chat/ChatComposer';
import { ChatContextChip } from '@/organisms/Chat/ChatContextChip';
import { ChatIdentityNotice } from '@/organisms/Chat/ChatIdentityNotice';
import { ChatPeerIdentity, useChatPeerName } from '@/organisms/Chat/ChatPeerIdentity';
import { ChatPrivacyNote } from '@/organisms/Chat/ChatPrivacyNote';
import { ChatThread } from '@/organisms/Chat/ChatThread';
import { ContentLayout } from '@/organisms/ContentLayout/ContentLayout';
import { useAuthStore } from '@/stores/auth/auth.store';

function contextFromQuery(params: URLSearchParams | null): ChatContext | undefined {
  const listingId = params?.get('listing')?.trim();
  const orderId = params?.get('order')?.trim();
  if (!listingId && !orderId) return undefined;
  return { ...(listingId ? { listingId } : {}), ...(orderId ? { orderId } : {}) };
}

/** `/messages/[pubky]`: the thread with one peer. */
export function ChatConversation({ peerPubky }: { peerPubky: string }) {
  const searchParams = useSearchParams();
  const context = contextFromQuery(searchParams);
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  const setShowSignInDialog = useAuthStore((state) => state.setShowSignInDialog);
  const { identityState, inboxStatus } = useChatIdentity();
  const isEmbedded = useIsEmbedded();
  const frameRef = useRef<HTMLDivElement>(null);
  // The thread ends where the page ends, whatever the layout puts above or below it.
  const fillHeight = useFillViewport(frameRef);
  // With the phone keyboard open the thread takes the whole visible area: the page header and the
  // notes under the composer would leave the messages a sliver, and the composer must sit on the keyboard.
  const keyboard = useKeyboardViewport();
  const pinned = keyboard.isKeyboardVisible;
  const thread = useChatConversation(peerPubky, context);
  const { name } = useChatPeerName(peerPubky);
  const router = useRouter();
  useEffect(() => {
    // There is no thread with yourself; the inbox is the sensible place to land.
    if (thread.isSelf) router.replace(APP_ROUTES.MESSAGES);
  }, [router, thread.isSelf]);

  const peerNotEnabled = thread.openState === 'peer_not_enabled';
  const awaitingFirstReply = !thread.messages.some((message) => message.direction === 'received');
  const composerDisabled = !currentUserPubky || identityState === 'needs_reauth' || thread.isSelf;
  const disabledReason = thread.isSelf
    ? 'This is you.'
    : identityState === 'needs_reauth'
      ? 'Sign in again to send messages.'
      : undefined;
  const emptyHint =
    identityState === 'needs_reauth'
      ? undefined
      : peerNotEnabled
        ? `${name} hasn't set up messages yet. You can write now; it's delivered once they sign in.`
        : `Say hello to ${name}.`;

  return (
    <ContentLayout
      showLeftSidebar={false}
      showRightSidebar={false}
      showLeftMobileButton={false}
      showRightMobileButton={false}
      // Standalone keeps room under the thread for the fixed mobile footer; the
      // embedded Shop has none, only the legal strip that follows in flow.
      className={isEmbedded ? 'pb-4' : 'pb-24 lg:pb-8'}
    >
      <Container
        ref={frameRef}
        overrideDefaults
        className={cn(
          // The server render's height only; the measured height takes over before the first paint.
          'mx-auto flex h-[calc(100svh-12rem)] w-full max-w-3xl flex-col gap-3',
          isEmbedded && 'pt-2',
          pinned && 'fixed inset-x-0 z-40 bg-background px-4 py-2',
        )}
        style={
          pinned
            ? { top: keyboard.viewportOffsetTop, height: keyboard.viewportHeight }
            : fillHeight === null
              ? undefined
              : { height: fillHeight }
        }
        data-keyboard-pinned={pinned ? 'true' : undefined}
        data-surface="chat-conversation"
      >
        {/* Phones: stays under the sticky Pubky header if the page scrolls (the embed collapses the
            offset). Desktop: static. A sticky offset there lands 144px into the thread, because the
            layout wrapper, not the window, is the scrollport. */}
        <div
          className={cn('flex items-center gap-2 bg-background', pinned ? 'static' : 'sticky top-24 z-10 lg:static')}
        >
          <Button asChild variant="ghost" size="icon" className="rounded-full" aria-label="All messages">
            <Link href={APP_ROUTES.MESSAGES} overrideDefaults>
              <ArrowLeft className="size-5" aria-hidden="true" />
            </Link>
          </Button>
          <ChatPeerIdentity peerPubky={peerPubky} className="min-w-0 flex-1" />
          <Button asChild variant="ghost" size="sm" className="rounded-full text-muted-foreground">
            <Link href={getMarketplaceShopRoute(peerPubky)} overrideDefaults>
              <Store className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Storefront</span>
            </Link>
          </Button>
        </div>

        {context ? (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
            <Typography as="span" size="xs" className="shrink-0 text-muted-foreground">
              About
            </Typography>
            <ChatContextChip context={context} peerPubky={peerPubky} />
          </div>
        ) : null}

        {!currentUserPubky ? (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border p-6">
            <Typography as="p" className="text-muted-foreground">
              {CHAT_COPY.inboxSignedOutTitle}
            </Typography>
            <Button type="button" className="rounded-full" onClick={() => setShowSignInDialog(true)}>
              Sign in
            </Button>
          </div>
        ) : (
          <>
            <ChatIdentityNotice identityState={identityState} onRetry={thread.reopen} />
            <ChatThread
              messages={thread.messages}
              peerPubky={peerPubky}
              hasMore={thread.hasMore}
              onLoadOlder={thread.loadOlder}
              onRetry={(id) => void thread.retryMessage(id)}
              emptyHint={emptyHint}
            />
            {peerNotEnabled && thread.messages.length > 0 ? (
              <Typography as="p" size="xs" className="px-1 text-muted-foreground" data-testid="chat-peer-not-enabled">
                {name} hasn&apos;t set up messages yet. New messages wait until they sign in.
              </Typography>
            ) : null}
            <ChatComposer
              peerPubky={peerPubky}
              context={context}
              disabled={composerDisabled}
              disabledReason={disabledReason}
              placeholder={`Message ${name}`}
            />
            {!pinned && inboxStatus === 'disabled' && awaitingFirstReply && !peerNotEnabled ? (
              <Typography as="p" size="xs" className="px-1 text-muted-foreground" data-testid="chat-no-inbox-note">
                {CHAT_COPY.noInboxFirstContact}
              </Typography>
            ) : null}
            {pinned ? null : <ChatPrivacyNote />}
          </>
        )}
      </Container>
    </ContentLayout>
  );
}
