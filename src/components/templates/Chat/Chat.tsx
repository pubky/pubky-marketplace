'use client';

import { MessageCircle } from 'lucide-react';
import { APP_ROUTES } from '@/app/routes';
import { Button } from '@/atoms/Button/Button';
import { Container } from '@/atoms/Container/Container';
import { Heading } from '@/atoms/Heading/Heading';
import { Link } from '@/atoms/Link/Link';
import { Skeleton } from '@/atoms/Skeleton/Skeleton';
import { Typography } from '@/atoms/Typography/Typography';
import { getCommerceAdapterMode } from '@/config/commerce';
import { useChatConversations } from '@/hooks/useChatConversations/useChatConversations';
import { useChatIdentity } from '@/hooks/useChatIdentity/useChatIdentity';
import { useIsEmbedded } from '@/hooks/useIsEmbedded/useIsEmbedded';
import { CHAT_COPY } from '@/libs/chat/copy';
import { ChatConversationRow } from '@/organisms/Chat/ChatConversationRow';
import { ChatIdentityNotice } from '@/organisms/Chat/ChatIdentityNotice';
import { ContentLayout } from '@/organisms/ContentLayout/ContentLayout';
import { MarketplaceSectionNav } from '@/organisms/Marketplace/MarketplaceSectionNav';
import { useAuthStore } from '@/stores/auth/auth.store';

/** `/messages`: every conversation of the signed-in account, newest activity first. */
export function Chat() {
  const { conversations, isLoading, isSignedIn } = useChatConversations();
  const { identityState, retry } = useChatIdentity();
  const isEmbedded = useIsEmbedded();
  const setShowSignInDialog = useAuthStore((state) => state.setShowSignInDialog);
  // Without commerce the Market pages lead nowhere: no tab bar, no Browse market link. The header and the
  // mobile footer leave Market out then too.
  const commerceAvailable = getCommerceAdapterMode() !== 'unavailable';

  return (
    <ContentLayout
      showLeftSidebar={false}
      showRightSidebar={false}
      showLeftMobileButton={false}
      showRightMobileButton={false}
      // Lets the Market tab bar pin to the page instead of the clipped main column, as on the Market pages.
      disableMainContentOverflow
      // The bottom room is for the standalone FAB; the embedded Shop has none.
      className={isEmbedded ? 'pb-6' : 'pb-28'}
    >
      {/* Messages is one of the Market tabs, and on a phone this bar is the only way between them. */}
      {commerceAvailable ? <MarketplaceSectionNav /> : null}
      <Container overrideDefaults className="mx-auto flex w-full max-w-3xl flex-col gap-6" data-surface="chat-inbox">
        <div className="flex flex-col gap-1">
          <Heading level={1} size="xl">
            {CHAT_COPY.inboxTitle}
          </Heading>
          <Typography as="p" className="text-muted-foreground">
            {CHAT_COPY.inboxSubtitle}
          </Typography>
        </div>

        {!isSignedIn ? (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border p-6">
            <Heading level={2} size="md">
              {CHAT_COPY.inboxSignedOutTitle}
            </Heading>
            <Typography as="p" className="text-muted-foreground">
              {CHAT_COPY.inboxSignedOutBody}
            </Typography>
            <Button type="button" className="rounded-full" onClick={() => setShowSignInDialog(true)}>
              Sign in
            </Button>
          </div>
        ) : (
          <>
            <ChatIdentityNotice identityState={identityState} onRetry={retry} />
            {identityState === 'needs_reauth' ? null : isLoading ? (
              <div className="flex flex-col gap-3" data-testid="chat-inbox-loading">
                {[0, 1, 2].map((index) => (
                  <Skeleton key={index} className="h-18 w-full rounded-xl" />
                ))}
              </div>
            ) : conversations.length === 0 ? (
              <div
                className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-8 text-center"
                data-testid="chat-inbox-empty"
              >
                <MessageCircle className="size-10 text-muted-foreground" aria-hidden="true" />
                <Heading level={2} size="md">
                  {CHAT_COPY.inboxEmptyTitle}
                </Heading>
                <Typography as="p" className="max-w-sm text-muted-foreground">
                  {CHAT_COPY.inboxEmptyBody}
                </Typography>
                {commerceAvailable ? (
                  <Button asChild variant="secondary" className="mt-2 rounded-full">
                    <Link href={APP_ROUTES.MARKETPLACE} overrideDefaults>
                      Browse market
                    </Link>
                  </Button>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-col gap-2" data-testid="chat-inbox-list">
                {conversations.map((conversation) => (
                  <ChatConversationRow key={conversation.id} conversation={conversation} />
                ))}
              </div>
            )}
          </>
        )}
      </Container>
    </ContentLayout>
  );
}
