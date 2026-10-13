'use client';

import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Store } from 'lucide-react';
import { APP_ROUTES, getMarketplaceShopRoute } from '@/app/routes';
import { Button } from '@/atoms/Button/Button';
import { Container } from '@/atoms/Container/Container';
import { Link } from '@/atoms/Link/Link';
import { Typography } from '@/atoms/Typography/Typography';
import { useChatConversation } from '@/hooks/useChatConversation/useChatConversation';
import { useChatIdentity } from '@/hooks/useChatIdentity/useChatIdentity';
import { CHAT_COPY } from '@/libs/chat/copy';
import type { ChatContext } from '@/models/chat/chat.schema';
import { ChatComposer } from '@/organisms/Chat/ChatComposer';
import { ChatContextChip } from '@/organisms/Chat/ChatContextChip';
import { ChatIdentityNotice } from '@/organisms/Chat/ChatIdentityNotice';
import { ChatPeerIdentity, useChatPeerName } from '@/organisms/Chat/ChatPeerIdentity';
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
  const { identityState } = useChatIdentity();
  const thread = useChatConversation(peerPubky, context);
  const { name } = useChatPeerName(peerPubky);

  const peerNotEnabled = thread.openState === 'peer_not_enabled';
  const composerDisabled = !currentUserPubky || identityState === 'needs_reauth' || thread.isSelf;
  const disabledReason = thread.isSelf
    ? 'This is you.'
    : identityState === 'needs_reauth'
      ? 'Sign in again to send messages.'
      : undefined;
  const emptyHint = peerNotEnabled
    ? `${name} hasn't set up messages yet. You can write now; it's delivered once they sign in.`
    : `Say hello to ${name}. Messages are private between the two of you.`;

  return (
    <ContentLayout
      showLeftSidebar={false}
      showRightSidebar={false}
      showLeftMobileButton={false}
      showRightMobileButton={false}
      className="pb-24"
    >
      <Container
        overrideDefaults
        className="mx-auto flex h-[calc(100svh-9rem)] w-full max-w-3xl flex-col gap-3"
        data-surface="chat-conversation"
      >
        <div className="flex items-center gap-2">
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
          </>
        )}
      </Container>
    </ContentLayout>
  );
}
